"""Reproducible PRE_AWS checks. Docker/JDK/keytool/Node/browser required; no AWS access.

Creates a unique ignored result directory and never overwrites an earlier result.
The two real-backend runs each own and dispose of a new PostgreSQL container.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--offline', action='store_true', help='Use cached Maven dependencies')
    cli.add_argument('--maven', help='Optional Maven executable')
    args = cli.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = root / 'runtime-data' / ('preaws-' + uuid.uuid4().hex)
    out.mkdir(parents=True, exist_ok=False)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    result = {'status': 'RUNNING', 'startedAt': datetime.now(timezone.utc).isoformat(),
              'AWS_REAL_E2E': 'NOT_RUN', 'ciEnvironment': os.environ.get('GITHUB_ACTIONS') == 'true'}

    def run(label, command, cwd=root, timeout=900):
        print('Checking ' + label + '...', flush=True)
        try:
            checked = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                                     encoding='utf-8', errors='replace', timeout=timeout)
        except subprocess.TimeoutExpired as error:
            def decoded(value):
                return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else (value or '')
            output = decoded(error.stdout) + decoded(error.stderr)
            (out / (label + '.log')).write_text(output, encoding='utf-8')
            print(f'{label} timed out after {timeout}s; partial output:', file=sys.stderr, flush=True)
            print(output, file=sys.stderr, flush=True)
            raise
        with (out / (label + '.log')).open('x', encoding='utf-8') as log:
            log.write(checked.stdout + checked.stderr)
        if checked.returncode:
            print(f'{label} failed with exit code {checked.returncode}; output:', file=sys.stderr, flush=True)
            print(checked.stdout + checked.stderr, file=sys.stderr, flush=True)
            raise RuntimeError(label + ' failed; inspect ' + str(out / (label + '.log')))
        return checked.stdout + checked.stderr

    def hashes(directory):
        return {path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(directory.rglob('*')) if path.is_file()}

    try:
        result['sourceCommit'] = run('source', ['git', 'rev-parse', 'HEAD']).strip()
        result['workingTreeDirty'] = bool(run('status', ['git', 'status', '--porcelain']).strip())
        names = run('source-files', ['git', 'ls-files', '--cached', '--others', '--exclude-standard']).splitlines()
        result['sourceHashes'] = {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                                  for name in names if (root / name).is_file()}
        run('npm-ci', [npm, 'ci'], root / 'frontend')
        run('frontend-lint', [npm, 'run', 'lint'], root / 'frontend')
        unit = run('frontend-unit', [npm, 'test'], root / 'frontend')
        counts = re.search(r'tests (\d+).*?pass (\d+).*?fail (\d+).*?skipped (\d+)', unit, re.S)
        if not counts or counts[1] != counts[2] or counts[3] != '0' or counts[4] != '0':
            raise RuntimeError('Frontend unit counts missing or incomplete')
        result['UNIT_MOCK'] = int(counts[1])
        run('frontend-build-1', [npm, 'run', 'build'], root / 'frontend')
        first = hashes(root / 'frontend/dist')
        run('frontend-build-2', [npm, 'run', 'build'], root / 'frontend')
        if not first or first != hashes(root / 'frontend/dist'):
            raise RuntimeError('Frontend artifacts are not byte reproducible')
        result['frontendArtifactHashes'] = first
        mock = run('browser-mock', [npm, 'run', 'test:e2e'], root / 'frontend')
        match = re.search(r'(\d+) passed', mock)
        if not match or re.search(r'\d+ (?:failed|skipped)', mock):
            raise RuntimeError('Browser mock suite incomplete')
        result['BROWSER_MOCK'] = int(match[1])
        audit = json.loads(run('npm-audit', [npm, 'audit', '--json'], root / 'frontend'))
        if audit['metadata']['vulnerabilities']['total'] != 0:
            raise RuntimeError('npm audit findings require review')
        result['npmAuditVulnerabilities'] = 0
        python = run('python-offline', [sys.executable, '-m', 'unittest', 'discover', '-s', 'aws/tests', '-v'])
        match = re.search(r'Ran (\d+) tests', python)
        if not match or not re.search(r'\bOK\b', python):
            raise RuntimeError('Python suite counts missing')
        result['PYTHON_OFFLINE'] = int(match[1])
        live = [sys.executable, 'frontend/tools/run_live_check.py']
        if args.offline:
            live.append('--offline')
        if args.maven:
            live += ['--maven', args.maven]
        summaries = []
        for label, extra in [('real-backend', []), ('business-storage', ['--business'])]:
            evidence = out / (label + '.json')
            run(label, live + extra + ['--evidence', evidence.relative_to(root).as_posix()])
            summaries.append(json.loads(evidence.read_text(encoding='utf-8')))
        ordinary, business = summaries
        assert ordinary['status'] == 'PASS_LOCAL_REAL_BACKEND'
        assert business['status'] == 'PASS_LOCAL_REAL_BACKEND_WITH_TEST_STORAGE'
        assert ordinary['jarSha256'] == business['jarSha256'], 'Backend JAR not byte reproducible'
        assert business['productionJarExcludesFixture']
        result['backendArtifactSha256'] = business['jarSha256']
        for summary in summaries:
            result[summary['testLevel']] = {'browserTests': summary['realBrowserTests'],
                'backendTests': summary['backendTests'], 'testDatabaseRemoved': summary['testDatabaseRemoved']}
        contract = run('java-python-contract', [sys.executable, 'aws/tests/check_java_contract.py',
            '--backend-jar', 'backend/target/document-handover-0.1.0-SNAPSHOT.jar'])
        match = re.search(r'PASS Java production checksum parser and result key: (\d+) cases', contract)
        if not match:
            raise RuntimeError('Missing Java/Python contract evidence')
        result['JAVA_PYTHON_CONTRACT'] = int(match[1])
        result['status'] = 'PASS_PRE_AWS_CHECKS'
    except Exception:
        result['status'] = 'FAIL'
        raise
    finally:
        result['completedAt'] = datetime.now(timezone.utc).isoformat()
        with (out / 'verification.json').open('x', encoding='utf-8') as destination:
            json.dump(result, destination, ensure_ascii=False, indent=2)
            destination.write('\n')
        print(json.dumps({key: value for key, value in result.items() if key != 'sourceHashes'}, ensure_ascii=True), flush=True)
        print('Evidence: ' + str(out), flush=True)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as destination:
                destination.write('PRE_AWS: ' + result['status'] + '; AWS_REAL_E2E: NOT_RUN\n')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
