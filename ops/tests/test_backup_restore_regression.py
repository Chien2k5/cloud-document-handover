"""R201..R210: real PostgreSQL backup/restore with strict isolated S3 state."""
import contextlib,hashlib,json,subprocess,unittest,uuid
from unittest.mock import patch
from wave2_support import ROOT,Postgres,backup_run,restore
from test_restore_integrity import database_rows,populate_file_s3,seed_mixed,restore_run

class BackupRestoreRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources=contextlib.ExitStack()
        try:
            cls.pg=cls.resources.enter_context(Postgres());cls.source=cls.pg.database();seed_mixed(cls.pg,cls.source)
            cls.before=cls.pg.snapshot(cls.source)
            cls.manifest,cls.data,cls.s3,cls.folder,_=cls.resources.enter_context(backup_run(cls.pg,cls.source))
            populate_file_s3(cls.pg,cls.source,cls.s3);cls.result=restore_run(cls.pg,cls.manifest,cls.s3,cls.folder)
        except BaseException:
            cls.resources.close();raise
    @classmethod
    def tearDownClass(cls):cls.resources.close()
    def test_R201_new_backup_new_restore(self):
        self.assertEqual(self.result['status'],'PASS');self.assertTrue(self.result['dumpSha256Verified']);self.assertTrue(self.result['atomicRollbackCheck']['passed'])
    def test_R202_manifest_identity_and_output_compatibility(self):
        for key in ['backupBucket','backupKey','backupS3VersionId','sourceDatabase']:
            self.assertEqual(self.manifest[key],self.result[key])
        self.assertEqual(hashlib.sha256(self.data).hexdigest(),self.manifest['dumpSha256'])
        self.assertEqual(len(self.data),self.manifest['dumpSizeBytes'])
        required={'status','environment','gitCommit','backupBucket','backupKey','backupS3VersionId','dumpSha256Verified','sourceDatabase','restoredDatabase','atomicRollbackCheck','all11TablesMatched','validatedForeignKeyCount','handoverStateSummary','tables','s3VersionCrossCheck','timingsMs','completedAt'}
        self.assertTrue(required.issubset(self.result));self.assertEqual(self.result['verificationScope'],'DATABASE_RESTORE_AND_REFERENCE_PRESERVATION')
    def test_R203_eleven_table_digests(self):
        self.assertEqual(len(self.manifest['tables']),11)
        self.assertEqual(self.pg.snapshot(self.result['restoredDatabase']),self.manifest['tables'])
        self.assertTrue(all(item['canonicalSha256Matched'] for item in self.result['tables'].values()))
    def test_R204_eighteen_validated_foreign_keys(self):
        target=self.result['restoredDatabase']
        self.assertEqual(self.pg.query(target,"SELECT count(*) FROM pg_constraint WHERE contype='f' AND convalidated;"),'18')
        self.assertEqual(self.result['foreignKeyVerificationStatus'],'PASS')
    def test_R205_mixed_states_not_falsely_verified(self):
        check=self.result['s3VersionCrossCheck'];self.assertFalse(check['fullIntegrityVerified'])
        self.assertEqual((check['pendingChecksumCount'],check['verifiedCount'],check['mismatchCount'],check['failedCount']),(1,1,1,2))
        self.assertEqual(database_rows(self.pg,self.source),database_rows(self.pg,self.result['restoredDatabase']))
    def test_R206_corrupt_bytes_rejected_before_db_creation(self):
        m=self.manifest;ref=(m['backupBucket'],m['backupKey'],m['backupS3VersionId']);dbs=self.pg.query('postgres','SELECT datname FROM pg_database ORDER BY datname;')
        self.s3.objects[ref]=self.data[:-1]+bytes([self.data[-1]^1])
        try:
            with self.assertRaises(ValueError):restore_run(self.pg,m,self.s3,self.folder)
        finally:self.s3.objects[ref]=self.data
        self.assertEqual(self.pg.query('postgres','SELECT datname FROM pg_database ORDER BY datname;'),dbs)
    def test_R207_later_file_version_never_fallback_latest(self):
        self.s3.objects[('fixture-bucket','uploads/0','newer-v2')]=b'changed newer bytes'
        self.s3.objects[('fixture-bucket','uploads/0',None)]=b'changed newer bytes'
        self.s3.calls=[]
        check=restore.cross_check_s3_objects(self.s3,self.pg.container,'127.0.0.1',5432,'postgres',self.result['restoredDatabase'],'')
        self.assertTrue(check['allMatched'])
        heads=[kw for op,kw in self.s3.calls if op=='head']
        self.assertEqual(len(heads),4);self.assertTrue(all(kw.get('VersionId') for kw in heads))
        self.assertEqual(next(kw['VersionId'] for kw in heads if kw['Key']=='uploads/0'),'version-0')
    def test_R208_source_database_unchanged(self):
        self.assertEqual(self.pg.snapshot(self.source),self.before)
    def test_R209_owned_cleanup_after_pass_and_failure(self):
        for failing in [False,True]:
            container=None
            try:
                with Postgres() as owned:
                    container=owned.container;db=owned.database();self.assertEqual(owned.query(db,'SELECT count(*) FROM app_users;'),'2')
                    if failing:raise RuntimeError('injected fixture failure')
            except RuntimeError as error:
                self.assertTrue(failing);self.assertEqual(str(error),'injected fixture failure')
            self.assertIsNotNone(container)
            self.assertNotEqual(subprocess.run(['docker','inspect',container],capture_output=True).returncode,0)
    def test_R210_repeatability_fresh_postgres(self):
        with Postgres() as owned:
            source=owned.database();seed_mixed(owned,source);before=owned.snapshot(source)
            with backup_run(owned,source) as (manifest,data,s3,folder,_):
                populate_file_s3(owned,source,s3);one=restore_run(owned,manifest,s3,folder);two=restore_run(owned,manifest,s3,folder)
                self.assertEqual(one['status'],'PASS');self.assertEqual(two['status'],'PASS')
                self.assertNotEqual(one['restoredDatabase'],two['restoredDatabase'])
                self.assertEqual(owned.snapshot(one['restoredDatabase']),manifest['tables']);self.assertEqual(owned.snapshot(two['restoredDatabase']),manifest['tables'])
                self.assertEqual(one['s3VersionCrossCheck'],two['s3VersionCrossCheck']);self.assertEqual(owned.snapshot(source),before)
        self.assertNotEqual(subprocess.run(['docker','inspect',owned.container],capture_output=True).returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
