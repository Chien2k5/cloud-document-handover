"""Execute real PowerShell preflight and parameter forwarding against native stubs."""
import unittest
import test_deploy_failfast as failfast
class OperatorGateTests(unittest.TestCase):
    def run_deploy(self,**settings):return failfast.DeployTests().run_script(**settings)
    def test_missing_custom_operator_stops_before_aws(self):
        result=self.run_deploy(WAVE3_USE_LAB_ROLE='false')
        self.assertFalse(result['success']);self.assertEqual(result['trace'],[]);self.assertIn('requires',result['message'])
    def test_invalid_operator_stops_before_aws(self):
        for value in ['*','arn:aws:iam::111122223333:root','arn:aws:sts::111122223333:assumed-role/a/b']:
            with self.subTest(value=value):
                result=self.run_deploy(WAVE3_USE_LAB_ROLE='false',WAVE3_OPERATOR_ARN=value)
                self.assertFalse(result['success']);self.assertEqual(result['trace'],[])
    def test_custom_operator_forwarded_on_both_storage_updates(self):
        arn='arn:aws:iam::111122223333:role/fixture-operator'
        result=self.run_deploy(WAVE3_USE_LAB_ROLE='false',WAVE3_OPERATOR_ARN=arn)
        self.assertTrue(result['success'],result['output'])
        storage=[call for call in result['trace'] if call['key']=='cloudformation deploy' and 'infra/cloudformation/00-storage.yaml' in call['args']]
        self.assertEqual(len(storage),2)
        for call in storage:self.assertIn('BackupOperatorPrincipalArn='+arn,call['args'])
    def test_lab_default_still_runs(self):
        result=self.run_deploy();self.assertTrue(result['success'],result['output'])
if __name__=='__main__':unittest.main(verbosity=2)
