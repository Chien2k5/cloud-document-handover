"""F011: real JDBC TLS, backend/Flyway startup, certificate and bundle tests."""
import hashlib,importlib.util,json,subprocess,sys,unittest,uuid,zipfile
from pathlib import Path
from unittest.mock import patch
from cryptography import x509
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'infra/tests'))
from wave3_support import template,run_tests
from tls_fixture import TlsFixture
spec=importlib.util.spec_from_file_location('wave3_builder',ROOT/'deploy/build_eb_bundle.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class DatabaseTlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.fixture=TlsFixture().__enter__();cls.pg=cls.fixture.pg
    @classmethod
    def tearDownClass(cls):cls.fixture.__exit__(None,None,None)
    def setUp(self):self.f=self.fixture;self.f.set_server('valid')
    def url_config(self):
        options=template('01-rds-beanstalk-cloudfront.yaml')['Resources']['HandoverEbEnvironment']['Properties']['OptionSettings']
        return next(o['Value']['Fn::Sub'] for o in options if o['OptionName']=='DB_URL')
    def positive(self,url=None):
        proc=self.f.probe(url);self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr);self.assertEqual(proc.stdout.strip(),'CONNECTED_TLS')
    def reject(self,url,reason):
        self.positive();proc=self.f.probe(url);self.assertEqual(proc.returncode,2,proc.stdout+proc.stderr);self.assertIn('CONNECTION_REJECTED reason='+reason,proc.stdout)
    def dist(self):
        folder=self.f.folder/('dist-'+uuid.uuid4().hex);(folder/'assets').mkdir(parents=True)
        (folder/'index.html').write_text('<script src="/portal/assets/app.js"></script>');(folder/'assets/app.js').write_text('console.log("fixture");')
        return folder
    def bundle(self,dist=None):
        target=self.f.folder/('bundle-'+uuid.uuid4().hex+'.zip');return builder.build_bundle(self.f.jar,dist or self.dist(),target),target
    def test_T011_01_url_requires_verified_tls(self):
        url=self.url_config();self.assertIn('sslmode=verify-full',url);self.assertIn('sslrootcert=/var/app/current/certs/rds-global-bundle.pem',url)
        self.assertEqual(template('01-rds-beanstalk-cloudfront.yaml')['Resources']['PortalDatabase']['Properties']['CACertificateIdentifier'],{'Ref':'DbCaCertificateIdentifier'})
    def test_T011_02_valid_ca_hostname_connection(self):self.positive()
    def test_T011_03_plaintext_and_no_tls_server_rejected(self):
        self.reject(self.f.configured_url().replace('sslmode=verify-full','sslmode=disable'),'TLS_REQUIRED')
        try:
            self.f.pg.query('postgres',"ALTER SYSTEM SET ssl='off';");self.f.pg.query('postgres','SELECT pg_reload_conf();')
            import time
            deadline=time.monotonic()+10
            while self.f.pg.query('postgres','SHOW ssl;')!='off':
                if time.monotonic()>deadline:raise RuntimeError('SSL off fixture did not reload')
            proc=self.f.probe();self.assertEqual(proc.returncode,2,proc.stdout);self.assertIn('reason=NO_TLS',proc.stdout)
        finally:self.f.set_server('valid')
    def test_T011_04_untrusted_ca_rejected(self):self.reject(self.f.configured_url(ca=self.f.folder/'wrong-ca.pem'),'CERTIFICATE')
    def test_T011_05_wrong_hostname_rejected(self):self.reject(self.f.configured_url(host='127.0.0.1'),'HOSTNAME')
    def test_T011_06_expired_certificate_rejected(self):
        try:
            self.f.set_server('expired');proc=self.f.probe();self.assertEqual(proc.returncode,2,proc.stdout);self.assertIn('reason=EXPIRED',proc.stdout)
        finally:self.f.set_server('valid')
        self.positive()
    def test_T011_07_missing_trust_file_rejected(self):self.reject(self.f.configured_url(ca=self.f.folder/'missing.pem'),'ROOT_CERT')
    def test_T011_08_malformed_trust_and_wrong_roots_rejected(self):
        bad=self.f.folder/'bad-ca.pem';bad.write_bytes(b'not a certificate')
        self.reject(self.f.configured_url(ca=bad),'ROOT_CERT');self.reject(self.f.configured_url(ca=builder.RDS_CA_BUNDLE),'CERTIFICATE')
    def test_T011_09_public_ca_matches_reviewed_provenance(self):
        data=builder.RDS_CA_BUNDLE.read_bytes();p=json.loads(builder.RDS_CA_BUNDLE.with_suffix('.provenance.json').read_text())
        self.assertEqual(hashlib.sha256(data).hexdigest(),builder.RDS_CA_SHA256);self.assertEqual(p['sha256'],builder.RDS_CA_SHA256)
        certs=x509.load_pem_x509_certificates(data);self.assertEqual(len(certs),p['certificateCount'])
        self.assertTrue(all(c.extensions.get_extension_for_class(x509.BasicConstraints).value.ca for c in certs))
        self.assertTrue(any('us-east-1 Root CA RSA2048 G1' in c.subject.rfc4514_string() for c in certs))
    def test_T011_10_no_runtime_ssl_bypass(self):
        text=self.url_config()+(ROOT/'deploy/eb/Procfile').read_text()
        for forbidden in ['NonValidatingFactory','trustServerCertificate=true','sslmode=require','sslmode=prefer','sslmode=disable','sslfactory=']:self.assertNotIn(forbidden,text)
    def test_T011_11_real_production_pgjdbc(self):
        self.assertRegex(self.f.jdbc_version,r'^postgresql-42[.]');self.positive();self.assertTrue(self.f.pg.version.startswith('17.'))
    def test_T011_12_backend_flyway_and_health_over_verified_tls(self):
        db=self.f.pg.database(False)
        with self.f.app(db,self.f.folder/'ca.pem') as proc:
            self.assertIsNone(proc.poll());self.assertEqual(self.f.pg.query(db,"SELECT version||':'||success FROM flyway_schema_history;"),'1:true')
            self.assertEqual(self.f.pg.query(db,"SELECT count(*) FROM pg_tables WHERE schemaname='public';"),'11')
            self.assertGreater(int(self.f.pg.query(db,"SELECT count(*) FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid) WHERE a.datname=current_database() AND a.application_name='wave3-tls-app' AND s.ssl;")),0)
    def test_T011_13_restart_keeps_trust_and_flyway_state(self):
        db=self.f.pg.database(False);ca=self.f.folder/'ca.pem';before=hashlib.sha256(ca.read_bytes()).hexdigest()
        for iteration in range(2):
            with self.f.app(db,ca) as proc:
                self.assertIsNone(proc.poll());self.assertEqual(self.f.pg.query(db,'SELECT count(*) FROM flyway_schema_history;'),'1')
        self.assertEqual(hashlib.sha256(ca.read_bytes()).hexdigest(),before)
    def test_T011_14_bundle_has_public_ca_at_runtime_location(self):
        attributes=subprocess.check_output(['git','check-attr','eol','--','deploy/eb/certs/rds-global-bundle.pem'],cwd=ROOT,text=True).strip()
        self.assertTrue(attributes.endswith(': lf'),attributes)
        manifest,path=self.bundle()
        with zipfile.ZipFile(path) as archive:
            info=archive.getinfo('certs/rds-global-bundle.pem');self.assertEqual((info.external_attr>>16)&0o777,0o644)
            self.assertEqual(archive.read(info),builder.RDS_CA_BUNDLE.read_bytes());self.assertIn('app.jar',archive.namelist())
        entry=next(e for e in manifest['entries'] if e['arcname']=='certs/rds-global-bundle.pem');self.assertEqual(entry['sha256'],builder.RDS_CA_SHA256)
        for ca in [self.f.folder/'missing.pem',self.f.folder/'wrong-ca.pem']:
            with patch.object(builder,'RDS_CA_BUNDLE',ca),self.assertRaises(SystemExit):self.bundle()
    def test_T011_15_private_keys_never_in_release(self):
        manifest,path=self.bundle()
        with zipfile.ZipFile(path) as archive:
            self.assertFalse(any(name.endswith(('.key','.p12','.pfx')) for name in archive.namelist()))
            for name in archive.namelist():self.assertNotIn(b'PRIVATE KEY',archive.read(name))
        for name in ['private.key','unexpected.txt']:
            dist=self.dist();(dist/'assets'/name).write_bytes((self.f.folder/'server.key').read_bytes())
            with self.assertRaises(SystemExit):self.bundle(dist)
    def test_T011_16_valid_environment_host_port_db_changes(self):
        db=self.f.pg.database(False);url=self.f.configured_url(db=db)
        self.assertIn('sslmode=verify-full',url);self.positive(url);self.assertIn('sslrootcert=',url);self.assertEqual(self.f.pg.query(db,'SELECT current_database();'),db)
if __name__=='__main__':sys.exit(run_tests('test_database_tls',sys.argv[1] if len(sys.argv)>1 else 'F011',environment='PostgreSQL 17 disposable; actual pgJDBC + Spring Boot/Flyway startup; fixture CA for local TLS, separate public RDS bundle artifact validation; no AWS'))
