import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadUrl, updateVersion } from '../src/files.js';
test('a late response for another upload cannot replace a pinned version', () => {
  const first = { id: 'v1', uploadId: 'u1', versionId: 's3-v1' }, second = { id: 'v2', uploadId: 'u2', versionId: 's3-v2' };
  assert.deepEqual(updateVersion([first, second], { id: 'v1', uploadId: 'u2', versionId: 'wrong' }), [first, second]);
  const updated = updateVersion([first, second], { ...second, integrityStatus: 'VERIFIED' });
  assert.deepEqual(updated[0], first); assert.equal(updated[1].versionId, 's3-v2');
});
test('download links must be HTTPS, unexpired and have no embedded user credentials', () => {
  const expiresAt = new Date(Date.now() + 30000).toISOString();
  assert.equal(downloadUrl({ url: 'https://s3.example.test/key?versionId=v1', expiresAt }), 'https://s3.example.test/key?versionId=v1');
  for (const url of ['javascript:alert(1)', 'http://s3.example.test/key', 'https://user:password@s3.example.test/key']) assert.throws(() => downloadUrl({ url, expiresAt }));
  assert.throws(() => downloadUrl({ url: 'https://s3.example.test/key', expiresAt: '2000-01-01T00:00:00Z' }));
});

test('late pending responses cannot downgrade a terminal checksum or change exact S3 identity', () => {
  for (const integrityStatus of ['VERIFIED', 'MISMATCH']) {
    const saved = { id: 'v1', uploadId: 'u1', versionId: 's3-v1', uploadStatus: 'AVAILABLE', integrityStatus };
    for (const incoming of [{ ...saved, integrityStatus: 'INTEGRITY_PENDING' }, { ...saved, integrityStatus: 'FAILED' },
      { ...saved, integrityStatus: integrityStatus === 'VERIFIED' ? 'MISMATCH' : 'VERIFIED' }, { ...saved, versionId: 's3-v2' }]) {
      assert.deepEqual(updateVersion([saved], incoming), [saved]);
    }
  }
  const failed = { id: 'v1', uploadId: 'u1', versionId: 's3-v1', uploadStatus: 'AVAILABLE', integrityStatus: 'FAILED' };
  assert.equal(updateVersion([failed], { ...failed, integrityStatus: 'VERIFIED' })[0].integrityStatus, 'VERIFIED');
});
