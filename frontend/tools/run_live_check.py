"""Disposable PostgreSQL + unchanged Spring Boot + real browser integration.

Requires Docker, JDK/Maven wrapper, npm ci and Chrome. No AWS resources are used.
Creates its own container and two empty databases; never reads existing DB settings.
Passwords are generated in memory. Logs/artifacts stay in ignored runtime-data.
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
import sys
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Use cached Maven dependencies')
    parser.add_argument('--maven', help='Optional Maven executable instead of backend wrapper')
    parser.add_argument('--evidence', help='Optional summary path relative to repository root')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    frontend = root / 'frontend'
    out = root / 'runtime-data' / ('frontend-live-' + uuid.uuid4().hex[:10])
    out.mkdir(parents=True)
    evidence = (root / args.evidence).resolve() if args.evidence else out / 'verification.json'
    container = 'handover-frontend-test-' + uuid.uuid4().hex[:10]
    started = False
    server = None
    summary = {'date': '2026-11-10', 'status': 'RUNNING', 'aws': 'NOT_RUN',
               'browserStorageAndHandover': 'MOCK_TESTS_SEPARATE_FROM_THIS_RUN',
               'database': 'NEW_DISPOSABLE_POSTGRESQL_17_CONTAINER', 'backendModified': False}

    def run(name, command, cwd=root, env=None, timeout=180):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=timeout)
        (out / (name + '.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(f'{name} failed; inspect local log {out / (name + ".log")}')
        return result.stdout.strip()

    try:
        summary['sourceParentCommit'] = run('source-commit', ['git', 'rev-parse', 'HEAD'])
        summary['backendTree'] = run('backend-tree', ['git', 'rev-parse', 'HEAD:backend'])
        runtime_files = list((frontend / 'src').rglob('*')) + [frontend / name for name in (
            'index.html', 'styles.css', 'package.json', 'package-lock.json', 'vite.config.js')]
        summary['frontendRuntimeHashes'] = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                                            for path in runtime_files if path.is_file()}
        pg_env = os.environ.copy()
        password = secrets.token_urlsafe(32)
        pg_env['POSTGRES_PASSWORD'] = password
        run('database-create', ['docker', 'run', '-d', '--name', container,
            '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
            '-e', 'POSTGRES_USER=frontend_check', '-e', 'POSTGRES_DB=frontend_suite',
            '-e', 'POSTGRES_PASSWORD', 'postgres:17-alpine'], env=pg_env)
        started = True
        deadline = time.monotonic() + 45
        while subprocess.run(['docker', 'exec', container, 'pg_isready', '-q',
                              '-U', 'frontend_check', '-d', 'frontend_suite'], capture_output=True).returncode:
            if time.monotonic() >= deadline:
                raise RuntimeError('Disposable PostgreSQL readiness timeout')
            time.sleep(0.5)
        port = int(run('database-port', ['docker', 'port', container, '5432/tcp']).rsplit(':', 1)[1])
        env = os.environ.copy()
        env.update(DB_URL=f'jdbc:postgresql://127.0.0.1:{port}/frontend_suite', DB_USERNAME='frontend_check',
                   DB_PASSWORD=password, RUN_DB_TESTS='true', UPLOAD_S3_ENABLED='false',
                   SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE='8', SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE='0')
        for key in ('SPRING_PROFILES_ACTIVE', 'LOCAL_DEMO_PASSWORD', 'UPLOAD_BUCKET', 'JAVA_TOOL_OPTIONS', 'MAVEN_OPTS'):
            env.pop(key, None)
        maven = args.maven or str(root / 'backend' / ('mvnw.cmd' if os.name == 'nt' else 'mvnw'))
        command = [maven, '-B', '-ntp']
        if os.name != 'nt' and not args.maven:
            command.insert(0, 'sh')
        if args.offline:
            command.append('-o')
        agent = Path(os.environ.get('MOCKITO_AGENT_JAR', str(Path.home() / '.m2/repository/org/mockito/mockito-core/5.17.0/mockito-core-5.17.0.jar')))
        if agent.is_file():
            command.append('-DargLine=-javaagent:' + str(agent))
        print('Running unchanged backend clean verify with disposable PostgreSQL...', flush=True)
        output = run('backend-clean-verify', command + ['clean', 'verify'], cwd=root / 'backend', env=env, timeout=600)
        assert 'BUILD SUCCESS' in output
        suites = [ET.parse(path).getroot().attrib for path in (root / 'backend/target/surefire-reports').glob('TEST-*.xml')]
        totals = {key: sum(int(suite[key]) for suite in suites) for key in ('tests', 'failures', 'errors', 'skipped')}
        assert totals['tests'] >= 62 and not any(totals[key] for key in ('failures', 'errors', 'skipped')), totals
        summary['backendTests'] = totals
        print(f'PASS backend: {totals["tests"]} tests, no failures/errors/skips', flush=True)
        run('browser-database-create', ['docker', 'exec', container, 'createdb', '-U', 'frontend_check', 'frontend_browser'])
        with socket.socket() as backend_probe, socket.socket() as frontend_probe:
            backend_probe.bind(('127.0.0.1', 0)); frontend_probe.bind(('127.0.0.1', 0))
            backend_port, frontend_port = backend_probe.getsockname()[1], frontend_probe.getsockname()[1]
        live_env = env.copy()
        live_env.pop('RUN_DB_TESTS', None)
        live_env.update(DB_URL=f'jdbc:postgresql://127.0.0.1:{port}/frontend_browser',
                        SPRING_PROFILES_ACTIVE='local', SESSION_COOKIE_SECURE='false',
                        LOCAL_DEMO_PASSWORD=secrets.token_urlsafe(24), SERVER_PORT=str(backend_port))
        jar = root / 'backend/target/document-handover-0.1.0-SNAPSHOT.jar'
        summary['jarSha256'] = hashlib.sha256(jar.read_bytes()).hexdigest()
        with (out / 'backend-server.log').open('w', encoding='utf-8') as log:
            server = subprocess.Popen(['java', '-jar', str(jar)], cwd=root / 'backend', env=live_env,
                                      stdout=log, stderr=subprocess.STDOUT,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            deadline = time.monotonic() + 60
            while True:
                if server.poll() is not None:
                    raise RuntimeError('Live backend exited before readiness')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{backend_port}/api/v1/health', timeout=1) as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, TimeoutError):
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError('Live backend readiness timeout')
                time.sleep(0.25)
            browser_env = live_env.copy()
            browser_env.update(LIVE_BASE_URL=f'http://127.0.0.1:{frontend_port}',
                               LIVE_DEMO_PASSWORD=live_env['LOCAL_DEMO_PASSWORD'],
                               API_PROXY_TARGET=f'http://127.0.0.1:{backend_port}')
            print('Running real browser through Vite proxy to Spring/PostgreSQL (no API mocks)...', flush=True)
            output = run('browser-live', ['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'test:live'],
                         cwd=frontend, env=browser_env, timeout=300)
            summary['realBrowserTests'] = int(re.search(r'(\d+) passed', output).group(1))
            assert summary['realBrowserTests'] == 3 and not re.search(r'\d+ (?:failed|skipped)', output)
            summary['realBrowserScope'] = ['session/CSRF/login/logout/401', 'project/membership/Owner/Editor/Viewer/403/404', 'S3-disabled 503 fail-closed']
        summary['status'] = 'PASS_LOCAL_REAL_BACKEND'
    except Exception:
        summary['status'] = 'FAIL'
        raise
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                server.kill(); server.wait(timeout=10)
        if started:
            run('database-remove', ['docker', 'rm', '-f', container])
            summary['testDatabaseRemoved'] = True
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
