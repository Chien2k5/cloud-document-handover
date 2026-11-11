"""F003 IAM trust/configuration tests. Not an AWS IAM evaluation engine."""
import copy,json,re,subprocess,unittest
from wave3_support import ROOT,OPERATOR,Graph,decision,template,values,run_tests
class BackupIamTests(unittest.TestCase):
    def setUp(self):self.g=Graph();self.backend=self.g.statements('BackendInstanceRole');self.operator=self.g.statements('BackupOperatorRole');self.upload='arn:aws:s3:::nhom5-handover-uploads-111122223333-us-east-1';self.backup='arn:aws:s3:::nhom5-handover-backups-111122223333-us-east-1'
    def test_T003_01_no_backend_assume_allow(self):
        self.assertFalse(any(s['Effect']=='Allow' and 'sts:AssumeRole' in values(s['Action']) for s in self.backend))
    def test_T003_02_operator_trust_not_backend(self):
        role=self.g.role('BackupOperatorRole');backend=self.g.eval({'Fn::GetAtt':['BackendInstanceRole','Arn']})
        self.assertEqual(decision(role['AssumeRolePolicyDocument']['Statement'],'sts:AssumeRole','unused',backend),'ImplicitDeny')
    def test_T003_03_backend_cannot_get_backup(self):self.assertNotEqual(decision(self.backend,'s3:GetObject',self.backup+'/postgres/dump'),'Allow')
    def test_T003_04_backend_cannot_put_backup(self):self.assertNotEqual(decision(self.backend,'s3:PutObject',self.backup+'/postgres/dump'),'Allow')
    def test_T003_05_evaluated_escalation_denied(self):
        self.assertFalse(self.g.can_assume('BackendInstanceRole','BackupOperatorRole'))
        # A later accidental Allow must still lose to the narrow explicit Deny.
        role=self.g.eval({'Fn::GetAtt':['BackupOperatorRole','Arn']})
        self.assertEqual(decision(self.backend+[dict(Effect='Allow',Action='sts:AssumeRole',Resource=role)],'sts:AssumeRole',role),'Deny')
    def test_T003_06_operator_path_explicit(self):
        self.g.validate();trust=self.g.role('BackupOperatorRole')['AssumeRolePolicyDocument']['Statement']
        self.assertEqual(decision(trust,'sts:AssumeRole','unused',OPERATOR),'Allow')
        self.assertEqual(decision(trust,'sts:AssumeRole','unused','arn:aws:iam::111122223333:role/untrusted'),'ImplicitDeny')
    def test_T003_07_operator_exact_backup_read(self):self.assertEqual(decision(self.operator,'s3:GetObjectVersion',self.backup+'/postgres/dump'),'Allow')
    def test_T003_08_operator_backup_write_prefix(self):
        self.assertEqual(decision(self.operator,'s3:PutObject',self.backup+'/postgres/dump'),'Allow');self.assertNotEqual(decision(self.operator,'s3:PutObject',self.backup+'/outside/dump'),'Allow')
    def test_T003_09_operator_manifest_and_bucket_metadata(self):
        self.assertEqual(decision(self.operator,'s3:GetObject',self.backup+'/postgres/dump.meta.json'),'Allow');self.assertEqual(decision(self.operator,'s3:ListBucket',self.backup),'Allow')
    def test_T003_10_operator_restored_file_cross_check(self):
        self.assertEqual(decision(self.operator,'s3:GetObjectVersion',self.upload+'/uploads/key'),'Allow');self.assertEqual(decision(self.operator,'s3:GetObject',self.upload+'/results/key.json'),'Allow')
        for action in ['s3:PutObject','s3:DeleteObject']:self.assertNotEqual(decision(self.operator,action,self.upload+'/uploads/key'),'Allow')
    def test_T003_11_lambda_unchanged(self):self.assertEqual(template()['Resources']['LambdaChecksumRole'],template(baseline=True)['Resources']['LambdaChecksumRole'])
    def test_T003_12_backend_s3_contract_preserved(self):
        old=Graph(document=template(baseline=True)).statements('BackendInstanceRole')
        for action,key in [('s3:PutObject','/uploads/key'),('s3:GetObjectVersion','/uploads/key'),('s3:GetObject','/results/key.json'),('s3:ListBucket','')]:
            with self.subTest(action=action):self.assertEqual(decision(self.backend,action,self.upload+key),decision(old,action,self.upload+key));self.assertEqual(decision(self.backend,action,self.upload+key),'Allow')
        policy=json.loads((ROOT/'infra/iam/backend-instance-s3-policy.json').read_text());self.assertFalse(any('sts:AssumeRole' in values(s['Action']) for s in policy['Statement'] if s['Effect']=='Allow'))
    def test_T003_13_invalid_principal_rejected(self):
        for arn in ['*','arn:aws:iam::111122223333:root','arn:aws:sts::111122223333:assumed-role/op/session','not-an-arn','arn:aws:iam::111122223333:role/*','arn:aws:iam::111122223333:role/']:
            with self.subTest(arn=arn),self.assertRaises(ValueError):Graph(operator=arn).validate()
    def test_T003_14_missing_principal_fail_closed(self):
        with self.assertRaises(ValueError):Graph(operator='').validate()
        Graph('true',operator='').validate()
    def test_T003_15_custom_dependency_graph(self):
        self.g.validate();self.assertTrue({'BackendInstanceRole','BackendInstanceProfile','BackupOperatorRole','LambdaChecksumRole'}.issubset(self.g.resources))
        self.assertEqual(self.g.eval(self.g.doc['Outputs']['InstanceProfileName']['Value']),'BackendInstanceProfile')
        # Backend uses a deterministic target ARN, never GetAtt back to the operator role.
        self.assertNotIn('BackupOperatorRole',json.dumps(self.g.doc['Resources']['BackendInstanceRole']))
    def test_T003_16_lab_no_new_roles_or_operator_requirement(self):
        g=Graph('true',operator='');g.validate();self.assertFalse(any(r['Type'].startswith('AWS::IAM::') for r in g.resources.values()))
        self.assertEqual(g.eval(g.doc['Outputs']['InstanceProfileName']['Value']),'LabInstanceProfile');self.assertEqual(g.eval(g.doc['Outputs']['BackupOperatorRoleArn']['Value']),'')
    def test_T003_17_both_templates_lint(self):
        command=[str(ROOT/'infra/tests.venv/Scripts/cfn-lint.exe'),str(ROOT/'infra/cloudformation/00-storage.yaml'),str(ROOT/'infra/cloudformation/01-rds-beanstalk-cloudfront.yaml')]
        proc=subprocess.run(command,capture_output=True,text=True,timeout=90);self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
    def test_T003_18_no_new_wildcard_allow_or_delete(self):
        old=Graph(document=template(baseline=True))
        for role in ['BackendInstanceRole','BackupOperatorRole','LambdaChecksumRole']:
            previous=old.statements(role)
            for stmt in self.g.statements(role):
                if stmt['Effect']!='Allow':continue
                self.assertNotIn('*',values(stmt['Action']));self.assertNotIn('*',values(stmt['Resource']))
                self.assertFalse(any('DeleteObject' in action for action in values(stmt['Action'])))
                for action in values(stmt['Action']):
                    for resource in values(stmt['Resource']):self.assertEqual(decision(previous,action,resource),'Allow')
    def test_T003_19_no_alternate_trust_escalation(self):
        for role in ['BackupOperatorRole','LambdaChecksumRole']:
            self.assertFalse(self.g.can_assume('BackendInstanceRole',role))
        malicious=Graph(operator=self.g.eval({'Fn::GetAtt':['BackendInstanceRole','Arn']}));malicious.validate()
        self.assertFalse(malicious.can_assume('BackendInstanceRole','BackupOperatorRole'))
        trust=malicious.role('BackupOperatorRole')['AssumeRolePolicyDocument']['Statement']
        self.assertNotEqual(decision(trust,'sts:AssumeRole','unused',malicious.params['BackupOperatorPrincipalArn']),'Allow')
    def test_T003_20_only_iam_and_required_deploy_wiring_changed(self):
        old=template(baseline=True);new=template()
        for name,resource in old['Resources'].items():
            if name not in ['BackendInstanceRole','BackupOperatorRole']:self.assertEqual(new['Resources'][name],resource,name)
        # This is the F003 changeset guard; later authorized findings may alter template 01.
        history=subprocess.check_output(['git','log','--format=%H %s'],cwd=ROOT,text=True,encoding="utf-8").splitlines()
        commit=next((line.split()[0] for line in history if line.endswith('fix(iam): separate backend and backup operator trust')),None)
        current=subprocess.check_output(['git','show',commit+':infra/cloudformation/01-rds-beanstalk-cloudfront.yaml'],cwd=ROOT,text=True,encoding="utf-8") if commit else (ROOT/'infra/cloudformation/01-rds-beanstalk-cloudfront.yaml').read_text(encoding='utf-8')
        baseline=subprocess.check_output(['git','show','ee31cb9cb8bb7ce3f4518aa4b8c3db3b9d4a4d2b:infra/cloudformation/01-rds-beanstalk-cloudfront.yaml'],cwd=ROOT,text=True,encoding="utf-8")
        self.assertEqual(current.replace('\r\n','\n'),baseline.replace('\r\n','\n'))
if __name__=='__main__':
    import sys
    sys.exit(run_tests('test_backup_iam',sys.argv[1] if len(sys.argv)>1 else 'F003'))
