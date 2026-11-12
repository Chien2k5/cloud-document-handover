"""Native process boundary for deploy tests. Never imports an AWS SDK or opens sockets."""
import json, os, sys
from pathlib import Path
root=Path(os.environ['WAVE1_FIXTURE'])
tool=sys.argv[1]; args=sys.argv[2:]
if tool=='aws':
    key=' '.join(args[:3]) if args[:2]==['elasticbeanstalk','wait'] else ' '.join(args[:2])
elif tool=='python':
    key='builder-lambda' if 'lambda' in args[0] else 'builder-eb'
elif tool=='npm': key='npm-ci'
elif tool=='npx': key='vite-build'
else: key=tool
history=[json.loads(x) for x in (root/'trace.jsonl').read_text().splitlines()] if (root/'trace.jsonl').exists() else []
occurrence=1+sum(x['key']==key for x in history)
with (root/'trace.jsonl').open('a',encoding='utf-8') as f:
    f.write(json.dumps({'key':key,'cwd':str(Path.cwd()),'args':[x.replace(os.environ.get('DB_MASTER_PASSWORD','unused'), '[REDACTED]') for x in args]})+'\n')
if key==os.environ.get('WAVE1_FAIL') and occurrence==int(os.environ.get('WAVE1_FAIL_NTH','1')):
    print(os.environ.get('DB_MASTER_PASSWORD','fixture')+' injected stdout')
    print(os.environ.get('DB_MASTER_PASSWORD','fixture')+' injected stderr',file=sys.stderr)
    sys.exit(42)
if key=='git': print('c3ddf191c322');sys.exit(0)
if key.startswith('builder-'):
    if os.environ.get('WAVE1_NO_ARTIFACT') != key:
        target=Path(args[args.index('--output')+1]) if '--output' in args else root/'output'/('lambda-checksum.zip' if key=='builder-lambda' else 'eb-release.zip')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'fixture-current-artifact')
    sys.exit(0)
if tool!='aws': sys.exit(0)
if key=='sts get-caller-identity': print(json.dumps({'Account':'000000000000','Arn':'arn:aws:iam::000000000000:role/fixture'}))
elif key=='elasticbeanstalk list-available-solution-stacks': print(json.dumps({'SolutionStacks':['64bit Amazon Linux 2023 v4.10.0 running Corretto 21']}))
elif key=='s3api head-bucket':
    mode=os.environ.get('WAVE1_BUCKET','exists')
    if mode!='exists':
        print('An error occurred (404) when calling the HeadBucket operation: Not Found' if mode=='missing' else 'An error occurred (403): Forbidden',file=sys.stderr);sys.exit(254)
elif key=='cloudformation describe-stacks':
    print('https://fixture.invalid/portal/' if 'PortalHttpsUrl' in ' '.join(args) else 'https://fixture.invalid')
elif key=='cloudformation describe-stack-resource': print('cf-version-fixture')
elif key=='elasticbeanstalk create-application-version':
    (root/'version.txt').write_text(args[args.index('--version-label')+1])
elif key=='elasticbeanstalk describe-environments':
    version=(root/'version.txt').read_text() if (root/'version.txt').exists() else 'cf-version-fixture'
    if os.environ.get('WAVE1_VERSION')=='wrong':version='wrong-release'
    info={'Status':'Ready','Health':os.environ.get('WAVE1_HEALTH','Green'),'VersionLabel':version,'EndpointURL':'origin.fixture.invalid'}
    print(json.dumps(info))
elif key=='cloudformation deploy' and os.environ.get('WAVE1_NO_CHANGE')=='1': print('No changes to deploy. Stack is up to date')
