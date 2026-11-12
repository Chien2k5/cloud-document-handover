"""F010 deployment parameter tests: isolated copied script and verified native stubs."""
import unittest
import test_deploy_failfast as failfast
class AlarmNotificationWiringTests(unittest.TestCase):
    def deploy(self,**settings):return failfast.DeployTests().run_script(**settings)
    def stacks(self,result):
        calls=[call for call in result['trace'] if call['key']=='cloudformation deploy']
        storage=[call for call in calls if 'infra/cloudformation/00-storage.yaml' in call['args']]
        app=[call for call in calls if 'infra/cloudformation/01-rds-beanstalk-cloudfront.yaml' in call['args']]
        self.assertEqual(len(storage),2);self.assertEqual(len(app),1);return storage,app[0]
    def test_email_enables_rds_and_survives_cors_update(self):
        result=self.deploy(WAVE4_ALARM_EMAIL_SET='1',WAVE4_ALARM_EMAIL='alerts@example.invalid')
        self.assertTrue(result['success'],result['output']);storage,app=self.stacks(result)
        for call in storage:self.assertIn('AlarmEmail=alerts@example.invalid',call['args'])
        self.assertIn('EnableRdsAlarmNotifications=true',app['args'])
    def test_omission_preserves_existing_notification_parameters(self):
        result=self.deploy();self.assertTrue(result['success'],result['output']);storage,app=self.stacks(result)
        for call in storage:self.assertFalse(any(arg.startswith('AlarmEmail=') for arg in call['args']))
        self.assertFalse(any(arg.startswith('EnableRdsAlarmNotifications=') for arg in app['args']))
    def test_explicit_empty_explains_staged_disable(self):
        result=self.deploy(WAVE4_ALARM_EMAIL_SET='1',WAVE4_ALARM_EMAIL='')
        self.assertFalse(result['success'],result['output'])
        self.assertIn('Remove app notification imports first',result['message'])
        self.assertIn('then clear storage AlarmEmail',result['message'])
        self.assertIn('Omit -AlarmEmail to preserve settings',result['message'])
    def test_automatic_opt_out_fails_closed_before_export_update(self):
        result=self.deploy(WAVE4_ALARM_EMAIL_SET='1',WAVE4_ALARM_EMAIL='')
        self.assertFalse(result['success'],result['output']);self.assertEqual(result['trace'],[])
    def test_invalid_email_fails_before_any_native_calls(self):
        for value in ['not-email','x y@example.invalid','a@@example.invalid','a@example.invalid,b@example.invalid','a@example.invalid\n']:
            with self.subTest(value=value):
                result=self.deploy(WAVE4_ALARM_EMAIL_SET='1',WAVE4_ALARM_EMAIL=value)
                self.assertFalse(result['success'],result['output']);self.assertEqual(result['trace'],[])
if __name__=='__main__':unittest.main(verbosity=2)
