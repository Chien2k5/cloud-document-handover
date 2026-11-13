import ast
import hashlib
import io
import json
import re
import sys
import types
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[3]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python offline_probe.py PATH_TO_REVIEWED_SOURCE_DIRECTORY')
source_dir = Path(sys.argv[1]).resolve()
adapter_path = source_dir / 's3_adapter.py'
source = adapter_path.read_text(encoding='utf-8-sig')
for name in ('s3_adapter.py', 'test_adapter.py'):
    ast.parse((source_dir / name).read_text(encoding='utf-8-sig'), filename=name)

class FakeS3:
    def __init__(self):
        self.calls = []
        self.body = b'{}'
        self.last_stream = None
    def generate_presigned_url(self, operation, **kwargs):
        self.calls.append((operation, kwargs))
        return 'https://storage.example.invalid/offline-placeholder'
    def head_object(self, **kwargs):
        self.calls.append(('head_object', kwargs))
        return {'VersionId': 'v2-other-upload', 'ContentLength': 7, 'ContentType': 'text/plain'}
    def get_object(self, **kwargs):
        self.calls.append(('get_object', kwargs))
        self.last_stream = io.BytesIO(self.body)
        return {'Body': self.last_stream}

fake = FakeS3()
client_calls = []
def fake_client(*args, **kwargs):
    client_calls.append({'args': args, 'kwargs': kwargs})
    return fake
fake_boto = types.ModuleType('boto3')
fake_boto.client = fake_client
fake_botocore = types.ModuleType('botocore')
fake_config = types.ModuleType('botocore.config')
fake_config.Config = lambda **kwargs: kwargs
sys.modules.update({'boto3': fake_boto, 'botocore': fake_botocore, 'botocore.config': fake_config})
namespace = {'__name__': 'offline_review_dang_adapter'}
exec(compile(source, str(adapter_path), 'exec'), namespace)
key = 'uploads/project/upload-id'
version = 'v1+opaque/='
signed = namespace['create_upload_url'](key)
put_params = fake.calls[-1][1]['Params']
namespace['create_download_url'](key, version)
get_params = fake.calls[-1][1]['Params']
latest = namespace['get_latest_version'](key)
head_params = fake.calls[-1][1]
namespace['get_checksum_result'](key, version)
result_key = fake.calls[-1][1]['Key']
canonical = 'results/' + '/'.join(hashlib.sha256(x.encode()).hexdigest() for x in (namespace['BUCKET'], key, version)) + '.json'
namespace['validate_version_id']('null')
namespace['validate_expires'](3600)
fake.body = json.dumps({'padding': 'x' * 70000}).encode()
large = namespace['get_checksum_result'](key, version)
readme = (source_dir / 'README_S3_ADAPTER.md').read_text(encoding='utf-8-sig')
sample = json.loads(re.search(r'\{[\s\S]*?\}', readme).group())
schema = json.loads((root / 'contracts/checksum-result.schema.json').read_text(encoding='utf-8'))
tree = ast.parse((source_dir / 'test_adapter.py').read_text(encoding='utf-8-sig'))
assertions = sum(isinstance(node, ast.Assert) for node in ast.walk(tree))
result = {
    'recordedAt': datetime.now(timezone(timedelta(hours=7))).isoformat(),
    'mode': 'OFFLINE_WITH_STUB_BOTO3_NO_AWS_CALLS_NO_ORIGINAL_TEST_EXECUTION',
    'reviewStatus': 'COMPATIBILITY_GAPS_FOUND',
    'sourceHashes': {name: hashlib.sha256((source_dir / name).read_bytes()).hexdigest() for name in ('s3_adapter.py','test_adapter.py','README_S3_ADAPTER.md')},
    'findings': {
        'pythonSourcesParse': True,
        'putReturnsOnlyUrlString': isinstance(signed, str),
        'putSignsContentType': 'ContentType' in put_params,
        'putSignsIfNoneMatch': 'IfNoneMatch' in put_params,
        'downloadPinsRequestedVersion': get_params.get('VersionId') == version,
        'headPinsRequestedVersion': 'VersionId' in head_params,
        'latestCanDifferFromOriginalUpload': latest != version,
        'checksumKeyMatchesProposedBackendKey': result_key == canonical,
        'rawOpaqueVersionUsedInResultPath': version in result_key,
        'readmeChecksumMissingRequiredFields': sorted(set(schema['required']) - set(sample)),
        'readmeChecksumUnknownFields': sorted(set(sample) - set(schema['properties'])),
        'readmeChecksumStatusSupported': sample['status'] in schema['properties']['status']['enum'],
        'checksumReadAcceptsDocumentLargerThan64KiB': len(fake.body) > 65536 and len(large['padding']) == 70000,
        'checksumBodyClosedAfterRead': fake.last_stream.closed,
        'literalNullVersionAccepted': True,
        'expires3600Accepted': True,
        'explicitNetworkTimeoutConfigured': any(k in client_calls[0]['kwargs']['config'] for k in ('connect_timeout','read_timeout')),
        'assertStatementsInProvidedTest': assertions,
    },
    'interpretation': 'Compatibility gaps observed; no real AWS, IAM, CORS, Versioning, signing or Lambda acceptance result is inferred.'
}
out = root / 'output/dang-adapter-review'
out.mkdir(parents=True, exist_ok=True)
(out / 'offline-review.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
