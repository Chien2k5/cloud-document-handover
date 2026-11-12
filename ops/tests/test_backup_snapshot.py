import contextlib,hashlib,io,json,shutil,subprocess,sys,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from wave2_support import Postgres,MemoryS3,ROOT,backup,restore,backup_run

class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pg=Postgres().__enter__()
    @classmethod
    def tearDownClass(cls):cls.pg.__exit__(None,None,None)
    def test_T004_02_insert_during_backup(self):
        source=self.pg.database();original=backup.run_pg_dump
        def insert_then_dump(*args,**kwargs):
            self.pg.query(source,"INSERT INTO app_users(id,email,display_name,password_hash) VALUES('00000000-0000-0000-0000-000000000099','late@fixture.test','Late','fixture-only');")
            return original(*args,**kwargs)
        with patch.object(backup,'run_pg_dump',side_effect=insert_then_dump):
            with backup_run(self.pg,source) as (manifest,data,*_):
                restored=self.pg.restore_dump(data)
                self.assertEqual(self.pg.snapshot(restored),manifest['tables'])
                self.assertEqual(self.pg.query(restored,"SELECT count(*) FROM app_users WHERE email='late@fixture.test';"),'0')
        self.assertEqual(self.pg.query(source,"SELECT count(*) FROM app_users WHERE email='late@fixture.test';"),'1')

    def consistent(self, mutation=None):
        source=self.pg.database();before=self.pg.snapshot(source);original=backup.run_pg_dump
        def checkpoint(*args,**kwargs):
            if mutation:mutation(source)
            return original(*args,**kwargs)
        with patch.object(backup,'run_pg_dump',side_effect=checkpoint),backup_run(self.pg,source) as (manifest,data,*_):
            restored=self.pg.restore_dump(data)
            self.assertEqual(self.pg.snapshot(restored),manifest['tables'])
            self.assertEqual(manifest['tables'],before)
            self.assertEqual(self.pg.query(restored,"SELECT count(*) FROM pg_constraint WHERE contype='f' AND convalidated;"),'18')
            return source,restored,manifest,data
    def no_exporters(self):
        self.assertEqual(self.pg.query('postgres',"SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'tv1-backup-exporter-%';"),'0')
    def test_T004_01_no_concurrent_writes(self):
        source,restored,manifest,data=self.consistent()
        self.assertEqual(self.pg.snapshot(source),manifest['tables']);self.assertTrue(data.startswith(b'PGDMP'))
    def test_T004_03_update_during_backup(self):
        source,restored,*_=self.consistent(lambda db:self.pg.query(db,"UPDATE projects SET description='concurrent';"))
        self.assertEqual(self.pg.query(restored,'SELECT description FROM projects;'),'')
        self.assertEqual(self.pg.query(source,'SELECT description FROM projects;'),'concurrent')
    def test_T004_04_delete_during_backup(self):
        source,restored,*_=self.consistent(lambda db:self.pg.query(db,'DELETE FROM audit_events;'))
        self.assertEqual(self.pg.query(source,'SELECT count(*) FROM audit_events;'),'0')
        self.assertEqual(self.pg.query(restored,'SELECT count(*) FROM audit_events;'),'1')
    def test_T004_05_multi_table_transaction(self):
        def mutation(db):
            self.pg.query(db,f"BEGIN;INSERT INTO projects(id,name,created_by,quota_bytes) VALUES('{uuid.UUID(int=100)}','New','{uuid.UUID(int=1)}',100);INSERT INTO memberships(project_id,user_id,role) VALUES('{uuid.UUID(int=100)}','{uuid.UUID(int=1)}','OWNER');COMMIT;")
        source,restored,*_=self.consistent(mutation)
        self.assertEqual(self.pg.query(source,'SELECT count(*) FROM projects;'),'2')
        self.assertEqual(self.pg.query(restored,'SELECT count(*) FROM projects;'),'1')
    @contextlib.contextmanager
    def uncommitted(self,db):
        cmd=backup.pg_command('psql',self.pg.container,'127.0.0.1',5432,'postgres',db,['-X','-qAt','-v','ON_ERROR_STOP=1'])
        proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=backup.pg_environment(''))
        try:
            proc.stdin.write(f"BEGIN;INSERT INTO app_users(id,email,display_name,password_hash) VALUES('{uuid.UUID(int=101)}','uncommitted@fixture.test','Uncommitted','fixture-only');SELECT 'READY';\n");proc.stdin.flush()
            self.assertEqual(proc.stdout.readline().strip(),'READY')
            yield proc
        finally:
            proc.communicate('ROLLBACK;\n' if proc.poll() is None else None,timeout=10)
    def test_T004_06_uncommitted_transaction(self):
        source=self.pg.database()
        with self.uncommitted(source),backup_run(self.pg,source) as (manifest,data,*_):
            restored=self.pg.restore_dump(data)
            self.assertEqual(self.pg.snapshot(restored),manifest['tables'])
            self.assertEqual(self.pg.query(restored,"SELECT count(*) FROM app_users WHERE email='uncommitted@fixture.test';"),'0')
    def test_T004_07_rollback_transaction(self):
        source=self.pg.database();original=backup.run_pg_dump
        with self.uncommitted(source) as writer:
            def checkpoint(*args,**kw):writer.communicate('ROLLBACK;\n',timeout=10);return original(*args,**kw)
            with patch.object(backup,'run_pg_dump',side_effect=checkpoint),backup_run(self.pg,source) as (manifest,data,*_):
                target=self.pg.restore_dump(data);self.assertEqual(self.pg.snapshot(target),manifest['tables'])
                self.assertEqual(self.pg.query(target,"SELECT count(*) FROM app_users WHERE email='uncommitted@fixture.test';"),'0')
    def test_T004_08_expired_exporter_fails_closed(self):
        source=self.pg.database();s3=MemoryS3();original=backup.exported_snapshot
        @contextlib.contextmanager
        def expired(*args):
            with original(*args) as sid:pass
            yield sid
        with patch.object(backup,'exported_snapshot',expired),self.assertRaisesRegex(RuntimeError,'psql failed'):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(s3.calls,[]);self.no_exporters()
    def test_T004_09_all_eleven_tables(self):
        source=self.pg.database()
        actual=self.pg.snapshot(source)
        self.assertEqual(len(actual),11);self.assertEqual(set(actual),set(backup.TABLES))
        self.assertEqual(len(backup.TABLES),len(set(backup.TABLES)))
    def test_T004_10_exact_row_counts(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,*_):
            for table in backup.TABLES:self.assertEqual(manifest['tables'][table]['rowCount'],int(self.pg.query(source,f'SELECT count(*) FROM {table};')))
    def test_T004_11_canonical_and_dump_sha256(self):
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,*_):
            self.assertEqual(manifest['dumpSha256'],hashlib.sha256(data).hexdigest())
            for table in backup.TABLES:
                order='installed_rank' if table=='flyway_schema_history' else 'handover_id,file_version_id' if table=='handover_items' else '1,2'
                raw=self.pg.query(source,f'SELECT row_to_json(t)::text FROM (SELECT * FROM {table} ORDER BY {order}) t;')
                self.assertEqual(manifest['tables'][table]['canonicalSha256'],hashlib.sha256(raw.encode('utf-8')).hexdigest())
    def test_T004_12_empty_table(self):
        source=self.pg.database();self.pg.query(source,'DELETE FROM audit_events;')
        snap=self.pg.snapshot(source)['audit_events']
        self.assertEqual(snap,{'rowCount':0,'canonicalSha256':hashlib.sha256(b'').hexdigest()})
    def test_T004_13_multiple_rows_stable(self):
        source=self.pg.database()
        self.pg.query(source,"INSERT INTO audit_events SELECT gen_random_uuid(),project_id,actor_id,action,target_id,request_id,created_at FROM audit_events,generate_series(1,30);")
        a=self.pg.snapshot(source);b=self.pg.snapshot(source)
        self.assertEqual(a,b);self.assertEqual(a['audit_events']['rowCount'],31)
    def test_T004_14_primary_key_order_for_ties(self):
        source=self.pg.database();before=self.pg.snapshot(source)
        self.pg.query(source,'CREATE TEMP TABLE saved AS SELECT * FROM handover_items;DELETE FROM handover_items;INSERT INTO handover_items SELECT * FROM saved ORDER BY file_version_id ASC;')
        self.assertEqual(self.pg.snapshot(source),before)
    def test_T004_15_null_unicode_and_special_values(self):
        source=self.pg.database();special="Ti\u1ebfng Vi\u1ec7t | +%= \\ newline\nvalue"
        self.assertTrue(any(ord(char)>127 for char in special))
        self.pg.query(source,"UPDATE flyway_schema_history SET checksum=NULL;UPDATE projects SET description='"+special.replace("'","''")+"';")
        with backup_run(self.pg,source) as (manifest,data,*_):
            target=self.pg.restore_dump(data);self.assertEqual(self.pg.snapshot(target),manifest['tables'])
            self.assertEqual(self.pg.query(target,'SELECT description FROM projects;'),special)
    def test_T004_16_psql_failure_no_success(self):
        source=self.pg.database();s3=MemoryS3()
        with patch.object(backup,'run_psql_query',side_effect=RuntimeError('injected psql failure')),self.assertRaises(RuntimeError):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(s3.calls,[]);self.no_exporters()
    def test_T004_17_dump_failure_no_upload(self):
        source=self.pg.database();s3=MemoryS3()
        with patch.object(backup,'run_pg_dump',side_effect=RuntimeError('injected dump failure')),self.assertRaises(RuntimeError):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(s3.calls,[]);self.no_exporters()
    def test_T004_18_missing_dump_no_stale_fallback(self):
        source=self.pg.database();s3=MemoryS3()
        def missing(*args,**kw):
            old=args[6].parent.parent/'old'/'portal.dump';old.parent.mkdir(parents=True);old.write_bytes(b'PGDMP-stale')
        with patch.object(backup,'run_pg_dump',side_effect=missing),self.assertRaisesRegex(RuntimeError,'missing'):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(s3.calls,[])
    def test_T004_19_dump_upload_failure(self):
        source=self.pg.database();s3=MemoryS3();s3.fail='dump'
        with self.assertRaisesRegex(RuntimeError,'Dump upload failed'):
            with backup_run(self.pg,source,s3):pass
        self.assertFalse(s3.objects);self.no_exporters()
    def test_T004_20_missing_s3_version(self):
        source=self.pg.database();s3=MemoryS3();s3.version_missing=True
        with self.assertRaises(SystemExit):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(len(s3.calls),1);self.assertFalse(s3.calls[0][1]['Key'].endswith('.json'))
    def test_T004_21_manifest_upload_failure_preserves_dump(self):
        source=self.pg.database();s3=MemoryS3();s3.fail='manifest'
        with self.assertRaisesRegex(RuntimeError,'Dump uploaded.*manifest upload failed'):
            with backup_run(self.pg,source,s3):pass
        self.assertTrue(any(ref[2] is not None and ref[1].endswith('.dump') for ref in s3.objects))
        self.assertEqual([c[0] for c in s3.calls],['put','put'])
    def test_T004_22_interruption_closes_snapshot(self):
        source=self.pg.database();s3=MemoryS3()
        with patch.object(backup,'run_pg_dump',side_effect=KeyboardInterrupt),self.assertRaises(KeyboardInterrupt):
            with backup_run(self.pg,source,s3):pass
        self.assertEqual(s3.calls,[]);self.no_exporters()
    def test_T004_23_real_docker_postgresql17(self):
        self.assertTrue(self.pg.version.startswith('17.'))
        source=self.pg.database()
        with backup_run(self.pg,source) as (manifest,data,*_):self.assertTrue(data.startswith(b'PGDMP'));self.assertEqual(manifest['schemaVersion'],1)
    def test_T004_24_host_client_tools(self):
        required=['psql','pg_dump','pg_restore']
        if not all(shutil.which(tool) for tool in required):self.skipTest('N/A: PostgreSQL client tools are not installed on this Windows host; Docker mode is tested separately')
        source=self.pg.database()
        with backup_run(self.pg,source,host_mode=True) as (manifest,data,*_):
            target=self.pg.restore_dump(data);self.assertEqual(self.pg.snapshot(target),manifest['tables'])
    def test_T004_25_restore_consistency_and_foreign_keys(self):
        self.consistent();self.no_exporters()
    def test_T004_26_repeated_backup_unique_artifacts(self):
        source=self.pg.database();s3=MemoryS3()
        with patch.object(backup.time,'strftime',return_value='fixed'):
            with backup_run(self.pg,source,s3) as (one,*_):first=one.copy()
            with backup_run(self.pg,source,s3) as (two,*_):second=two.copy()
        self.assertNotEqual(first['runId'],second['runId']);self.assertNotEqual(first['backupKey'],second['backupKey'])
        self.assertEqual(first['tables'],second['tables'])
        self.assertIn((first['backupBucket'],first['backupKey'],first['backupS3VersionId']),s3.objects)
    def test_T004_27_secret_not_in_commands_or_errors(self):
        marker='fixture-sensitive-marker'
        for container in [self.pg.container,None]:
            command=backup.pg_command('psql',container,'127.0.0.1',5432,'postgres','fixture',[])
            self.assertNotIn(marker,' '.join(command))
            self.assertNotIn('PGPASSWORD='+marker,' '.join(command))
        failed=subprocess.CompletedProcess([],42,stdout='',stderr=marker)
        with patch.object(backup.subprocess,'run',return_value=failed),self.assertRaises(RuntimeError) as error:
            backup.run_psql_query(None,'127.0.0.1',5432,'postgres','fixture',marker,'SELECT 1;')
        self.assertNotIn(marker,str(error.exception))
    def test_T004_28_existing_manifest_consumer_compatibility(self):
        source=self.pg.database();before=self.pg.snapshot(source)
        with backup_run(self.pg,source) as (manifest,data,s3,folder,_):
            old=json.loads((ROOT/'evidence/tv1-local-stack/02-s3-backup-manifest.json').read_text())
            self.assertEqual(set(manifest),set(old));self.assertEqual(manifest['schemaVersion'],old['schemaVersion'])
            for i,body in enumerate([b'abc',b'def']):
                s3.objects[('fixture-bucket','uploads/'+str(i),'version-'+str(i))]=body
                doc={'schemaVersion':1,'bucket':'fixture-bucket','objectKey':'uploads/'+str(i),'versionId':'version-'+str(i),'size':3,'status':'SUCCEEDED','actualSha256':hashlib.sha256(body).hexdigest(),'errorCode':None,'processedAt':'2026-11-11T00:00:00Z'}
                s3.objects[('fixture-bucket',restore.result_key('fixture-bucket',doc['objectKey'],doc['versionId']),None)]=json.dumps(doc).encode()
            evidence=folder/'restore';target='compat_'+uuid.uuid4().hex
            args=['restore','--pg-container',self.pg.container,'--user','postgres','--backup-bucket',manifest['backupBucket'],'--backup-key',manifest['backupKey'],'--backup-version-id',manifest['backupS3VersionId'],'--endpoint-url','http://localhost:4566','--target-db',target,'--evidence-dir',str(evidence)]
            with patch.object(restore,'ROOT',folder),patch.object(restore,'s3_client',return_value=s3),patch.object(sys,'argv',args),contextlib.redirect_stdout(io.StringIO()):restore.main()
            result=json.loads((evidence/'restore-result.json').read_text());self.assertEqual(result['status'],'PASS');self.assertEqual(result['validatedForeignKeyCount'],18)
            self.assertEqual(self.pg.snapshot(source),before)

if __name__=='__main__':unittest.main(verbosity=2)
