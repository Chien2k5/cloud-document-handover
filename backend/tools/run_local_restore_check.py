"""Create two disposable LOCAL databases, dump/restore synthetic portal data, verify DB and HTTP.

Uses only the Python standard library and PostgreSQL client tools. Never accepts an existing
source/target database, drops databases, or contacts AWS. Archives/raw logs stay in ignored
runtime-data because a dump contains password hashes. Evidence contains counts/hashes/status only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import time
import traceback
from datetime import datetime, timezone, timedelta
import urllib.error
import urllib.request
import uuid

from run_http_smoke import Client


TABLES = ('app_users', 'projects', 'memberships', 'file_metadata', 'file_versions',
          'upload_sessions', 'handovers', 'handover_items', 'handover_recipients',
          'audit_events', 'flyway_schema_history')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def render_report(evidence):
    local = timezone(timedelta(hours=7))
    started = datetime.fromisoformat(evidence['startedAt']).astimezone(local).isoformat()
    ended = datetime.fromisoformat(evidence['completedAt']).astimezone(local).isoformat()
    rows = '\n'.join(f"| {table} | {value['rows']} | {evidence['restoredSnapshot'][table]['rows']} | Khớp |"
                     for table, value in evidence['sourceSnapshot'].items())
    return f'''# Biên bản backup và restore PostgreSQL local

Kết quả: **PASS**. Bắt đầu {started}; kết thúc {ended} (UTC+07).

Source DB: `{evidence['sourceDatabase']}`. Target DB mới: `{evidence['targetDatabase']}`.

| Phép đo local | Kết quả |
| --- | --- |
| pg_dump định dạng custom | {evidence['dumpSeconds']} giây |
| pg_restore trong một transaction | {evidence['restoreSeconds']} giây |
| Khởi động backend trên target | {evidence['targetBootSeconds']} giây |
| HTTP request checks | {evidence['httpRequestChecks']} PASS |
| Khóa ngoại đã validated | {evidence['invariants']['foreignKeys']} |
| Project sai quota / HandoverItem sai liên kết | 0 / 0 |

| Bảng | Số dòng nguồn | Số dòng phục hồi | SHA-256 dữ liệu |
| --- | --- | --- | --- |
{rows}

Trạng thái DRAFT/READY/CONFIRMED/REVOKED, phiên bản v1 trong gói, người nhận và thời điểm xác nhận được giữ nguyên. Target không seed lại tài khoản; đăng nhập dùng tài khoản và password hash đã phục hồi. Các thao tác đọc và confirm lặp không làm thay đổi snapshot sau restore.

Dữ liệu file/version/handover là fixture SQL tổng hợp, người dùng/dự án tạo qua ứng dụng. API thiếu adapter S3 trả 503; không có byte S3 hoặc Lambda nào được kiểm chứng. Archive và raw log nằm trong runtime-data bị ignore; không đưa password hash/cookie/token vào evidence. Database fixture được giữ lại để kiểm tra, script không xóa hoặc ghi đè DB có sẵn.

Chi tiết và hash nằm trong restore-result.json; trạng thái lần chạy mới nhất nằm trong run-status.json. Các số đo local này không phải RTO/RPO hoặc kết quả backup S3 trên AWS.
'''


class RestoreCheck:
    def __init__(self, args):
        self.args = args
        self.root = Path(__file__).resolve().parents[2]
        self.backend = self.root / 'backend'
        self.jar = self.backend / 'target/document-handover-0.1.0-SNAPSHOT.jar'
        self.run_id = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:8]
        self.runtime = self.root / 'runtime-data' / ('week4-restore-' + self.run_id)
        self.runtime.mkdir(parents=True, exist_ok=False)
        self.output = self.root / 'evidence/week-04/local-restore'
        self.output.mkdir(parents=True, exist_ok=True)
        self.source = 'handover_restore_' + self.run_id + '_src'
        self.target = 'handover_restore_' + self.run_id + '_dst'
        self.env = os.environ.copy()
        for key in ('PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE'):
            self.env.pop(key, None)
        self.env.update(PGCONNECT_TIMEOUT='5', PGOPTIONS='-c timezone=UTC', PGAPPNAME='handover-local-restore')
        self.password = secrets.token_urlsafe(24)
        self.process = None
        self.log_handle = None
        self.http_checks = 0
        self.stage = 'prepare'
        self.write_status('RUNNING')

    def write_status(self, status):
        (self.output / 'run-status.json').write_text(json.dumps(dict(status=status, runId=self.run_id,
            stage=self.stage, recordedAt=datetime.now(timezone.utc).isoformat()), indent=2) + '\n', encoding='utf-8')

    def command(self, name, arguments, sql=None):
        exe = Path(self.args.pg_bin) / (name + ('.exe' if os.name == 'nt' else ''))
        require(exe.is_file(), 'Missing PostgreSQL tool: ' + name)
        connection = ['--host', self.args.host, '--port', str(self.args.port), '--username', self.args.user, '--no-password']
        result = subprocess.run([str(exe)] + connection + arguments, input=sql, text=True,
                                encoding='utf-8', errors='replace', capture_output=True,
                                env=self.env, timeout=120)
        if result.returncode:
            # Keep diagnostics out of published evidence, and never echo SQL or environment.
            (self.runtime / (self.stage + '-tool-error.log')).write_text(result.stderr, encoding='utf-8')
            raise RuntimeError(self.stage + ': ' + name + ' failed; inspect the ignored runtime log')
        return result.stdout.strip()

    def sql(self, database, statement):
        return self.command('psql', ['--dbname', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], statement)

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None
        if self.log_handle is not None:
            self.log_handle.close()
            self.log_handle = None

    def start(self, database, port, seed):
        env = self.env.copy()
        env.update(DB_URL=f'jdbc:postgresql://{self.args.host}:{self.args.port}/{database}',
                   DB_USERNAME=self.args.user, DB_PASSWORD=self.env.get('PGPASSWORD', ''),
                   SERVER_PORT=str(port), SPRING_PROFILES_ACTIVE='local', SESSION_COOKIE_SECURE='false',
                   UPLOAD_BUCKET='fixture-bucket', UPLOAD_EXPIRY_DELAY_MS='3600000')
        env.pop('RUN_DB_TESTS', None)
        # Restoration must authenticate restored users; seeding the target could mask data loss.
        env.pop('LOCAL_DEMO_PASSWORD', None)
        if seed:
            env['LOCAL_DEMO_PASSWORD'] = self.password
        self.log_handle = (self.runtime / (database + '-server.log')).open('w', encoding='utf-8')
        self.process = subprocess.Popen(['java', '-jar', str(self.jar)], cwd=self.backend, env=env,
                                        stdout=self.log_handle, stderr=subprocess.STDOUT,
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        started = time.monotonic()
        while time.monotonic() - started < 60:
            require(self.process.poll() is None, self.stage + ': JAR exited before readiness; inspect runtime log')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/health', timeout=1) as response:
                    if response.status == 200:
                        return round(time.monotonic() - started, 3)
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(0.2)
        raise RuntimeError(self.stage + ': JAR readiness timeout')

    def clients(self, port):
        return [Client(f'http://127.0.0.1:{port}/api/v1') for _ in range(3)]

    def snapshot(self, database):
        snapshot = {}
        for table in TABLES:
            rows = json.loads(self.sql(database, f'SELECT COALESCE(json_agg(t),\'[]\'::json) FROM public.{table} t;'))
            canonical = sorted(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')) for row in rows)
            snapshot[table] = {'rows': len(rows), 'sha256': hashlib.sha256(('\n'.join(canonical)).encode('utf-8')).hexdigest()}
        return snapshot

    def invariants(self, database):
        constraints = json.loads(self.sql(database, """SELECT json_build_object(
            'foreignKeys',count(*),'unvalidated',count(*) FILTER (WHERE NOT convalidated))
            FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f';"""))
        require(constraints['foreignKeys'] > 0 and constraints['unvalidated'] == 0, 'Foreign keys were not restored/validated')
        bad_quota = int(self.sql(database, """SELECT count(*) FROM projects p WHERE
            p.used_bytes<>COALESCE((SELECT sum(size_bytes) FROM file_versions WHERE project_id=p.id AND upload_status='AVAILABLE'),0)
            OR p.reserved_bytes<>COALESCE((SELECT sum(size_bytes) FROM file_versions WHERE project_id=p.id AND upload_status='PENDING'),0);"""))
        bad_links = int(self.sql(database, """SELECT count(*) FROM handover_items i
            LEFT JOIN handovers h ON h.id=i.handover_id LEFT JOIN file_versions v ON v.id=i.file_version_id
            WHERE h.id IS NULL OR v.id IS NULL OR i.project_id<>h.project_id OR i.project_id<>v.project_id;"""))
        require(bad_quota == 0 and bad_links == 0, 'Restored quota or handover links are inconsistent')
        return dict(constraints, invalidQuotaProjects=bad_quota, invalidHandoverLinks=bad_links)

    def seed_fixture(self, project, other, people):
        owner, viewer, recipient = people
        ids = {name: str(uuid.uuid4()) for name in ('file', 'v1', 'v2', 'pending', 'u1', 'u2', 'up', 'draft', 'ready', 'confirmed', 'revoked')}
        data1, data2, pending = b'local restore fixture v1\n', b'local restore fixture v2\n', b'pending'
        sha1, sha2 = hashlib.sha256(data1).hexdigest(), hashlib.sha256(data2).hexdigest()
        (self.runtime / 'fixture-v1.txt').write_bytes(data1)
        (self.runtime / 'fixture-v2.txt').write_bytes(data2)
        q = literal
        statements = ['BEGIN;', f"INSERT INTO file_metadata(id,project_id,filename,created_by) VALUES ({q(ids['file'])},{q(project)},'restore.txt',{q(owner)});"]
        for key, upload, blob, expected, actual, status in [('v1', 'u1', data1, sha1, sha1, 'VERIFIED'), ('v2', 'u2', data2, sha1, sha2, 'MISMATCH')]:
            ref = 'fixture+' + key + '/='
            statements.append(f"INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,s3_version_id,content_type,size_bytes,expected_sha256,actual_sha256,upload_status,integrity_status,created_by) VALUES ({q(ids[key])},{q(ids['file'])},{q(project)},'fixture-bucket',{q('uploads/'+project+'/'+ids[upload])},{q(ref)},'text/plain',{len(blob)},{q(expected)},{q(actual)},'AVAILABLE',{q(status)},{q(owner)});")
            statements.append(f"INSERT INTO upload_sessions(id,project_id,file_version_id,initiated_by,reserved_bytes,expires_at,completed_at) VALUES ({q(ids[upload])},{q(project)},{q(ids[key])},{q(owner)},{len(blob)},now()+interval '30 minutes',now());")
        statements.append(f"INSERT INTO file_versions(id,file_id,project_id,bucket,object_key,content_type,size_bytes,expected_sha256,created_by) VALUES ({q(ids['pending'])},{q(ids['file'])},{q(project)},'fixture-bucket',{q('uploads/'+project+'/'+ids['up'])},'text/plain',{len(pending)},{q(hashlib.sha256(pending).hexdigest())},{q(owner)});")
        statements.append(f"INSERT INTO upload_sessions(id,project_id,file_version_id,initiated_by,reserved_bytes,expires_at) VALUES ({q(ids['up'])},{q(project)},{q(ids['pending'])},{q(owner)},{len(pending)},now()+interval '30 minutes');")
        statements.append(f"UPDATE projects SET used_bytes={len(data1)+len(data2)},reserved_bytes={len(pending)} WHERE id={q(project)};")
        for name, status, access, version in [('draft', 'DRAFT', 'ACTIVE', 'v2'), ('ready', 'READY', 'ACTIVE', 'v1'), ('confirmed', 'CONFIRMED', 'ACTIVE', 'v1'), ('revoked', 'READY', 'REVOKED', 'v1')]:
            published = 'NULL' if status == 'DRAFT' else 'now()'
            statements.append(f"INSERT INTO handovers(id,project_id,title,status,access_status,created_by,expires_at,published_at) VALUES ({q(ids[name])},{q(project)},{q('Local '+name)},{q(status)},{q(access)},{q(owner)},now()+interval '2 days',{published});")
            statements.append(f"INSERT INTO handover_items(handover_id,project_id,file_version_id) VALUES ({q(ids[name])},{q(project)},{q(ids[version])});")
            confirmed = 'now()' if status == 'CONFIRMED' else 'NULL'
            statements.append(f"INSERT INTO handover_recipients(handover_id,user_id,confirmed_at) VALUES ({q(ids[name])},{q(recipient)},{confirmed});")
            if status == 'CONFIRMED':
                statements.append(f"INSERT INTO handover_recipients(handover_id,user_id,confirmed_at) VALUES ({q(ids[name])},{q(viewer)},now());")
            statements.append(f"INSERT INTO audit_events(id,project_id,actor_id,action,target_id,request_id) VALUES ({q(uuid.uuid4())},{q(project)},{q(owner)},'LOCAL_RESTORE_FIXTURE',{q(ids[name])},{q(uuid.uuid4())});")
        statements.append('COMMIT;')
        self.sql(self.source, '\n'.join(statements))
        ids.update(project=project, other=other, sha1=sha1, sha2=sha2)
        return ids

    def verify_http(self, clients, ids, expected_manifest=None, expected_confirmation=None):
        owner, viewer, recipient = clients
        manifest = owner.request('GET', '/handovers/' + ids['confirmed'], 200)
        require(manifest['status'] == 'CONFIRMED', 'CONFIRMED package was not preserved')
        require(manifest['items'][0]['versionId'] == 'fixture+v1/=', 'Pinned version changed')
        require(manifest['items'][0]['expectedSha256'] == ids['sha1'], 'Expected checksum changed')
        if expected_manifest is not None:
            require(manifest == expected_manifest, 'Restored manifest/recipients/timestamps differ')
        recipient.request('GET', '/handovers/' + ids['confirmed'], 200)
        recipient.request('GET', '/projects/' + ids['project'], 404)
        viewer.request('GET', '/projects/' + ids['project'], 200)
        confirmation = recipient.request('POST', '/handovers/' + ids['confirmed'] + '/confirm', 200, token=recipient.csrf)
        if expected_confirmation is not None:
            require(confirmation == expected_confirmation, 'Idempotent confirmation timestamp changed after restore')
        owner.request('GET', '/handovers/' + ids['draft'], 200)
        recipient.request('GET', '/handovers/' + ids['draft'], 409)
        require(owner.request('GET', '/handovers/' + ids['ready'], 200)['status'] == 'READY', 'READY status changed')
        recipient.request('GET', '/handovers/' + ids['revoked'], 409)
        require(owner.request('GET', '/handovers/' + ids['revoked'], 200)['accessStatus'] == 'REVOKED', 'Revocation lost')
        for path in ['/projects/' + ids['project'] + '/files/' + ids['v1'] + '/download', '/handovers/' + ids['confirmed'] + '/items/' + ids['v1'] + '/download']:
            require(owner.request('GET', path, 503)['code'] == 'STORAGE_UNAVAILABLE', 'Missing adapter must fail closed')
        return manifest, confirmation

    def run(self):
        require(self.jar.is_file(), 'Build the backend JAR with Maven verify first')
        require(self.args.source_port != self.args.target_port, 'HTTP ports must differ')
        for port in (self.args.source_port, self.args.target_port):
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', port))
        for name in (self.source, self.target):
            require(re.fullmatch(r'handover_restore_[0-9a-z_]+_(src|dst)', name) is not None, 'Invalid generated fixture database name')
        started_at = datetime.now(timezone.utc).isoformat()
        self.stage = 'create-source'
        self.command('createdb', ['--maintenance-db', 'postgres', self.source])
        self.stage = 'start-source'
        self.start(self.source, self.args.source_port, seed=True)
        source_clients = self.clients(self.args.source_port)
        owner, viewer, recipient = source_clients
        accounts = [c.login(name, self.password) for c, name in zip(source_clients, ('dung', 'viewer', 'outsider'))]
        project = owner.request('POST', '/projects', 201, {'name': 'Local restore A'}, token=owner.csrf)['id']
        other = recipient.request('POST', '/projects', 201, {'name': 'Local restore B'}, token=recipient.csrf)['id']
        owner.request('PUT', '/projects/' + project + '/members/' + accounts[1]['id'], 200, {'role': 'VIEWER'}, token=owner.csrf)
        self.stage = 'seed-fixture'
        ids = self.seed_fixture(project, other, [a['id'] for a in accounts])
        manifest, confirmation = self.verify_http(source_clients, ids)
        self.http_checks += sum(c.checks for c in source_clients)
        self.stop()  # Quiescent source for canonical snapshot and pg_dump.
        self.stage = 'snapshot-source'
        before = self.snapshot(self.source)
        invariant_source = self.invariants(self.source)
        archive = self.runtime / 'portal-fixture.dump'
        self.stage = 'pg-dump'
        start = time.monotonic()
        self.command('pg_dump', ['--dbname', self.source, '--format=custom', '--no-owner', '--no-privileges', '--file', str(archive)])
        dump_seconds = round(time.monotonic() - start, 3)
        self.stage = 'create-target'
        self.command('createdb', ['--maintenance-db', 'postgres', self.target])
        self.stage = 'pg-restore'
        start = time.monotonic()
        self.command('pg_restore', ['--dbname', self.target, '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', str(archive)])
        restore_seconds = round(time.monotonic() - start, 3)
        self.stage = 'compare-restored-database'
        after = self.snapshot(self.target)
        require(before == after, 'Restored rows differ from the source snapshot')
        invariant_target = self.invariants(self.target)
        require(invariant_source == invariant_target, 'Restored constraints/invariants differ')
        self.stage = 'start-restored-target'
        target_boot = self.start(self.target, self.args.target_port, seed=False)
        target_clients = self.clients(self.args.target_port)
        for client, name in zip(target_clients, ('dung', 'viewer', 'outsider')):
            client.login(name, self.password)
        self.stage = 'restored-http'
        self.verify_http(target_clients, ids, manifest, confirmation)
        self.http_checks += sum(c.checks for c in target_clients)
        self.stop()
        require(before == self.snapshot(self.target), 'Post-restore reads/idempotent confirm changed restored data')
        evidence = dict(status='PASS', scope='LOCAL_POSTGRESQL_ONLY', aws='NOT RUN', sourceDatabase=self.source,
                        targetDatabase=self.target, targetDemoSeedEnabled=False, startedAt=started_at,
                        completedAt=datetime.now(timezone.utc).isoformat(), sourceSnapshot=before, restoredSnapshot=after,
                        invariants=invariant_target, httpRequestChecks=self.http_checks,
                        dumpSeconds=dump_seconds, restoreSeconds=restore_seconds, targetBootSeconds=target_boot,
                        archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                        jarSha256=hashlib.sha256(self.jar.read_bytes()).hexdigest(),
                        pinnedVersionPreserved=True, confirmationTimesPreserved=True, noUnexpectedDataChanges=True,
                        archiveCommitted=False, fixtureDescription='Local-profile seeded users; API-created projects/membership; SQL synthetic file/version/handover fixtures; no S3 bytes or Lambda execution')
        (self.output / 'restore-result.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        (self.output / 'restore-report.md').write_text(render_report(evidence), encoding='utf-8')
        self.stage = 'complete'
        self.write_status('PASS')
        print(json.dumps({'status': 'PASS', 'tablesMatched': len(TABLES), 'httpChecks': self.http_checks,
                          'dumpSeconds': dump_seconds, 'restoreSeconds': restore_seconds, 'aws': 'NOT RUN'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', required=True)
    parser.add_argument('--host', choices=['127.0.0.1', 'localhost'], default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5432)
    parser.add_argument('--user', required=True)
    parser.add_argument('--source-port', type=int, default=18086)
    parser.add_argument('--target-port', type=int, default=18087)
    args = parser.parse_args()
    check = RestoreCheck(args)
    try:
        check.run()
    except Exception:
        (check.runtime / 'failure.txt').write_text(traceback.format_exc(), encoding='utf-8')
        check.write_status('FAIL')
        print(json.dumps({'status': 'FAIL', 'stage': check.stage, 'diagnostics': 'Inspect ignored runtime-data/week4-restore-* logs; no success evidence generated'}))
        raise SystemExit(1)
    finally:
        check.stop()


if __name__ == '__main__':
    main()
