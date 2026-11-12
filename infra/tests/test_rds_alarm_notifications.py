"""F010: offline expression/reference checks, never an AWS notification delivery test."""
import copy,fnmatch,json,re,subprocess,unittest
from pathlib import Path
from wave3_support import Loader
import yaml
ROOT=Path(__file__).resolve().parents[2]
BASELINE='b1e87f2d66c2473e709b3fc66056207a6793455d'
RDSES={'DbLowStorageAlarm','DbHighConnectionsAlarm'}
def load(name,baseline=False):
    path='infra/cloudformation/'+name
    text=subprocess.check_output(['git','show',BASELINE+':'+path],cwd=ROOT,text=True,encoding='utf-8') if baseline else (ROOT/path).read_text(encoding='utf-8')
    return yaml.load(text,Loader=Loader)

class View:
    """Resolve only the CloudFormation intrinsics needed for the notification contract."""
    def __init__(self,doc,overrides=None,exports=None):
        self.doc=doc;self.params={k:v.get('Default','') for k,v in doc['Parameters'].items()}
        self.params.update({'AWS::AccountId':'000000000000','AWS::Region':'us-east-1','AWS::Partition':'aws','AWS::StackName':'fixture-storage','AWS::NoValue':None})
        self.params.update(overrides or {});self.exports=exports or {};self.imports=[]
        for name,definition in doc['Parameters'].items():
            value=self.params[name]
            if 'AllowedValues' in definition and value not in definition['AllowedValues']:raise ValueError('Invalid parameter '+name)
            if 'AllowedPattern' in definition and not re.fullmatch(definition['AllowedPattern'],str(value)):raise ValueError('Invalid parameter '+name)
    def condition(self,name):return self.value(self.doc['Conditions'][name])
    def active(self,name):return 'Condition' not in self.doc['Resources'][name] or self.condition(self.doc['Resources'][name]['Condition'])
    def value(self,node):
        if isinstance(node,list):return [v for item in node if (v:=self.value(item)) is not None]
        if not isinstance(node,dict):return node
        if len(node)==1:
            kind,data=next(iter(node.items()))
            if kind=='Ref':
                if data in self.params:return self.params[data]
                if not self.active(data):raise ValueError('Inactive resource '+data)
                if self.doc['Resources'][data]['Type']=='AWS::SNS::Topic':return 'arn:aws:sns:us-east-1:000000000000:fixture-alerts'
                return data
            if kind=='Fn::GetAtt':
                if not self.active(data[0]):raise ValueError('Inactive resource '+data[0])
                return 'fixture-'+'.'.join(data)
            if kind=='Fn::Sub':return re.sub(r'[$]{([^}]+)}',lambda m:str(self.value({'Fn::GetAtt':m[1].split('.')} if '.' in m[1] else {'Ref':m[1]})),data)
            if kind=='Fn::Equals':return self.value(data[0])==self.value(data[1])
            if kind=='Fn::Not':return not self.value(data[0])
            if kind=='Fn::If':return self.value(data[1] if self.condition(data[0]) else data[2])
            if kind=='Fn::ImportValue':
                name=self.value(data);self.imports.append(name)
                if not self.exports.get(name):raise ValueError('Missing/empty export '+name)
                return self.exports[name]
        return {k:v for k,item in node.items() if (v:=self.value(item)) is not None}
    def outputs(self):return {self.value(o['Export']['Name']):self.value(o['Value']) for o in self.doc.get('Outputs',{}).values() if 'Export' in o}
    def alarm(self,name):return self.value(self.doc['Resources'][name]['Properties'])

def pair(email='',enabled='false',mode='true'):
    storage=View(load('00-storage.yaml'),dict(AlarmEmail=email,UseLabRole=mode,BackupOperatorPrincipalArn='arn:aws:iam::000000000000:role/fixture-operator'))
    app=View(load('01-rds-beanstalk-cloudfront.yaml'),dict(EnableRdsAlarmNotifications=enabled,StorageStackName='fixture-storage'),storage.outputs())
    return storage,app

def check_refs(doc):
    names=set(doc['Parameters'])|set(doc['Resources']);pseudo={'AWS::AccountId','AWS::Region','AWS::Partition','AWS::StackName','AWS::NoValue','AWS::URLSuffix','AWS::NotificationARNs','AWS::StackId'}
    def walk(node):
        if isinstance(node,list):
            for item in node:walk(item)
        elif isinstance(node,dict):
            if 'Ref' in node:assert node['Ref'] in names|pseudo,node
            if 'Fn::GetAtt' in node:assert node['Fn::GetAtt'][0] in doc['Resources'],node
            if 'Fn::If' in node:assert node['Fn::If'][0] in doc.get('Conditions',{}),node
            if 'Fn::Sub' in node:
                text=node['Fn::Sub'];assert isinstance(text,str)
                for var in re.findall(r'[$]{([^}]+)}',text):assert var.split('.')[0] in names|pseudo or var.startswith('!'),var
            for item in node.values():walk(item)
    walk(doc)

class RdsNotificationTests(unittest.TestCase):
    def test_TC_F010_01_identify_two_rds_alarms(self):
        resources=load('01-rds-beanstalk-cloudfront.yaml')['Resources']
        actual={k for k,v in resources.items() if v['Type']=='AWS::CloudWatch::Alarm' and v['Properties']['Namespace']=='AWS/RDS'}
        self.assertEqual(actual,RDSES)
        self.assertEqual({resources[k]['Properties']['MetricName'] for k in actual},{'FreeStorageSpace','DatabaseConnections'})
    def test_TC_F010_02_enabled_reuses_exported_sns(self):
        storage,app=pair('alerts@example.invalid','true');topic=storage.outputs()['fixture-storage-AlarmTopic']
        self.assertRegex(topic,r'^arn:aws:sns:us-east-1:000000000000:')
        for name in RDSES:
            alarm=app.alarm(name);self.assertEqual(alarm['AlarmActions'],[topic]);self.assertIs(alarm['ActionsEnabled'],True)
    def test_TC_F010_03_references_and_missing_export(self):
        for name in ['00-storage.yaml','01-rds-beanstalk-cloudfront.yaml']:check_refs(load(name))
        storage,app=pair('alerts@example.invalid','true');app.exports={}
        with self.assertRaisesRegex(ValueError,'Missing/empty export'):app.alarm('DbLowStorageAlarm')
    def test_TC_F010_04_existing_alarm_actions_and_metrics_preserved(self):
        old=load('00-storage.yaml',True);new=load('00-storage.yaml')
        for name,res in old['Resources'].items():
            if res['Type']=='AWS::CloudWatch::Alarm':self.assertEqual(new['Resources'][name],res,name)
        old=load('01-rds-beanstalk-cloudfront.yaml',True);new=load('01-rds-beanstalk-cloudfront.yaml')
        for name in RDSES:
            props=copy.deepcopy(new['Resources'][name]['Properties'])
            props.pop('AlarmActions',None);props.pop('ActionsEnabled',None)
            self.assertEqual(props,old['Resources'][name]['Properties'])
    def test_TC_F010_05_only_expected_resources(self):
        for name in ['00-storage.yaml','01-rds-beanstalk-cloudfront.yaml']:
            old=load(name,True)['Resources'];new=load(name)['Resources']
            self.assertEqual(set(new)-set(old),{'AlarmTopicPolicy'} if name.startswith('00') else set())
            for logical,resource in old.items():
                if name.startswith('01') and logical in RDSES:continue
                self.assertEqual(new[logical],resource,logical)
            self.assertEqual(sum(r['Type']=='AWS::SNS::Topic' for r in new.values()),1 if name.startswith('00') else 0)
    def test_TC_F010_06_optional_branches_and_invalid_configuration(self):
        for mode in ['true','false']:
            for email,enabled in [('', 'false'),('alerts@example.invalid','true'),('alerts@example.invalid','false')]:
                with self.subTest(mode=mode,enabled=enabled):
                    storage,app=pair(email,enabled,mode)
                    self.assertEqual(storage.active('AlarmTopic'),bool(email));self.assertEqual(storage.active('AlarmTopicPolicy'),bool(email))
                    for name in RDSES:
                        alarm=app.alarm(name);self.assertEqual(alarm['ActionsEnabled'],enabled=='true')
                        if enabled=='false':self.assertNotIn('AlarmActions',alarm)
                    if enabled=='false':self.assertEqual(app.imports,[])
        storage,app=pair('', 'true')
        with self.assertRaisesRegex(ValueError,'Missing/empty export'):app.alarm('DbLowStorageAlarm')
        for email in ['not-an-email','a@@example.invalid','x y@example.invalid','a@example.invalid,b@example.invalid']:
            with self.subTest(email=email),self.assertRaises(ValueError):pair(email,'true')
        with self.assertRaises(ValueError):pair('','yes')
    def test_TC_F010_07_duration_alarm_unchanged(self):
        old=load('00-storage.yaml',True);new=load('00-storage.yaml')
        self.assertEqual(new['Resources']['ChecksumDurationAlarm'],old['Resources']['ChecksumDurationAlarm'])
        self.assertEqual(new['Parameters']['LambdaTimeoutSeconds'],old['Parameters']['LambdaTimeoutSeconds'])
        self.assertEqual(new['Parameters']['LambdaDurationAlarmThresholdMs']['Default'],96000)
    def test_TC_F010_08_bounded_publish_policy_and_no_hardcoded_recipient(self):
        for name in ['00-storage.yaml','01-rds-beanstalk-cloudfront.yaml']:
            text=(ROOT/'infra/cloudformation'/name).read_text();self.assertNotRegex(text,r'arn:aws:[^\s]*:[0-9]{12}:')
        storage,app=pair('alerts@example.invalid','true')
        topic=storage.value({'Ref':'AlarmTopic'})
        policy=storage.value(storage.doc['Resources']['AlarmTopicPolicy']['Properties'])
        self.assertEqual(policy['Topics'],[topic]);statements=policy['PolicyDocument']['Statement'];self.assertEqual(len(statements),1)
        statement=statements[0];self.assertEqual(statement['Principal'],{'Service':'cloudwatch.amazonaws.com'});self.assertEqual(statement['Action'],'sns:Publish');self.assertEqual(statement['Resource'],topic)
        self.assertEqual(statement['Condition']['StringEquals']['aws:SourceAccount'],'000000000000')
        pattern=statement['Condition']['ArnLike']['aws:SourceArn'];self.assertTrue(fnmatch.fnmatchcase('arn:aws:cloudwatch:us-east-1:000000000000:alarm:fixture',pattern))
        self.assertFalse(fnmatch.fnmatchcase('arn:aws:cloudwatch:us-west-2:111111111111:alarm:fixture',pattern))
        doc=storage.doc;self.assertEqual(doc['Parameters']['AlarmEmail']['Default'],'')
        self.assertEqual(doc['Resources']['AlarmTopic']['Properties']['Subscription'],[{'Protocol':'email','Endpoint':{'Ref':'AlarmEmail'}}])
if __name__=='__main__':unittest.main(verbosity=2)
