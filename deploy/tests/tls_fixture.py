"""Owned PostgreSQL, ephemeral test certificates, offline copy-build and real JDBC."""
import contextlib,datetime,hashlib,importlib.util,json,os,shutil,socket,subprocess,sys,tempfile,time,urllib.request,uuid,zipfile
from pathlib import Path
from urllib.parse import quote
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'ops/tests'));sys.path.insert(0,str(ROOT/'infra/tests'))
from wave2_support import Postgres
from wave3_support import template

def clean_environment():return {k:v for k,v in os.environ.items() if not k.startswith(('AWS_','DB_','PGPASSWORD','SPRING_'))}

def make_certificates(folder):
    now=datetime.datetime.now(datetime.timezone.utc);key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Wave3 disposable CA')])
    ca=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=7)).add_extension(x509.BasicConstraints(ca=True,path_length=0),True).sign(ca_key,hashes.SHA256()))
    (folder/'ca.pem').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (folder/'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    for variant in ['valid','expired']:
        start=now-datetime.timedelta(days=3);end=now+datetime.timedelta(days=3) if variant=='valid' else now-datetime.timedelta(days=1)
        cert=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(start).not_valid_after(end).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]),False).add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),False).sign(ca_key,hashes.SHA256()))
        (folder/(variant+'.pem')).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    other_name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Wrong disposable CA')])
    wrong=(x509.CertificateBuilder().subject_name(other_name).issuer_name(other_name).public_key(other.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=3)).add_extension(x509.BasicConstraints(ca=True,path_length=0),True).sign(other,hashes.SHA256()))
    (folder/'wrong-ca.pem').write_bytes(wrong.public_bytes(serialization.Encoding.PEM))


def java21():
    candidates=[]
    if os.environ.get('WAVE3_JAVA_HOME'):candidates.append(Path(os.environ['WAVE3_JAVA_HOME'])/'bin/java.exe')
    programs=Path(os.environ.get('ProgramFiles','C:/Program Files'))
    for vendor in ['Java','Eclipse Adoptium','Amazon Corretto']:
        candidates+=list((programs/vendor).glob('*21*/bin/java.exe'))
    for path in candidates:
        if path.is_file():
            version=subprocess.check_output([str(path),'--version'],text=True,encoding='utf-8').splitlines()[0]
            if ' 21.' in version:return path,version
    raise RuntimeError('JDK 21 required; set WAVE3_JAVA_HOME to an existing installation')

def build_backend(folder):
    folder.mkdir();shutil.copy2(ROOT/'backend/pom.xml',folder/'pom.xml');(folder/'src').mkdir();shutil.copytree(ROOT/'backend/src/main',folder/'src/main')
    candidates=list((Path.home()/'.m2/wrapper/dists').glob('**/bin/mvn.cmd'))
    candidates.sort(key=lambda p:'3.9.16' in str(p),reverse=True)
    maven=next((p for p in candidates if list((p.parent.parent/'boot').glob('plexus-classworlds-*.jar'))),None)
    if not maven:raise RuntimeError('Cached offline Maven distribution required; no tool installation is attempted')
    env=clean_environment();env['MAVEN_HOME']=str(maven.parent.parent);env['JAVA_HOME']=str(java21()[0].parent.parent)
    log=ROOT/'infra/tests'/('F011-backend-build-'+uuid.uuid4().hex+'.log')
    with log.open('w',encoding='utf-8') as stream:proc=subprocess.run([str(maven),'-o','-f',str(folder/'pom.xml'),'-Dmaven.test.skip=true','package'],env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=120)
    if proc.returncode:raise RuntimeError('Offline backend build failed; evidence '+str(log))
    jar=folder/'target/document-handover-0.1.0-SNAPSHOT.jar'
    if not jar.is_file():raise RuntimeError('Backend build produced no JAR')
    return jar

class TlsFixture:
    def __enter__(self):
        self.stack=contextlib.ExitStack()
        try:
            target=ROOT/'deploy/tests/target';target.mkdir(exist_ok=True)
            self.folder=Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='wave3-tls-',dir=target)))
            self.java,self.java_version=java21()
            make_certificates(self.folder)
            self.jar=build_backend(self.folder/'backend');self.pg=self.stack.enter_context(Postgres())
            with zipfile.ZipFile(self.jar) as z:
                name=next(name for name in z.namelist() if name.startswith('BOOT-INF/lib/postgresql-') and name.endswith('.jar'))
                self.jdbc=self.folder/Path(name).name;self.jdbc.write_bytes(z.read(name));self.jdbc_version=self.jdbc.name
            self.source=self.pg.database(False)
            # Local socket fixtures remain accessible; every TCP client must use TLS.
            hba='local all all trust\nhostnossl all all 0.0.0.0/0 reject\nhostssl all all 0.0.0.0/0 trust\nhostnossl all all ::/0 reject\nhostssl all all ::/0 trust\n'
            subprocess.run(['docker','exec','-i',self.pg.container,'sh','-c','cat > /var/lib/postgresql/data/pg_hba.conf'],input=hba,text=True,check=True,capture_output=True)
            self.set_server('valid');return self
        except BaseException:self.stack.close();raise
    def __exit__(self,*args):self.stack.close()
    def set_server(self,variant):
        container=self.pg.container
        leaf='/tmp/wave3-'+variant+'.crt';key='/tmp/wave3-server.key'
        for source,target in [(self.folder/(variant+'.pem'),leaf),(self.folder/'server.key',key)]:
            subprocess.run(['docker','cp',str(source),container+':'+target],check=True,capture_output=True)
        subprocess.run(['docker','exec','--user','root',container,'chown','postgres:postgres',leaf,key],check=True,capture_output=True)
        subprocess.run(['docker','exec','--user','root',container,'chmod','600',key],check=True,capture_output=True)
        for setting,value in [('ssl_cert_file',leaf),('ssl_key_file',key),('ssl','on')]:self.pg.query('postgres',f"ALTER SYSTEM SET {setting}='{value}';")
        self.pg.query('postgres','SELECT pg_reload_conf();')
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if self.pg.query('postgres',"SELECT current_setting('ssl') || ':' || current_setting('ssl_cert_file');")=='on:'+leaf:return
        raise RuntimeError('TLS config did not reload')
    def configured_url(self,db=None,host='localhost',ca=None):
        options=template('01-rds-beanstalk-cloudfront.yaml')['Resources']['HandoverEbEnvironment']['Properties']['OptionSettings']
        original=next(o['Value']['Fn::Sub'] for o in options if o['OptionName']=='DB_URL')
        mode=original.split('sslmode=',1)[1].split('&',1)[0]
        return f'jdbc:postgresql://{host}:{self.pg.port}/{db or self.source}?sslmode={mode}&sslrootcert='+quote(str(ca or self.folder/'ca.pem').replace('\\','/'),safe='/:')+'&connectTimeout=5&socketTimeout=5'
    def probe(self,url=None):
        env=clean_environment();env.update(TLS_TEST_URL=url or self.configured_url(),TLS_TEST_USER='postgres',TLS_TEST_PASSWORD='fixture-only')
        return subprocess.run([str(self.java),'-cp',str(self.jdbc),str(ROOT/'deploy/tests/JdbcTlsProbe.java')],env=env,capture_output=True,text=True,encoding='utf-8',timeout=20)
    @contextlib.contextmanager
    def app(self,db,ca):
        with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        env=clean_environment();env.update(DB_URL=self.configured_url(db=db,ca=ca)+'&ApplicationName=wave3-tls-app',DB_USERNAME='postgres',DB_PASSWORD='fixture-only',SERVER_PORT=str(port),SERVER_ADDRESS='127.0.0.1',UPLOAD_S3_ENABLED='false',SESSION_COOKIE_SECURE='true',SPRING_SECURITY_USER_PASSWORD='fixture-only-auto-user')
        log=self.folder/('app-'+uuid.uuid4().hex+'.log')
        with log.open('w',encoding='utf-8') as stream:
            proc=subprocess.Popen([str(self.java),'-Duser.timezone=UTC','-jar',str(self.jar)],env=env,cwd=self.folder,stdout=stream,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+45
                ready=False
                while time.monotonic()<deadline:
                    if proc.poll() is not None:raise RuntimeError('Backend exited during TLS startup')
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/health',timeout=1) as response:
                            ready=json.loads(response.read())=={'status':'UP'}
                    except (OSError,ValueError):pass
                    if ready:break
                    time.sleep(.1)
                if not ready:raise RuntimeError('Backend TLS startup/health timed out')
                yield proc
            finally:
                if proc.poll() is None:proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)
        sanitized=log.read_text(encoding='utf-8').replace('fixture-only-auto-user','[REDACTED_FIXTURE]').replace('fixture-only','[REDACTED_FIXTURE]')
        (ROOT/'infra/tests'/('F011-app-'+uuid.uuid4().hex+'.log')).write_text(sanitized,encoding='utf-8')
