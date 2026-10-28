"""Package a clean tracked backend snapshot and curated evidence, excluding runtime data/secrets.

Run after committing. Creates output/backend-handover-dung.zip and a sidecar manifest.
This is a backend source handover, not a complete AWS/frontend/Lambda release.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from datetime import datetime, timezone
import zipfile


PREFIXES = ('backend/src/', 'backend/tools/', 'backend/.mvn/', 'contracts/',
            'docs/week-01/', 'docs/week-02/', 'docs/week-03/', 'docs/week-04/', 'docs/week-05/',
            'evidence/week-01/', 'evidence/week-02/', 'evidence/week-03/', 'evidence/week-04/', 'evidence/week-05/')
EXACT = {'README.md', 'PRINCIPLE.MD', '.gitignore', '.gitattributes', '.env.example',
         'backend/README.md', 'backend/.env.example', 'backend/pom.xml', 'backend/mvnw', 'backend/mvnw.cmd'}
DENIED_PARTS = {'.git', 'target', 'runtime-data', 'backups', 'logs', 'node_modules', '__pycache__', 'output'}
DENIED_SUFFIXES = {'.pem', '.key', '.dump', '.bak', '.log', '.jar', '.class', '.pyc', '.p12', '.jks', '.zip'}
SECRET_PATTERNS = [rb'(?:AKIA|ASIA)[A-Z0-9]{16}', rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                   rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'github_pat_[A-Za-z0-9_]{30,}', rb'X-Amz-Signature=[0-9a-f]{64}']
ARCHIVE_ROOT = 'backend-handover-dung/'


def allowed(name):
    return name in EXACT or name.startswith(PREFIXES)


def git(root, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=root).decode('utf-8').strip()


def add(archive, name, data, executable=False):
    entry = zipfile.ZipInfo(ARCHIVE_ROOT + name, date_time=(2020, 1, 1, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_DEFLATED
    entry.create_system = 3
    entry.external_attr = (0o100755 if executable else 0o100644) << 16
    archive.writestr(entry, data, compresslevel=9)


def main():
    root = Path(__file__).resolve().parents[2]
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD'], cwd=root).returncode != 0:
        raise RuntimeError('Commit tracked changes before building a bundle with an exact source revision')
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root).decode('utf-8')
    if any(allowed(name) for name in untracked.split('\0') if name):
        raise RuntimeError('Untracked files inside the handover scope must be reviewed before packaging')
    head = git(root, 'rev-parse', 'HEAD')
    entries = subprocess.check_output(['git', 'ls-files', '-s', '-z'], cwd=root).decode('utf-8')
    files = {}
    payload = {}
    for entry in entries.split('\0'):
        if not entry:
            continue
        metadata, name = entry.split('\t', 1)
        mode, _, stage = metadata.split()
        if not allowed(name):
            continue
        path = PurePosixPath(name)
        if stage != '0' or mode not in {'100644', '100755'} or path.is_absolute() or '..' in path.parts:
            raise RuntimeError('Unsafe Git entry in handover scope: ' + name)
        if DENIED_PARTS.intersection(path.parts) or path.suffix.lower() in DENIED_SUFFIXES:
            raise RuntimeError('Runtime/binary/secret-shaped path must not be packaged: ' + name)
        if any(part.startswith('.env') and part != '.env.example' for part in path.parts):
            raise RuntimeError('Only .env.example may be packaged')
        local = (root / name).resolve()
        if not local.is_relative_to(root.resolve()):
            raise RuntimeError('File resolved outside repository: ' + name)
        data = local.read_bytes()
        if any(re.search(pattern, data) for pattern in SECRET_PATTERNS):
            raise RuntimeError('Potential credential/signature pattern; review file before packaging: ' + name)
        files[name] = dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        payload[name] = (data, mode == '100755' or name == 'backend/mvnw')
    required = {'README.md', 'backend/pom.xml', 'backend/mvnw', 'backend/mvnw.cmd',
                'backend/.mvn/wrapper/maven-wrapper.properties', 'contracts/openapi.yaml',
                'docs/week-05/final-handover.md', 'docs/week-05/report.md'}
    if not required.issubset(files):
        raise RuntimeError('Missing required source/handover documents')
    manifest = dict(sourceCommit=head, branch=git(root, 'branch', '--show-current'),
                    sourceCommitTime=git(root, 'show', '-s', '--format=%cI', 'HEAD'),
                    scope='BACKEND_SOURCE_AND_CURATED_EVIDENCE', cloudAcceptance='NOT RUN',
                    fakeStorage='test source only', fileCount=len(files), files=files,
                    limitations=['No frontend, AWS adapter, Lambda or deployment resources in this bundle',
                                 'Historical evidence remains labeled by week; use week-05 for the latest run',
                                 'Pattern scanning complements review; it is not a guarantee against every secret format'])
    output = root / 'output'
    output.mkdir(exist_ok=True)
    destination = output / 'backend-handover-dung.zip'
    with zipfile.ZipFile(destination, 'w') as archive:
        for name in sorted(payload):
            add(archive, name, payload[name][0], payload[name][1])
        add(archive, 'BUNDLE-MANIFEST.json', (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Archive CRC check failed')
        for name, details in files.items():
            if hashlib.sha256(archive.read(ARCHIVE_ROOT + name)).hexdigest() != details['sha256']:
                raise RuntimeError('Archived file differs from recorded hash: ' + name)
    sidecar = dict(manifest, archiveSha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                   archiveBytes=destination.stat().st_size, archiveCrcAndHashes='PASS',
                   builtAtUTC=datetime.now(timezone.utc).isoformat())
    (output / 'backend-handover-dung.manifest.json').write_text(json.dumps(sidecar, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(dict(status='PASS', sourceCommit=head, fileCount=len(files),
                          archive=str(destination), archiveBytes=sidecar['archiveBytes'],
                          archiveSha256=sidecar['archiveSha256']), ensure_ascii=False))


if __name__ == '__main__':
    main()
