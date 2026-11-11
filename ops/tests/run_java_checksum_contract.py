"""Compile the existing Java consumer offline with versions from the cached backend BOM.
No Maven launcher, backend writes, framework boot, database or AWS calls are needed.
"""
import hashlib,json,os,shutil,subprocess,sys,tempfile,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CACHE=Path.home()/'.m2/repository'
NS={'p':'http://maven.apache.org/POM/4.0.0'}

def property_map(path):
    return {item.tag.split('}')[-1]:item.text for item in ET.parse(path).getroot().find('p:properties',NS)}

def main():
    java,javac=shutil.which('java'),shutil.which('javac')
    if not java or not javac:raise RuntimeError('JDK required for compiled Java contract check')
    props=property_map(CACHE/'org/springframework/boot/spring-boot-dependencies/3.5.16/spring-boot-dependencies-3.5.16.pom')
    jackson=property_map(CACHE/f"com/fasterxml/jackson/jackson-bom/{props['jackson-bom.version']}/jackson-bom-{props['jackson-bom.version']}.pom")
    selected=[]
    def add(group,artifact,version):
        path=CACHE/Path(group.replace('.','/'))/artifact/version/f'{artifact}-{version}.jar'
        if not path.is_file():raise RuntimeError('Missing cached dependency: '+str(path))
        selected.append(path)
    for artifact in ['spring-core','spring-jcl','spring-beans','spring-context','spring-expression','spring-aop','spring-tx','spring-jdbc','spring-web']:
        add('org.springframework',artifact,props['spring-framework.version'])
    for artifact in ['spring-security-core','spring-security-crypto']:
        add('org.springframework.security',artifact,props['spring-security.version'])
    for artifact in ['jackson-core','jackson-databind','jackson-annotations']:
        prop='jackson.version.annotations' if artifact=='jackson-annotations' else 'jackson.version.core' if artifact=='jackson-core' else 'jackson.version.databind'
        version=jackson.get(prop,jackson.get('jackson.version'))
        if version and version.startswith('${'):version=jackson[version[2:-1]]
        add('com.fasterxml.jackson.core',artifact,version)
    add('jakarta.validation','jakarta.validation-api',props['jakarta-validation.version'])
    add('org.slf4j','slf4j-api',props['slf4j.version'])
    # AWS SDK versions are explicitly pinned by backend/pom.xml. No clients are instantiated.
    for artifact in (CACHE/'software/amazon/awssdk').iterdir():
        jar=artifact/'2.31.78'/f'{artifact.name}-2.31.78.jar'
        if jar.is_file():selected.append(jar)
    sys.path.insert(0,str(ROOT/'aws/tests'))
    from check_java_contract import make_cases
    cases=make_cases()
    with tempfile.TemporaryDirectory(prefix='wave2-java-') as temporary:
        folder=Path(temporary);classes=folder/'classes';classes.mkdir()
        casefile=folder/'cases.json';casefile.write_text(json.dumps(cases),encoding='utf-8')
        source=ROOT/'backend/src/main/java'
        sources=[source/'vn/edu/uet/handover/upload/UploadService.java',source/'vn/edu/uet/handover/upload/S3StorageAdapter.java',ROOT/'aws/tests/ChecksumContractCheck.java']
        classpath=os.pathsep.join(str(path) for path in selected)
        args=['--release','21','-encoding','UTF-8','-cp',classpath,'-sourcepath',str(source),'-d',str(classes),*map(str,sources)]
        argfile=folder/'javac.args';argfile.write_text('\n'.join('"'+arg.replace('\\','/')+'"' for arg in args),encoding='utf-8')
        compiled=subprocess.run([javac,'@'+str(argfile)],text=True,capture_output=True,timeout=60)
        if compiled.returncode:raise RuntimeError('javac failed: '+compiled.stderr)
        checked=subprocess.run([java,'-cp',str(classes)+os.pathsep+classpath,'vn.edu.uet.handover.upload.ChecksumContractCheck',str(casefile)],text=True,capture_output=True,timeout=60)
        if checked.returncode:raise RuntimeError('Java contract failed: '+checked.stdout+checked.stderr)
        if 'PASS Java production checksum parser' not in checked.stdout:raise RuntimeError('Missing Java success marker')
        return {'command':'python -B ops/tests/run_java_checksum_contract.py','cases':len(cases),'compileExitCode':compiled.returncode,'runExitCode':checked.returncode,'actual':checked.stdout.strip(),'java':subprocess.check_output([java,'--version'],text=True).splitlines()[0],'dependencies':{str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in selected},'sourceHashes':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in source.rglob('*.java')},'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()}
if __name__=='__main__':
    report=main();path=ROOT/'ops/tests'/('java-contract-'+__import__('uuid').uuid4().hex+'.log');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(report['actual']);print('EVIDENCE='+str(path))
