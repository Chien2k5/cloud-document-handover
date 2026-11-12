"""F007 behavior tests; S3 is isolated at its API boundary, never AWS."""
import contextlib,copy,hashlib,io,json,os,subprocess,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from wave2_support import ROOT,MemoryS3,S3Error,Postgres,backup,restore,backup_run

SHA=hashlib.sha256(b'abc').hexdigest()
def record(**kw):
    item=dict(id='fixture-id',bucket='fixture-bucket',object_key='uploads/0',s3_version_id='version-0',size_bytes=3,expected_sha256=SHA,actual_sha256=SHA,upload_status='AVAILABLE',integrity_status='VERIFIED')
    item.update(kw);return item

def document(row=None,**kw):
    row=row or record()
    doc=dict(schemaVersion=1,bucket=row['bucket'],objectKey=row['object_key'],versionId=row['s3_version_id'],size=row['size_bytes'],status='SUCCEEDED',actualSha256=row['actual_sha256'] or SHA,errorCode=None,processedAt='2026-11-11T00:00:00Z')
    doc.update(kw);return doc

def fixture_s3(rows,docs=None):
    s3=MemoryS3()
    for i,row in enumerate(rows):
        if row['upload_status']!='AVAILABLE':continue
        s3.objects[(row['bucket'],row['object_key'],row['s3_version_id'])]=b'abc'
        doc=document(row) if docs is None else docs[i]
        if doc is not None:
            data=doc if isinstance(doc,bytes) else json.dumps(doc).encode()
            s3.objects[(row['bucket'],restore.result_key(row['bucket'],row['object_key'],row['s3_version_id']),None)]=data
    return s3

class RestoreBoundaryTests(unittest.TestCase):
    def check_rows(self,rows,docs=None,s3=None):
        s3=s3 or fixture_s3(rows,docs)
        def query(*args):
            sql=args[-1]
            if 'row_to_json' in sql:return '\n'.join(json.dumps(row) for row in rows)
            keys=['id','bucket','object_key','s3_version_id','size_bytes','expected_sha256','actual_sha256','upload_status','integrity_status']
            return '\n'.join('|'.join('' if row[k] is None else str(row[k]) for k in keys) for row in rows)
        with patch.object(restore,'run_psql_query',side_effect=query):
            return restore.cross_check_s3_objects(s3,None,'127.0.0.1',5432,'fixture','fixture','')
    def test_T007_01_pending_missing_is_not_corruption(self):
        row=record(integrity_status='INTEGRITY_PENDING',actual_sha256=None)
        result=self.check_rows([row],[None])
        self.assertTrue(result['allMatched'])
        self.assertFalse(result.get('fullIntegrityVerified',True))
    def test_T007_13_missing_contract_field_is_rejected(self):
        doc=document();doc.pop('processedAt')
        self.assertFalse(self.check_rows([record()],[doc])['allMatched'])

    def validate(self,doc=None,row=None):
        row=row or record();doc=document(row) if doc is None else doc
        data=doc if isinstance(doc,bytes) else json.dumps(doc).encode()
        return restore.validate_checksum_document(data,row['bucket'],row['object_key'],row['s3_version_id'],row['size_bytes'])
    def invalid(self,**updates):
        with self.assertRaises(ValueError):self.validate(document(**updates))
    def test_T007_02_pending_with_result_does_not_reconcile_db(self):
        row=record(integrity_status='INTEGRITY_PENDING',actual_sha256=None);before=copy.deepcopy(row)
        result=self.check_rows([row])
        self.assertTrue(result['allMatched']);self.assertFalse(result['fullIntegrityVerified'])
        self.assertEqual(result['items'][0]['integrityVerificationStatus'],'AWAITING_RECONCILIATION');self.assertEqual(row,before)
    def test_T007_03_verified_full_evidence(self):
        result=self.check_rows([record()])
        self.assertTrue(result['allMatched']);self.assertTrue(result['fullIntegrityVerified']);self.assertEqual(result['verifiedCount'],1)
    def test_T007_04_verified_missing_result(self):
        result=self.check_rows([record()],[None]);self.assertFalse(result['allMatched']);self.assertFalse(result['fullIntegrityVerified'])
    def test_T007_05_verified_hash_disagrees_with_db(self):
        result=self.check_rows([record()],[document(actualSha256='a'*64)])
        self.assertFalse(result['allMatched']);self.assertEqual(result['checksumContractStatus'],'PASS');self.assertEqual(result['verifiedCount'],0)
    def test_T007_06_mismatch_preserved_not_verified(self):
        row=record(integrity_status='MISMATCH',expected_sha256='a'*64)
        result=self.check_rows([row]);self.assertTrue(result['allMatched']);self.assertFalse(result['fullIntegrityVerified'])
        self.assertEqual(result['mismatchCount'],1);self.assertEqual(result['items'][0]['integrityVerificationStatus'],'MISMATCH')
    def test_T007_07_mismatch_invalid_result(self):
        row=record(integrity_status='MISMATCH',expected_sha256='a'*64)
        result=self.check_rows([row],[document(row,status='BROKEN')]);self.assertFalse(result['allMatched'])
    def test_T007_08_failed_missing_not_corruption(self):
        row=record(integrity_status='FAILED',actual_sha256=None)
        result=self.check_rows([row],[None]);self.assertTrue(result['allMatched']);self.assertFalse(result['fullIntegrityVerified']);self.assertEqual(result['failedCount'],1)
    def test_T007_09_failed_result_valid_not_verified(self):
        row=record(integrity_status='FAILED',actual_sha256=None)
        result=self.check_rows([row],[document(row,status='FAILED',actualSha256=None,errorCode='FILE_TOO_LARGE')])
        self.assertTrue(result['allMatched']);self.assertEqual(result['checksumContractStatus'],'PASS');self.assertFalse(result['fullIntegrityVerified'])
        self.assertEqual(result['items'][0]['integrityVerificationStatus'],'PROCESSING_FAILED')
    def test_T007_10_non_available_states_not_eligible(self):
        for state in ['PENDING','FAILED','EXPIRED']:
            with self.subTest(state=state):
                row=record(upload_status=state,integrity_status='INTEGRITY_PENDING',actual_sha256=None,s3_version_id=None)
                s3=MemoryS3();result=self.check_rows([row],s3=s3)
                self.assertTrue(result['allMatched']);self.assertEqual(result['checkedCount'],0);self.assertEqual(s3.calls,[])
                self.assertEqual(result['items'][0]['uploadStatus'],state)
        # DB CHECK constraints are looser than backend transitions: do not invent valid combinations.
        self.assertFalse(self.check_rows([record(upload_status='PENDING')])['allMatched'])
    def test_T007_11_succeeded_contract_independent_schema_and_producer(self):
        from jsonschema import Draft202012Validator,FormatChecker
        schema=json.loads((ROOT/'contracts/checksum-result.schema.json').read_text())
        validator=Draft202012Validator(schema,format_checker=FormatChecker())
        for name in ['checksum-success.json','checksum-failed.json']:
            doc=json.loads((ROOT/'contracts/examples'/name).read_text());validator.validate(doc)
            self.assertEqual(self.validate(doc,record(bucket=doc['bucket'],object_key=doc['objectKey'],s3_version_id=doc['versionId'],size_bytes=doc['size'])),doc)
        sys.path.insert(0,str(ROOT/'aws/tests'))
        from check_java_contract import make_cases
        cases=make_cases();self.assertGreaterEqual(len(cases),25)
        for case in cases:
            with self.subTest(case=case['name']):
                row=record(bucket=case['bucket'],object_key=case['objectKey'],s3_version_id=case['versionId'],size_bytes=case['size'])
                if case['expectedHash'] is not None or case['name']=='failed-too-large':
                    decoded=self.validate(case['document'].encode(),row);validator.validate(decoded)
                else:
                    with self.assertRaises(ValueError):self.validate(case['document'].encode(),row)
    def test_T007_12_failed_contract_distinct_from_success(self):
        doc=document(status='FAILED',actualSha256=None,errorCode='FILE_TOO_LARGE')
        self.assertEqual(self.validate(doc)['status'],'FAILED')
        self.assertFalse(self.check_rows([record()],[doc])['allMatched'])
    def test_T007_14_extra_field(self):self.invalid(extra='not-allowed')
    def test_T007_15_schema_version_strict(self):
        for value in [True,False,1.0,'1',2,None,[],{}]:
            with self.subTest(value=value):self.invalid(schemaVersion=value)
    def test_T007_16_bucket_identity(self):self.invalid(bucket='other-bucket')
    def test_T007_17_object_key_identity(self):self.invalid(objectKey='uploads/wrong')
    def test_T007_18_version_identity(self):
        for version in ['wrong','','null',None]:
            with self.subTest(version=version):self.invalid(versionId=version)
    def test_T007_19_size_identity_and_range(self):
        for size in [0,-1,4,True,3.0,'3',2**63]:
            with self.subTest(size=size):self.invalid(size=size)
    def test_T007_20_hash_length(self):
        for size in [0,63,65]:self.invalid(actualSha256='a'*size)
    def test_T007_21_hash_lowercase_hex(self):
        for sha in ['A'*64,'g'*64,'a'*63+'\n']:self.invalid(actualSha256=sha)
    def test_T007_22_succeeded_error_nonnull(self):self.invalid(errorCode='NOT_NULL')
    def test_T007_23_failed_actual_nonnull(self):self.invalid(status='FAILED',actualSha256=SHA,errorCode='FAILED')
    def test_T007_24_failed_error_required(self):
        for error in [None,'',1,False,{}]:self.invalid(status='FAILED',actualSha256=None,errorCode=error)
    def test_T007_25_timestamp_strict(self):
        invalid=['bad','2026-02-30T00:00:00Z','2026-11-11T00:00:00','2026-11-11 00:00:00Z','2026-11-11T00:00:00+0000','20261111T000000Z','2026-11-11T00:00:00+19:00','2026-11-11T00:00:00+18:01','2026-11-11T00:00:00+00:60','2026-11-11T00:00:00.1234567890Z',None]
        for stamp in invalid:
            with self.subTest(stamp=stamp):self.invalid(processedAt=stamp)
        self.validate(document(processedAt='2026-11-11T17:00:00.123456789+07:00'))
    def test_T007_26_wrong_types_and_non_object(self):
        for field in ['bucket','objectKey','versionId','status','actualSha256','processedAt']:
            for value in [True,1,[],{},None]:
                with self.subTest(field=field,value=value):self.invalid(**{field:value})
        for data in [b'[]',b'null',b'true',b'42',b'"text"']:
            with self.assertRaises(ValueError):self.validate(data)
    def test_T007_27_invalid_syntax_encoding_constants(self):
        for data in [b'{',b'\xff',b'{"size":NaN}',b'{"size":Infinity}',b'\xef\xbb\xbf'+json.dumps(document()).encode()]:
            with self.assertRaises(ValueError):self.validate(data)
    def test_T007_28_duplicate_keys(self):
        data=json.dumps(document()).replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1').encode()
        with self.assertRaises(ValueError):self.validate(data)
    def test_T007_29_trailing_tokens(self):
        with self.assertRaises(ValueError):self.validate(json.dumps(document()).encode()+b' {}')
    def test_T007_30_oversize_bounded_read_and_close(self):
        class Body(io.BytesIO):
            sizes=[]
            def read(self,size=-1):self.sizes.append(size);return super().read(size)
        body=Body(json.dumps(document()).encode()+b' '*65537);s3=fixture_s3([record()])
        with patch.object(s3,'get_object',return_value={'Body':body}):result=self.check_rows([record()],s3=s3)
        self.assertFalse(result['allMatched']);self.assertEqual(result['invalidResultCount'],1)
        self.assertEqual(body.sizes,[65537]);self.assertTrue(body.closed)
    def test_T007_31_exact_version_unicode_delimiter_safe(self):
        row=record(object_key='uploads/nhom|5/\n\u0111\U0001f600',s3_version_id='v+|/=%\u0111')
        s3=fixture_s3([row]);result=self.check_rows([row],s3=s3)
        self.assertTrue(result['fullIntegrityVerified'])
        heads=[kw for op,kw in s3.calls if op=='head'];self.assertEqual(heads,[{'Bucket':row['bucket'],'Key':row['object_key'],'VersionId':row['s3_version_id']}])
    def test_T007_32_wrong_version_no_latest_fallback(self):
        s3=fixture_s3([record()])
        with patch.object(s3,'head_object',return_value={'VersionId':'latest-wrong','ContentLength':3}) as head:
            result=self.check_rows([record()],s3=s3)
        self.assertFalse(result['allMatched']);self.assertEqual(head.call_count,1);self.assertEqual(head.call_args.kwargs['VersionId'],'version-0')
    def test_T007_33_missing_exact_object(self):
        s3=fixture_s3([record()]);del s3.objects[('fixture-bucket','uploads/0','version-0')]
        result=self.check_rows([record()],s3=s3);self.assertFalse(result['allMatched']);self.assertEqual(result['missingObjectCount'],1)
    def test_T007_34_access_denied_and_timeout_not_missing(self):
        for method in ['head_object','get_object']:
            for error,expected in [(S3Error('AccessDenied',403),'PERMISSION_DENIED'),(TimeoutError(),'UNAVAILABLE'),(S3Error('ServiceUnavailable',503),'UNAVAILABLE')]:
                with self.subTest(method=method,error=type(error).__name__):
                    s3=fixture_s3([record()])
                    with patch.object(s3,method,side_effect=error):result=self.check_rows([record()],s3=s3)
                    item=result['items'][0];field='objectStatus' if method=='head_object' else 'checksumContractStatus'
                    self.assertEqual(item[field],expected);self.assertFalse(result['allMatched']);self.assertEqual(result['missingObjectCount'],0);self.assertEqual(result['indeterminateCount'],1)
    def test_T007_35_object_size_mismatch(self):
        s3=fixture_s3([record()]);s3.objects[('fixture-bucket','uploads/0','version-0')]=b'four'
        result=self.check_rows([record()],s3=s3);self.assertFalse(result['allMatched']);self.assertEqual(result['items'][0]['objectStatus'],'METADATA_MISMATCH')
    def test_T007_36_missing_result_depends_on_db_state(self):
        for state,passed in [('INTEGRITY_PENDING',True),('FAILED',True),('VERIFIED',False),('MISMATCH',False)]:
            with self.subTest(state=state):
                row=record(integrity_status=state,actual_sha256=None if state in ['FAILED','INTEGRITY_PENDING'] else SHA,expected_sha256='b'*64 if state=='MISMATCH' else SHA)
                result=self.check_rows([row],[None]);self.assertEqual(result['allMatched'],passed);self.assertFalse(result['fullIntegrityVerified'])
    def test_T007_37_later_version_does_not_change_pin(self):
        s3=fixture_s3([record()]);s3.objects[('fixture-bucket','uploads/0','new-v2')]=b'changed';s3.objects[('fixture-bucket','uploads/0',None)]=b'changed'
        result=self.check_rows([record()],s3=s3);self.assertTrue(result['fullIntegrityVerified'])
        self.assertEqual([kw['VersionId'] for op,kw in s3.calls if op=='head'],['version-0'])
    def test_T007_38_empty_no_vacuous_full_integrity(self):
        result=self.check_rows([]);self.assertEqual(result['coverage'],{'eligibleCount':0,'verifiedCount':0})
        self.assertFalse(result['fullIntegrityVerified']);self.assertEqual(result['objectVerificationStatus'],'NOT_APPLICABLE');self.assertEqual(result['integrityVerificationStatus'],'NOT_APPLICABLE')

def database_rows(pg,db):
    raw=pg.query(db,"SELECT row_to_json(t)::text FROM (SELECT id,bucket,object_key,s3_version_id,size_bytes,expected_sha256,actual_sha256,upload_status,integrity_status FROM file_versions ORDER BY id) t;")
    return [json.loads(line) for line in raw.splitlines() if line]

def seed_mixed(pg,db):
    pg.query(db,"UPDATE file_versions SET integrity_status='MISMATCH',expected_sha256='"+'a'*64+"' WHERE object_key='uploads/1';")
    for number,upload,integrity in [(32,'AVAILABLE','INTEGRITY_PENDING'),(33,'AVAILABLE','FAILED'),(34,'PENDING','INTEGRITY_PENDING'),(35,'FAILED','INTEGRITY_PENDING'),(36,'EXPIRED','INTEGRITY_PENDING')]:
        version="'version-"+str(number)+"'" if upload=='AVAILABLE' else 'NULL'
        pg.query(db,f"INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,s3_version_id,content_type,size_bytes,expected_sha256,actual_sha256,upload_status,integrity_status,created_by) VALUES('{uuid.UUID(int=number)}','{uuid.UUID(int=20)}','{uuid.UUID(int=10)}','fixture-bucket','uploads/{number}',{version},'application/pdf',3,'{SHA}',NULL,'{upload}','{integrity}','{uuid.UUID(int=1)}');")
    pg.query(db,"INSERT INTO upload_sessions(id,project_id,file_version_id,initiated_by,reserved_bytes,created_at,expires_at,completed_at) SELECT id,project_id,id,created_by,size_bytes,created_at,created_at+interval '1 day',CASE WHEN upload_status='AVAILABLE' THEN created_at END FROM file_versions;")

def populate_file_s3(pg,db,s3):
    for row in database_rows(pg,db):
        if row['upload_status']!='AVAILABLE':continue
        body=b'def' if row['object_key']=='uploads/1' else b'abc'
        s3.objects[(row['bucket'],row['object_key'],row['s3_version_id'])]=body
        if row['integrity_status']=='INTEGRITY_PENDING':continue
        doc=document(row)
        if row['integrity_status']=='FAILED':doc.update(status='FAILED',actualSha256=None,errorCode='PROCESSING_ERROR')
        s3.objects[(row['bucket'],restore.result_key(row['bucket'],row['object_key'],row['s3_version_id']),None)]=json.dumps(doc).encode()


def restore_run(pg,manifest,s3,folder,target=None,version=None):
    evidence=folder/('restore-'+uuid.uuid4().hex)
    args=['--pg-container',pg.container,'--user','postgres','--backup-bucket',manifest['backupBucket'],'--backup-key',manifest['backupKey'],'--backup-version-id',version if version is not None else manifest['backupS3VersionId'],'--endpoint-url','http://localhost:4566','--evidence-dir',str(evidence)]
    if target:args+=['--target-db',target]
    with patch.object(restore,'s3_client',return_value=s3),patch.dict(os.environ,{'PGPASSWORD':'fixture-dummy-only'}),contextlib.redirect_stdout(io.StringIO()):
        result=restore.main(args)
    saved=json.loads((evidence/'restore-result.json').read_text())
    if saved!=result:raise AssertionError('Printed return and evidence differ')
    return result


class RestorePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pg=Postgres().__enter__()
    @classmethod
    def tearDownClass(cls):cls.pg.__exit__(None,None,None)
    def databases(self):return self.pg.query('postgres','SELECT datname FROM pg_database ORDER BY datname;')
    def test_T007_39_real_restore_eleven_tables_eighteen_foreign_keys(self):
        source=self.pg.database();before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3);result=restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(result['status'],'PASS');self.assertTrue(result['all11TablesMatched']);self.assertEqual(len(result['tables']),11)
            self.assertEqual(result['validatedForeignKeyCount'],18);self.assertTrue(result['fullIntegrityVerified'])
            self.assertEqual(self.pg.snapshot(result['restoredDatabase']),manifest['tables'])
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T007_40_corrupt_dump_rejected_before_db_mutation(self):
        source=self.pg.database();before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            ref=(manifest['backupBucket'],manifest['backupKey'],manifest['backupS3VersionId']);s3.objects[ref]=data[:-1]+bytes([data[-1]^1]);dbs=self.databases()
            with self.assertRaisesRegex(ValueError,'before database creation'):restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(self.databases(),dbs)
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T007_41_backup_version_manifest_and_response_pinned(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            dbs=self.databases();s3.calls=[]
            with self.assertRaisesRegex(ValueError,'does not match manifest'):restore_run(self.pg,manifest,s3,folder,version='wrong-version')
            self.assertFalse(any(op=='get' and kw['Key']==manifest['backupKey'] for op,kw in s3.calls));self.assertEqual(self.databases(),dbs)
            original=s3.get_object
            def wrong_response(**kw):
                obj=original(**kw)
                if kw['Key']==manifest['backupKey']:obj['VersionId']='wrong-response-version'
                return obj
            with patch.object(s3,'get_object',side_effect=wrong_response),self.assertRaises(ValueError):restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(self.databases(),dbs)
            for field in ['backupKey','backupBucket','backupS3VersionId']:
                bad=manifest.copy();bad[field]='wrong';key=(manifest['backupBucket'],manifest['backupKey']+'.meta.json',None)
                s3.objects[key]=json.dumps(bad).encode()
                with self.assertRaises(ValueError):restore_run(self.pg,manifest,s3,folder)
                self.assertEqual(self.databases(),dbs)
    def test_T007_42_pg_restore_failure_not_success_source_preserved(self):
        source=self.pg.database();before=self.pg.snapshot(source);target='failure_'+uuid.uuid4().hex
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            real=restore.run_pg_restore
            def fail_target(*args):
                if args[4]==target:return subprocess.CompletedProcess([],37,stdout='',stderr='fixture-private-marker')
                return real(*args)
            with patch.object(restore,'run_pg_restore',side_effect=fail_target),self.assertRaisesRegex(RuntimeError,'exit 37') as error:
                restore_run(self.pg,manifest,s3,folder,target=target)
            self.assertNotIn('fixture-private-marker',str(error.exception));self.assertEqual(list(folder.glob('restore-*/restore-result.json')),[])
            self.assertEqual(self.pg.query(target,"SELECT count(*) FROM pg_tables WHERE schemaname='public';"),'0')
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T007_43_atomic_restore_rollback_sentinel(self):
        source=self.pg.database();before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            path=folder/'archive.dump';path.write_bytes(data)
            check=restore.verify_atomic_rollback(self.pg.container,'127.0.0.1',5432,'postgres','',path,'rollback_'+uuid.uuid4().hex)
            self.assertTrue(check['passed']);self.assertNotEqual(check['restoreExitCode'],0)
            self.assertEqual(check['remainingPublicTables'],['handovers']);self.assertTrue(check['sentinelPreserved'])
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T007_44_metadata_mismatch_fails_with_evidence(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3);bad=copy.deepcopy(manifest);bad['tables']['app_users']['rowCount']+=1
            s3.objects[(manifest['backupBucket'],manifest['backupKey']+'.meta.json',None)]=json.dumps(bad).encode()
            with self.assertRaises(SystemExit) as error:restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(error.exception.code,1)
            result=json.loads(next(folder.glob('restore-*/restore-result.json')).read_text())
            self.assertEqual(result['status'],'FAIL');self.assertEqual(result['tableVerificationStatus'],'FAIL');self.assertFalse(result['all11TablesMatched'])
    def test_T007_45_same_backup_twice_unique_targets(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3)
            one=restore_run(self.pg,manifest,s3,folder);two=restore_run(self.pg,manifest,s3,folder)
            self.assertNotEqual(one['restoredDatabase'],two['restoredDatabase']);self.assertNotEqual(one['atomicRollbackCheck']['rollbackDatabase'],two['atomicRollbackCheck']['rollbackDatabase'])
            self.assertEqual(self.pg.snapshot(one['restoredDatabase']),self.pg.snapshot(two['restoredDatabase']))
    def test_T007_46_mixed_states_preserved_real_postgres(self):
        source=self.pg.database();seed_mixed(self.pg,source);before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3);result=restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(result['status'],'PASS');self.assertFalse(result['fullIntegrityVerified'])
            check=result['s3VersionCrossCheck']
            self.assertEqual((check['totalFileVersions'],check['checkedCount'],check['pendingChecksumCount'],check['verifiedCount'],check['mismatchCount'],check['failedCount'],check['unverifiedCount']),(7,4,1,1,1,2,6))
            self.assertEqual(check['checksumContractStatus'],'INCOMPLETE')
            self.assertEqual(database_rows(self.pg,source),database_rows(self.pg,result['restoredDatabase']))
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T007_47_one_invalid_result_not_masked(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3);key=restore.result_key('fixture-bucket','uploads/1','version-1');doc=json.loads(s3.objects[('fixture-bucket',key,None)]);doc['extra']='bad';s3.objects[('fixture-bucket',key,None)]=json.dumps(doc).encode()
            with self.assertRaises(SystemExit) as error:restore_run(self.pg,manifest,s3,folder)
            self.assertEqual(error.exception.code,1);result=json.loads(next(folder.glob('restore-*/restore-result.json')).read_text())
            check=result['s3VersionCrossCheck'];self.assertFalse(check['allMatched']);self.assertEqual(check['invalidResultCount'],1);self.assertEqual(check['verifiedCount'],1)
    def test_T007_48_source_and_restored_cross_check_read_only(self):
        source=self.pg.database();seed_mixed(self.pg,source);before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            populate_file_s3(self.pg,source,s3)
            # Source stays pending even when a valid success document is already present.
            row=next(row for row in database_rows(self.pg,source) if row['object_key']=='uploads/32')
            s3.objects[(row['bucket'],restore.result_key(row['bucket'],row['object_key'],row['s3_version_id']),None)]=json.dumps(document(row)).encode()
            result=restore_run(self.pg,manifest,s3,folder);target=result['restoredDatabase'];target_before=self.pg.snapshot(target)
            for db in [source,target]:
                checked=restore.cross_check_s3_objects(s3,self.pg.container,'127.0.0.1',5432,'postgres',db,'')
                self.assertTrue(checked['allMatched']);self.assertEqual(checked['pendingChecksumCount'],1);self.assertFalse(checked['fullIntegrityVerified'])
            self.assertEqual(self.pg.snapshot(target),target_before)
        self.assertEqual(self.pg.snapshot(source),before)

if __name__=='__main__':unittest.main(verbosity=2)
