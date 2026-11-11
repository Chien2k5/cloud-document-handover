"""Small Wave 2 fixtures: owned PostgreSQL 17 and a strict in-memory S3 boundary."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import uuid
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'ops'))
class S3Error(Exception):
    def __init__(self,code='NoSuchKey',status=404):
        self.response={'Error':{'Code':code},'ResponseMetadata':{'HTTPStatusCode':status}}
        super().__init__(code)

def _forbidden_client(*args,**kwargs):raise AssertionError('Real AWS SDK calls are forbidden in Wave 2 tests')
boto=types.ModuleType('boto3');boto.client=_forbidden_client
botocore=types.ModuleType('botocore');config=types.ModuleType('botocore.config');config.Config=lambda **kwargs:kwargs
exceptions=types.ModuleType('botocore.exceptions');exceptions.ClientError=S3Error
with patch.dict(sys.modules,{'boto3':boto,'botocore':botocore,'botocore.config':config,'botocore.exceptions':exceptions}):
 import backup_db_to_s3 as backup
 import restore_db_from_s3 as restore
from test_verify_isolation import runner

class MemoryS3:
    def __init__(self):
        self.objects={};self.calls=[];self.fail=None;self.version_missing=False;self.sequence=0
    def put_object(self,**kw):
        self.calls.append(('put',dict(kw,Body='<bytes>')))
        kind='manifest' if kw['Key'].endswith('.json') else 'dump'
        if self.fail==kind:raise S3Error('ServiceUnavailable',503)
        self.sequence+=1;version=f'v-{self.sequence}'
        body=kw['Body'];body=body.read() if hasattr(body,'read') else body
        self.objects[(kw['Bucket'],kw['Key'],version)]=bytes(body)
        self.objects[(kw['Bucket'],kw['Key'],None)]=bytes(body)
        return {'VersionId':None if self.version_missing else version,'ServerSideEncryption':'AES256'}
    def get_object(self,**kw):
        self.calls.append(('get',kw.copy()))
        ref=(kw['Bucket'],kw['Key'],kw.get('VersionId'))
        if ref not in self.objects:raise S3Error()
        body=self.objects[ref]
        return {'Body':io.BytesIO(body),'ContentLength':len(body),'VersionId':kw.get('VersionId')}
    def head_object(self,**kw):
        self.calls.append(('head',kw.copy()))
        ref=(kw['Bucket'],kw['Key'],kw.get('VersionId'))
        if ref not in self.objects:raise S3Error('NoSuchVersion',404)
        return {'ContentLength':len(self.objects[ref]),'VersionId':kw.get('VersionId')}

class Postgres:
    def __enter__(self):
        self.owner=runner.OwnedStack(uuid.uuid4().hex);self.owner.__enter__()
        self.container=self.owner.create_container('postgres',['--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust'],'postgres:17-alpine')
        try:
            subprocess.check_output(['docker','start',self.container])
            runner.wait_ready(lambda:subprocess.run(['docker','exec',self.container,'pg_isready','-q','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0,'Wave 2 PostgreSQL',timeout=45)
            self.port=runner.docker_port(self.container,5432)
            self.version=self.query('postgres','SHOW server_version;');assert self.version.startswith('17.'),self.version
            return self
        except BaseException:
            self.owner.cleanup();raise
    def __exit__(self,*args):self.owner.cleanup()
    def query(self,db,sql):
        command=['docker','exec','-i',self.container,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db]
        proc=subprocess.run(command,input=sql,text=True,encoding='utf-8',capture_output=True)
        if proc.returncode:raise RuntimeError('Fixture psql failed: '+proc.stderr)
        return proc.stdout.strip()
    def database(self,seed=True):
        name='w2_'+uuid.uuid4().hex
        self.query('postgres',f'CREATE DATABASE {name};')
        if seed:self.seed(name)
        return name
    def seed(self,db):
        ddl=(ROOT/'backend/src/main/resources/db/migration/V1__initial_schema.sql').read_text(encoding='utf-8')
        self.query(db,ddl)
        self.query(db,"""CREATE TABLE flyway_schema_history(installed_rank integer PRIMARY KEY,version varchar(50),description varchar(200) NOT NULL,type varchar(20) NOT NULL,script varchar(1000) NOT NULL,checksum integer,installed_by varchar(100) NOT NULL,installed_on timestamp NOT NULL DEFAULT now(),execution_time integer NOT NULL,success boolean NOT NULL);
INSERT INTO flyway_schema_history VALUES(1,'1','initial schema','SQL','V1__initial_schema.sql',1,'postgres','2026-11-01',1,true);
INSERT INTO app_users(id,email,display_name,password_hash) VALUES('00000000-0000-0000-0000-000000000001','owner@fixture.test','Owner','fixture-only'),('00000000-0000-0000-0000-000000000002','viewer@fixture.test','Viewer','fixture-only');
INSERT INTO projects(id,name,created_by,quota_bytes) VALUES('00000000-0000-0000-0000-00000000000a','Fixture','00000000-0000-0000-0000-000000000001',1073741824);
INSERT INTO memberships VALUES('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001','OWNER',now());
INSERT INTO file_metadata(id,project_id,filename,created_by) VALUES('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-00000000000a','a.pdf','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-00000000000a','b.pdf','00000000-0000-0000-0000-000000000001');""")
        for i,body in enumerate([b'abc',b'def']):
            digest=hashlib.sha256(body).hexdigest();fid=str(uuid.UUID(int=20+i));vid=str(uuid.UUID(int=30+i))
            self.query(db,f"INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,s3_version_id,content_type,size_bytes,expected_sha256,actual_sha256,upload_status,integrity_status,created_by) VALUES('{vid}','{fid}','{uuid.UUID(int=10)}','fixture-bucket','uploads/{i}','version-{i}','application/pdf',3,'{digest}','{digest}','AVAILABLE','VERIFIED','{uuid.UUID(int=1)}');")
        self.query(db,f"""INSERT INTO handovers(id,project_id,title,status,created_by,expires_at,published_at) VALUES('{uuid.UUID(int=40)}','{uuid.UUID(int=10)}','Pinned','READY','{uuid.UUID(int=1)}',now()+interval '1 day',now());
INSERT INTO handover_items VALUES('{uuid.UUID(int=40)}','{uuid.UUID(int=10)}','{uuid.UUID(int=31)}'),('{uuid.UUID(int=40)}','{uuid.UUID(int=10)}','{uuid.UUID(int=30)}');
INSERT INTO handover_recipients(handover_id,user_id) VALUES('{uuid.UUID(int=40)}','{uuid.UUID(int=2)}');
INSERT INTO audit_events(id,project_id,actor_id,action,target_id,request_id) VALUES('{uuid.UUID(int=50)}','{uuid.UUID(int=10)}','{uuid.UUID(int=1)}','FIXTURE','{uuid.UUID(int=40)}','fixture-request');""")
    def snapshot(self,db):return backup.snapshot_tables(self.container,'127.0.0.1',5432,'postgres',db,'')
    def restore_dump(self,data):
        target=self.database(False)
        proc=subprocess.run(['docker','exec','-i',self.container,'pg_restore','--no-owner','--no-acl','--single-transaction','--exit-on-error','-U','postgres','-d',target],input=data,capture_output=True)
        if proc.returncode:raise RuntimeError('Fixture pg_restore failed: '+proc.stderr.decode())
        return target

@contextlib.contextmanager
def backup_run(pg,db,s3=None,host_mode=False):
    s3=s3 or MemoryS3()
    with tempfile.TemporaryDirectory(prefix='wave2-',dir=ROOT/'ops/tests') as temporary:
        folder=Path(temporary);output=io.StringIO()
        args=['--pg-container','' if host_mode else pg.container,'--host','127.0.0.1','--port',str(pg.port),'--user','postgres','--dbname',db,'--backup-bucket','backup-fixture','--endpoint-url','http://localhost:4566','--evidence-out',str(folder/'manifest.json')]
        with patch.object(backup,'ROOT',folder),patch.object(backup,'s3_client',return_value=s3),patch.dict(os.environ,{'PGPASSWORD':'fixture-dummy-only'}),contextlib.redirect_stdout(output):
            backup.main(args) if 'argv' in __import__('inspect').signature(backup.main).parameters else _legacy_main(args)
        manifest=json.loads((folder/'manifest.json').read_text())
        data=s3.objects[(manifest['backupBucket'],manifest['backupKey'],manifest['backupS3VersionId'])]
        yield manifest,data,s3,folder,output.getvalue()

def _legacy_main(args):
    with patch.object(sys,'argv',['backup_db_to_s3.py',*args]):backup.main()
