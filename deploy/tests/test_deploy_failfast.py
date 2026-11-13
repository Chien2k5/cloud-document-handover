"""F002 executable cases against complete scripts, with native .cmd process stubs."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
SECRET='wave1-dummy-not-a-real-secret'
ENGINE=os.environ.get('WAVE1_TEST_ENGINE','powershell')
class DeployTests(unittest.TestCase):
    def run_script(self, script='deploy_aws.ps1', engine=ENGINE, **settings):
        with tempfile.TemporaryDirectory(prefix='wave1-deploy-') as temporary:
            root=Path(temporary)
            for name in ['deploy','backend','frontend','output','bin','caller']:(root/name).mkdir()
            for name in ['deploy_aws.ps1','redeploy_aws.ps1']:shutil.copy2(ROOT/'deploy'/name,root/'deploy'/name)
            stub=HERE/'native_stub.py'
            for name,tool in [('aws','aws'),('git','git'),('python','python'),('npm','npm'),('npx','npx')]:
                (root/'bin'/(name+'.cmd')).write_text(f'@echo off\n"{sys.executable}" "{stub}" {tool} %*\nexit /b %errorlevel%\n')
            (root/'backend/mvnw.cmd').write_text(f'@echo off\n"{sys.executable}" "{stub}" maven %*\nexit /b %errorlevel%\n')
            (root/'output/eb-release.zip').write_bytes(b'old-artifact')
            (root/'output/lambda-checksum.zip').write_bytes(b'old-artifact')
            env={k:v for k,v in os.environ.items() if not k.startswith('AWS_')}
            env.update(PATH=str(root/'bin')+os.pathsep+str(Path(os.environ['SystemRoot'])/'System32'),
                       WAVE1_FIXTURE=str(root), DB_MASTER_PASSWORD=SECRET, WAVE1_APP_HEALTH='UP')
            env.update(settings)
            command=[shutil.which(engine),'-NoProfile','-ExecutionPolicy','Bypass','-File',str(HERE/'run_deploy_fixture.ps1'),'-ScriptPath',str(root/'deploy'/script),'-FixtureRoot',str(root)]
            proc=subprocess.run(command,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=40)
            output=proc.stdout+proc.stderr
            self.assertEqual(proc.returncode,0,output)
            lines=[x.split('FIXTURE_RESULT:',1)[1] for x in proc.stdout.splitlines() if x.startswith('FIXTURE_RESULT:')]
            self.assertEqual(len(lines),1,output)
            result=json.loads(lines[0]);result['output']=output
            result['trace']=[json.loads(x) for x in (root/'trace.jsonl').read_text().splitlines()] if (root/'trace.jsonl').exists() else []
            result['processExitCode']=proc.returncode
            result['sourceHashes']={name:hashlib.sha256((ROOT/'deploy'/name).read_bytes()).hexdigest() for name in ['deploy_aws.ps1','redeploy_aws.ps1']}
            saved=dict(result);saved['output']=saved['output'].replace(SECRET,'[REDACTED]')
            saved.update(script=script,engineRequested=engine,settings=settings)
            with (HERE/f'F002-executions-{ENGINE}.log').open('a',encoding='utf-8') as evidence:evidence.write(json.dumps(saved)+'\n')
            return result
    def keys(self,r):return [x['key'] for x in r['trace']]
    def failure(self, key, forbidden, **settings):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            with self.subTest(script=script,key=key):
                r=self.run_script(script,WAVE1_FAIL=key,**settings)
                self.assertFalse(r['success'],r['output'])
                self.assertIn(key,self.keys(r))
                self.assertNotIn(forbidden,self.keys(r))
                self.assertNotIn('Deployment finished',r['output']);self.assertNotIn('Redeploy complete',r['output'])
    def test_T002_01_maven_zero_continues(self):
        r=self.run_script();self.assertTrue(r['success'],r['output']);self.assertLess(self.keys(r).index('maven'),self.keys(r).index('npm-ci'))
    def test_T002_02_maven_nonzero_stops(self):self.failure('maven','npm-ci')
    def test_T002_03_npm_ci_failure_stops_build(self):self.failure('npm-ci','vite-build')
    def test_T002_04_build_failure_stops_packaging(self):self.failure('vite-build','builder-eb')
    def test_T002_05_builder_failure_stops_upload(self):
        self.failure('builder-eb','s3 cp')
        r=self.run_script(WAVE1_FAIL='builder-lambda');self.assertFalse(r['success']);self.assertNotIn('s3 cp',self.keys(r))
    def test_T002_06_missing_new_artifact_rejects_old_zip(self):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            r=self.run_script(script,WAVE1_NO_ARTIFACT='builder-eb');self.assertFalse(r['success'],r['output']);self.assertNotIn('s3 cp',self.keys(r))
    def test_T002_07_sts_failure_stops_build(self):self.failure('sts get-caller-identity','maven')
    def test_T002_08_upload_failure_stops_dependents(self):
        for script,forbidden in [('deploy_aws.ps1','cloudformation deploy'),('redeploy_aws.ps1','elasticbeanstalk create-application-version')]:
            r=self.run_script(script,WAVE1_FAIL='s3 cp');self.assertFalse(r['success'],r['output']);self.assertNotIn(forbidden,self.keys(r))
    def test_T002_09_cloudformation_failure_stops_app_stack(self):
        r=self.run_script(WAVE1_FAIL='cloudformation deploy');self.assertFalse(r['success'],r['output']);self.assertEqual(self.keys(r).count('cloudformation deploy'),1);self.assertNotIn('cloudformation describe-stacks',self.keys(r))
    def test_T002_10_no_change_and_missing_bucket_are_valid(self):
        r=self.run_script(WAVE1_NO_CHANGE='1',WAVE1_BUCKET='missing');self.assertTrue(r['success'],r['output']);self.assertIn('s3api create-bucket',self.keys(r))
        r=self.run_script(WAVE1_BUCKET='denied');self.assertFalse(r['success'],r['output']);self.assertNotIn('s3api create-bucket',self.keys(r))
    def test_T002_11_waiter_timeout_fails(self):self.failure('elasticbeanstalk wait environment-updated','elasticbeanstalk describe-environments')
    def test_T002_12_red_or_failed_application_health_rejected(self):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            for settings in [{'WAVE1_HEALTH':'Red'},{'WAVE1_APP_HEALTH':'DOWN'}]:
                r=self.run_script(script,**settings);self.assertFalse(r['success'],r['output'])
    def test_T002_13_wrong_version_rejected(self):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            r=self.run_script(script,WAVE1_VERSION='wrong');self.assertFalse(r['success'],r['output'])
    def test_T002_14_successful_deploy_and_redeploy(self):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            r=self.run_script(script);self.assertTrue(r['success'],r['output']);self.assertIn('elasticbeanstalk describe-environments',self.keys(r))
    def test_T002_15_failures_do_not_print_secrets(self):
        scenarios=[('deploy_aws.ps1', key, {}) for key in ['git','elasticbeanstalk list-available-solution-stacks','maven','npm-ci','vite-build','builder-eb','builder-lambda','s3api head-bucket','s3 cp','cloudformation deploy','cloudformation describe-stacks','cloudformation describe-stack-resource','elasticbeanstalk wait environment-updated','elasticbeanstalk describe-environments']]
        scenarios += [('deploy_aws.ps1', key, {'WAVE1_BUCKET':'missing'}) for key in ['s3api create-bucket','s3api put-public-access-block','s3api put-bucket-encryption']]
        scenarios += [('deploy_aws.ps1','cloudformation deploy',{'WAVE1_FAIL_NTH':str(n)}) for n in [2,3]]
        scenarios += [('deploy_aws.ps1','s3 cp',{'WAVE1_FAIL_NTH':'2'})]
        scenarios += [('redeploy_aws.ps1',key,{}) for key in ['sts get-caller-identity','elasticbeanstalk create-application-version','elasticbeanstalk update-environment','elasticbeanstalk wait environment-updated','elasticbeanstalk describe-environments']]
        for script,key,settings in scenarios:
            with self.subTest(script=script,key=key,settings=settings):
                r=self.run_script(script,WAVE1_FAIL=key,**settings)
                self.assertFalse(r['success'],r['output']);self.assertNotIn(SECRET,r['output'])
                self.assertNotIn('Deployment finished',r['output']);self.assertNotIn('Redeploy complete',r['output'])
    def test_T002_16_windows_powershell_native_failure(self):
        r=self.run_script(engine='powershell',WAVE1_FAIL='npm-ci');self.assertTrue(r['engine'].startswith('5.1.'));self.assertFalse(r['success']);self.assertNotIn('vite-build',self.keys(r))
    def test_T002_17_powershell7_native_failure(self):
        r=self.run_script(engine='pwsh',WAVE1_FAIL='npm-ci');self.assertTrue(r['engine'].startswith('7.'));self.assertFalse(r['success']);self.assertNotIn('vite-build',self.keys(r))
    def test_T002_18_only_fixture_tools_are_resolved(self):
        r=self.run_script();self.assertTrue(r['success'],r['output']);self.assertGreater(len(r['trace']),10)
        self.assertTrue(all(x['cwd'].startswith(str(Path(tempfile.gettempdir()))) for x in r['trace']))
    def test_T002_19_failed_build_never_uploads_stale_artifact(self):self.failure('vite-build','s3 cp')
    def test_T002_20_working_directory_restored_on_failure(self):
        for script in ['deploy_aws.ps1','redeploy_aws.ps1']:
            r=self.run_script(script,WAVE1_FAIL='npm-ci');self.assertFalse(r['success']);self.assertEqual(r['before'],r['after'])
if __name__=='__main__':unittest.main(verbosity=2)
