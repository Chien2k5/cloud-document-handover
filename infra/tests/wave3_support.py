"""Local CloudFormation/IAM model: explicit subset, never AWS policy simulation."""
import copy,fnmatch,json,re,subprocess,sys,unittest,uuid,time,hashlib,inspect
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[2]
BASELINE='ee31cb9cb8bb7ce3f4518aa4b8c3db3b9d4a4d2b'
OPERATOR='arn:aws:iam::111122223333:role/fixture-human-operator'
class Loader(yaml.SafeLoader):pass
def tag(loader,name,node):
    value=loader.construct_scalar(node) if isinstance(node,yaml.ScalarNode) else loader.construct_sequence(node,deep=True) if isinstance(node,yaml.SequenceNode) else loader.construct_mapping(node,deep=True)
    if name=='GetAtt' and isinstance(value,str):value=value.split('.')
    return {name if name in ['Ref','Condition'] else 'Fn::'+name:value}
Loader.add_multi_constructor('!',tag)
def template(name='00-storage.yaml',baseline=False):
    path='infra/cloudformation/'+name
    raw=subprocess.check_output(['git','show',BASELINE+':'+path],cwd=ROOT,text=True,encoding="utf-8") if baseline else (ROOT/path).read_text()
    return yaml.load(raw,Loader=Loader)
def values(value):return value if isinstance(value,list) else [value]
class Graph:
    def __init__(self,mode='false',operator=OPERATOR,document=None):
        self.doc=copy.deepcopy(document or template());self.params={k:v.get('Default','') for k,v in self.doc['Parameters'].items()}
        self.params.update(UseLabRole=mode,BackupOperatorPrincipalArn=operator,**{'AWS::AccountId':'111122223333','AWS::Region':'us-east-1','AWS::StackName':'fixture-storage','AWS::NoValue':None})
        self.resources={}
        for name,resource in self.doc['Resources'].items():
            if 'Condition' not in resource or self.eval(self.doc['Conditions'][resource['Condition']]):self.resources[name]=resource
    def eval(self,node):
        if isinstance(node,list):return [self.eval(v) for v in node if self.eval(v) is not None]
        if not isinstance(node,dict):return node
        if len(node)==1:
            kind,value=next(iter(node.items()))
            if kind=='Ref':
                if value in self.params:return self.params[value]
                resource=self.resources[value];return self.eval(resource['Properties'].get('RoleName',resource['Properties'].get('BucketName',value)))
            if kind=='Fn::GetAtt':
                name,attribute=value;resource=self.resources[name];rtype=resource['Type']
                if rtype=='AWS::IAM::Role':return 'arn:aws:iam::111122223333:role/'+self.eval({'Ref':name})
                if rtype=='AWS::S3::Bucket':return 'arn:aws:s3:::'+self.eval({'Ref':name})
                return 'fixture-'+name+'-'+attribute
            if kind=='Fn::Sub':
                assert isinstance(value,str),'Only scalar Sub modeled'
                return re.sub(r'[$]{([^}]+)}',lambda m:str(self.eval({'Fn::GetAtt':m[1].split('.')} if '.' in m[1] else {'Ref':m[1]})),value)
            if kind=='Fn::Equals':return self.eval(value[0])==self.eval(value[1])
            if kind=='Fn::Not':return not self.eval(value[0])
            if kind=='Fn::Or':return any(self.eval(v) for v in value)
            if kind=='Fn::And':return all(self.eval(v) for v in value)
            if kind=='Fn::If':return self.eval(value[1] if self.eval(self.doc['Conditions'][value[0]]) else value[2])
        return {k:self.eval(v) for k,v in node.items()}
    def validate(self):
        for name,definition in self.doc['Parameters'].items():
            if 'AllowedPattern' in definition and not re.fullmatch(definition['AllowedPattern'],str(self.params[name])):raise ValueError(name+' invalid')
        for rule in self.doc.get('Rules',{}).values():
            if 'RuleCondition' not in rule or self.eval(rule['RuleCondition']):
                for assertion in rule['Assertions']:
                    if not self.eval(assertion['Assert']):raise ValueError(assertion['AssertDescription'])
    def role(self,name):return self.eval(self.resources[name]['Properties'])
    def statements(self,name):return [s for policy in self.role(name).get('Policies',[]) for s in policy['PolicyDocument']['Statement']]
    def can_assume(self,source,target):
        arn=self.eval({'Fn::GetAtt':[target,'Arn']});source_arn=self.eval({'Fn::GetAtt':[source,'Arn']})
        identity=decision(self.statements(source),'sts:AssumeRole',arn)
        trust=decision(self.role(target)['AssumeRolePolicyDocument']['Statement'],'sts:AssumeRole',arn,source_arn)
        return identity=='Allow' and trust=='Allow'
def decision(statements,action,resource,principal=None):
    matches=[]
    for statement in statements:
        if not any(fnmatch.fnmatchcase(action,a) for a in values(statement['Action'])):continue
        if 'Resource' in statement and not any(fnmatch.fnmatchcase(resource,r) for r in values(statement['Resource'])):continue
        if 'Principal' in statement:
            p=statement['Principal'];p=p.get('AWS',p) if isinstance(p,dict) else p
            if principal not in values(p) and '*' not in values(p):continue
        condition=statement.get('Condition',{})
        if any(principal==value for value in condition.get('ArnNotEquals',{}).values()):continue
        if any(principal!=value for value in condition.get('ArnEquals',{}).values()):continue
        matches.append(statement['Effect'])
    return 'Deny' if 'Deny' in matches else 'Allow' if 'Allow' in matches else 'ImplicitDeny'

def run_tests(module,label,environment=None):
    class Results(unittest.TextTestResult):
        records=[]
        def save(self,test,status,actual):
            method=getattr(test,test._testMethodName);match=re.search(r'T\d{3}_\d{2}',test.id())
            if match:self.records.append(dict(testId=match[0].replace('_','-'),function=test.id(),file=inspect.getfile(method),line=inspect.getsourcelines(method)[1],requirement=method.__doc__ or method.__name__,inputAndAssertions=inspect.getsource(method),actual=actual,status=status))
        def addSuccess(self,test):super().addSuccess(test);self.save(test,'PASS','Executed assertions passed')
        def addFailure(self,test,error):super().addFailure(test,error);self.save(test,'FAIL',self._exc_info_to_string(error,test))
        def addError(self,test,error):super().addError(test,error);self.save(test,'FAIL',self._exc_info_to_string(error,test))
        def addSkip(self,test,reason):super().addSkip(test,reason);self.save(test,'BLOCKED',reason)
    started=time.time();result=unittest.TextTestRunner(verbosity=2,resultclass=Results).run(unittest.defaultTestLoader.loadTestsFromName(module))
    code=0 if result.wasSuccessful() and not result.skipped else 1
    paths=[p for folder in ['infra/cloudformation','infra/iam','infra/tests','deploy/tests'] for p in (ROOT/folder).glob('*') if p.is_file() and p.suffix in ['.py','.json','.yaml','.ps1']]
    paths += [ROOT/'deploy/deploy_aws.ps1',ROOT/'deploy/redeploy_aws.ps1',ROOT/'deploy/build_eb_bundle.py',ROOT/'infra/README.md']
    paths += list((ROOT/'deploy/eb/certs').glob('*'))+[ROOT/'deploy/tests/requirements-security.txt',ROOT/'deploy/tests/JdbcTlsProbe.java',ROOT/'deploy/README.md',ROOT/'backend/pom.xml',ROOT/'backend/src/main/resources/application.yml',ROOT/'backend/src/main/resources/db/migration/V1__initial_schema.sql']
    paths=list(dict.fromkeys(p for p in paths if p.is_file()))
    resources=[]
    support=sys.modules.get('wave2_support')
    if support:
        for pg in support.Postgres.instances:
            removed=subprocess.run(['docker','inspect',pg.container],capture_output=True).returncode!=0
            resources.append(dict(container=pg.container,version=getattr(pg,'version','UNKNOWN'),removed=removed))
            if not removed:code=1
    runtime={}
    for cls in vars(sys.modules[module]).values():
        if isinstance(cls,type) and hasattr(cls,'fixture'):
            f=cls.fixture;runtime['pgjdbc']=getattr(f,'jdbc_version','UNKNOWN');runtime['java']=getattr(f,'java_version','UNKNOWN')
    if resources:
        runtime['docker']=subprocess.check_output(['docker','version','--format','{{.Server.Version}}'],text=True,encoding='utf-8').strip()
    report=dict(head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True,encoding="utf-8").strip(),workingTree=subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding="utf-8"),workspace=str(ROOT),command=[sys.executable,*sys.argv],environment=environment or 'Local CloudFormation/IAM subset model only; no AWS effective permissions claim',resources=resources,runtime=runtime,sourceHashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},python=sys.version,timestamp=time.strftime('%Y-%m-%dT%H:%M:%S%z'),durationSeconds=time.time()-started,exitCode=code,cases=result.records,testsRun=result.testsRun,failed=len(result.failures)+len(result.errors),blocked=len(result.skipped),aws='NOT_RUN')
    path=ROOT/'infra/tests'/f'{label}-{uuid.uuid4().hex}.log';path.write_text(json.dumps(report,indent=2),encoding='utf-8');print('EVIDENCE='+str(path));return code
