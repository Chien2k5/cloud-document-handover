"""F009 configuration assertions. cfn-lint is a separate mandatory gate."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
PATH=ROOT/'infra/cloudformation/00-storage.yaml'
BASELINE=subprocess.check_output(['git','show','c3ddf191c322c54348543259c88b36288e40d280:infra/cloudformation/00-storage.yaml'],cwd=ROOT,text=True)
THRESHOLD='LambdaDurationAlarmThresholdMs'

def entries(text, section):
    part=re.search(r'^'+section+r':\n(.*?)(?=^\S|\Z)',text,re.M|re.S).group(1)
    matches=list(re.finditer(r'^  ([A-Za-z0-9]+):\s*\n',part,re.M))
    return {m.group(1):part[m.start():matches[i+1].start() if i+1<len(matches) else len(part)] for i,m in enumerate(matches)}

def scalar(block, name):
    return re.search(r'^\s+'+name+r':\s*(.+)$',block,re.M).group(1).split(' #',1)[0].strip()

def defaults(text):
    values={}
    for name,block in entries(text,'Parameters').items():
        match=re.search(r'^    Default:\s*(.+)$',block,re.M)
        if match:
            try:values[name]=float(match.group(1))
            except ValueError:pass
    return values

def threshold_ms(text, **overrides):
    values=defaults(text);values.update(overrides)
    value=scalar(entries(text,'Resources')['ChecksumDurationAlarm'],'Threshold')
    if value.startswith('!Ref '):return values[value.split()[1]]
    if value.startswith('!Sub '):
        raw=value[len('!Sub '):].strip('"')
        for name,number in values.items():raw=raw.replace('${'+name+'}',str(int(number)))
        return float(raw)
    return float(value)

def validate_pair(timeout_seconds, threshold_milliseconds):
    if threshold_milliseconds != timeout_seconds * 800:
        raise ValueError('Threshold must be timeout seconds * 800 milliseconds')

class DurationAlarmTests(unittest.TestCase):
    def setUp(self):self.text=PATH.read_text(encoding='utf-8')
    def test_T009_01_default_120_seconds_is_96000_ms(self):
        self.assertEqual(defaults(self.text)['LambdaTimeoutSeconds'],120)
        self.assertEqual(threshold_ms(self.text),96000)
    def test_T009_02_millisecond_unit_is_explicit(self):
        parameter=entries(self.text,'Parameters')[THRESHOLD]
        self.assertIn('milliseconds',parameter.lower())
        alarm=entries(self.text,'Resources')['ChecksumDurationAlarm']
        self.assertEqual(scalar(alarm,'MetricName'),'Duration')
        self.assertEqual(scalar(alarm,'Namespace'),'AWS/Lambda')
    def test_T009_03_threshold_is_numeric_parameter_reference(self):
        parameter=entries(self.text,'Parameters')[THRESHOLD]
        self.assertEqual(scalar(parameter,'Type'),'Number')
        self.assertEqual(scalar(entries(self.text,'Resources')['ChecksumDurationAlarm'],'Threshold'),'!Ref '+THRESHOLD)
        self.assertIsInstance(defaults(self.text)[THRESHOLD],float)
    def test_T009_04_timeout_override_requires_matching_threshold(self):
        description=entries(self.text,'Parameters')[THRESHOLD]
        self.assertIn('800',description)
        self.assertIn('does not enforce',description)
        for seconds in [10,60,120,900]:
            actual=threshold_ms(self.text,LambdaTimeoutSeconds=seconds,**{THRESHOLD:seconds*800})
            validate_pair(seconds,actual)
        with self.assertRaisesRegex(ValueError,'Threshold'):
            validate_pair(60,threshold_ms(self.text,LambdaTimeoutSeconds=60))
    def test_T009_05_cloudformation_lint(self):
        executable=shutil.which('cfn-lint',path=str(Path(sys.executable).parent)) or shutil.which('cfn-lint')
        if executable:command=[executable]
        elif importlib.util.find_spec('cfnlint'):command=[sys.executable,'-c','from cfnlint.runner import main; main()']
        else:self.skipTest('BLOCKED: cfn-lint is not installed; installation was not authorized')
        command += ['infra/cloudformation/00-storage.yaml','infra/cloudformation/01-rds-beanstalk-cloudfront.yaml']
        proc=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
        (Path(__file__).parent/'F009-cfn-lint.log').write_text(proc.stdout+proc.stderr+'\nEXIT_CODE='+str(proc.returncode),encoding='utf-8')
        self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
    def test_T009_06_other_alarm_properties_unchanged(self):
        old=entries(BASELINE,'Resources')['ChecksumDurationAlarm'];new=entries(self.text,'Resources')['ChecksumDurationAlarm']
        strip=lambda value:re.sub(r'^      Threshold:.*\n','',value,flags=re.M)
        self.assertEqual(strip(new),strip(old))
    def test_T009_07_no_other_aws_resource_changes(self):
        # Limit the atomic-change guard to F009; 01-06 still check the live alarm.
        commit='bb6e3eec6f6e33c1deef84e3fcdc574449072c85'
        path='infra/cloudformation/00-storage.yaml'
        parent=subprocess.check_output(['git','show',commit+'^:'+path],cwd=ROOT,text=True)
        historical=subprocess.check_output(['git','show',commit+':'+path],cwd=ROOT,text=True)
        self.assertEqual(parent,BASELINE)
        old=entries(parent,'Resources');new=entries(historical,'Resources')
        self.assertEqual(set(old),set(new))
        for name in old:
            if name!='ChecksumDurationAlarm':self.assertEqual(new[name],old[name],name)
        old=entries(parent,'Parameters');new=entries(historical,'Parameters')
        self.assertEqual(set(new)-set(old),{THRESHOLD})
        for name in old:self.assertEqual(new[name],old[name],name)

if __name__=='__main__':
    program=unittest.main(verbosity=2,exit=False)
    result=program.result
    if result.failures or result.errors:sys.exit(1)
    if result.skipped:sys.exit(2)
