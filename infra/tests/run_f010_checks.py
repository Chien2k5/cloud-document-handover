"""Per-finding offline execution evidence for F010. Does not call AWS or install tools."""
import argparse,datetime,hashlib,inspect,json,re,subprocess,sys,time,unittest,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'infra/tests'));sys.path.insert(0,str(ROOT/'deploy/tests'))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('modules',nargs='*',default=['test_rds_alarm_notifications']);parser.add_argument('--label',default='F010');args=parser.parse_args()
    class Results(unittest.TextTestResult):
        records=[]
        def save(self,test,status,actual):
            method=getattr(test,test._testMethodName);match=re.search(r'TC_F010_\d{2}',test.id())
            self.records.append(dict(testId=match[0].replace('_','-') if match else test.id(),function=test.id(),file=inspect.getfile(method),line=inspect.getsourcelines(method)[1],inputAndAssertions=inspect.getsource(method),actual=actual,status=status))
        def addSuccess(self,test):super().addSuccess(test);self.save(test,'PASS_OFFLINE','Executed assertions passed')
        def addFailure(self,test,error):super().addFailure(test,error);self.save(test,'FAIL',self._exc_info_to_string(error,test))
        def addError(self,test,error):super().addError(test,error);self.save(test,'FAIL',self._exc_info_to_string(error,test))
        def addSkip(self,test,reason):super().addSkip(test,reason);self.save(test,'BLOCKED',reason)
    started=time.monotonic();result=unittest.TextTestRunner(verbosity=2,resultclass=Results).run(unittest.defaultTestLoader.loadTestsFromNames(args.modules))
    code=0 if result.testsRun and result.wasSuccessful() and not result.skipped else 1
    files=['infra/cloudformation/00-storage.yaml','infra/cloudformation/01-rds-beanstalk-cloudfront.yaml','deploy/deploy_aws.ps1','infra/README.md','infra/tests/test_rds_alarm_notifications.py','infra/tests/run_f010_checks.py','infra/tests/test_duration_alarm.py','infra/tests/test_backup_iam.py','infra/tests/wave3_support.py','deploy/tests/run_deploy_fixture.ps1','deploy/tests/test_alarm_notification_wiring.py','deploy/tests/test_deploy_failfast.py','deploy/tests/test_backup_operator_gate.py','deploy/tests/native_stub.py']
    report=dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),workspace=str(ROOT),branch=subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),workingTree=subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True),environment='Offline structural/expression-contract and isolated native-process stubs only; no AWS account/API/notification execution',command=[sys.executable,*sys.argv],python=sys.version,durationSeconds=time.monotonic()-started,exitCode=code,testsRun=result.testsRun,passed=result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped),failed=len(result.failures)+len(result.errors),blocked=len(result.skipped),cases=result.records,sourceHashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in files},awsSubscriptionConfirmation='PENDING_AWS_VERIFICATION',awsNotificationDelivery='PENDING_AWS_VERIFICATION')
    path=ROOT/'infra/tests'/f'{args.label}-{uuid.uuid4().hex}.log';path.write_text(json.dumps(report,indent=2),encoding='utf-8');print('EVIDENCE='+str(path));return code
if __name__=='__main__':sys.exit(main())
