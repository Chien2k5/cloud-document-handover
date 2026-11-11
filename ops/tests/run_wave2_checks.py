"""Run specified Wave 2 unittest modules and preserve per-scenario execution evidence."""
import argparse,ast,hashlib,inspect,json,os,platform,re,subprocess,sys,time,unittest,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('modules',nargs='+');parser.add_argument('--label',required=True);args=parser.parse_args()
sys.path.insert(0,str(Path(__file__).parent))
class Results(unittest.TextTestResult):
    records=[]
    def record(self,test,status,detail=''):
        match=re.search(r'(T\d{3}_\d{2}|R2\d{2})',test.id())
        if not match:return
        identifier=match[1].replace('_','-')
        method=getattr(test,test._testMethodName)
        source=inspect.getsource(method)
        assertions=[line.strip() for line in source.splitlines() if 'self.assert' in line]
        self.records.append({'requirement':method.__name__.split(match[1],1)[-1].strip('_').replace('_',' '),'preconditions':'Owned PostgreSQL 17 fixture' if hasattr(test,'pg') else 'Isolated S3 boundary; no AWS SDK clients','inputAndSteps':source,'expectedAssertions':assertions,'testId':identifier,'function':test.id(),'file':str(Path(inspect.getfile(method)).resolve()),'line':inspect.getsourcelines(method)[1],'status':status,'actual':detail or 'All executable assertions passed'})
    def addSuccess(self,test):super().addSuccess(test);self.record(test,'PASS')
    def addFailure(self,test,error):super().addFailure(test,error);self.record(test,'FAIL',self._exc_info_to_string(error,test))
    def addError(self,test,error):super().addError(test,error);self.record(test,'FAIL',self._exc_info_to_string(error,test))
    def addSkip(self,test,reason):super().addSkip(test,reason);self.record(test,'N/A' if reason.startswith('N/A:') else 'BLOCKED',reason)
run_id=uuid.uuid4().hex;started=time.time();suite=unittest.defaultTestLoader.loadTestsFromNames(args.modules)
result=unittest.TextTestRunner(verbosity=2,resultclass=Results).run(suite)
exit_code=0 if result.wasSuccessful() and not any(x['status']=='BLOCKED' for x in result.records) else 1
pg=[]
from wave2_support import Postgres
for fixture in Postgres.instances:
    check=subprocess.run(['docker','inspect',fixture.container],capture_output=True)
    pg.append({'version':getattr(fixture,'version','NOT_COLLECTED'),'container':fixture.container,'removed':check.returncode!=0})
if any(not item['removed'] for item in pg):exit_code=1
sources=['ops/backup_db_to_s3.py','ops/restore_db_from_s3.py','ops/README.md']+[str(p.relative_to(ROOT)).replace('\\','/') for p in (ROOT/'ops/tests').glob('*.py')]
metadata={'runId':run_id,'timestamp':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'workspace':str(ROOT),'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'workingTree':subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True),'sourceHashes':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sources},'environment':'PostgreSQL 17 disposable; S3 boundary fake; no AWS','python':sys.version,'docker':subprocess.check_output(['docker','version','--format','{{.Server.Version}}'],text=True).strip(),'command':[sys.executable,*sys.argv],'exitCode':exit_code,'durationSeconds':round(time.time()-started,2),'discoveredCases':result.testsRun,'executed':result.testsRun-len(result.skipped),'skipped':len(result.skipped),'passed':sum(x['status']=='PASS' for x in result.records),'failed':len(result.failures)+len(result.errors),'blocked':sum(x['status']=='BLOCKED' for x in result.records),'notApplicable':sum(x['status']=='N/A' for x in result.records),'postgres':pg,'cases':result.records,'testDependencies':{'jsonschema':__import__('importlib.metadata',fromlist=['version']).version('jsonschema')},'aws':'NOT_RUN'}
path=ROOT/'ops/tests'/f'{args.label}-{run_id}.log';path.write_text(json.dumps(metadata,indent=2),encoding='utf-8');print('EVIDENCE='+str(path),flush=True)
sys.exit(exit_code)
