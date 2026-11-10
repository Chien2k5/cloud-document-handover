import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.js';
import { completeUpload, fileSha256, MAX_FILE_BYTES, pollUpload, startUpload } from '../src/upload.js';
const bytes = new File(['abc'], 'hello.txt', { type: 'text/plain' });
const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
function fixture({ completeError } = {}) {
  const calls = [];
  return { calls, async request(path, options = {}) {
    calls.push({ path, ...options });
    if (path.endsWith('/complete')) { if (completeError) throw completeError; return { fileVersion: { uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING' } }; }
    return { uploadId: 'upload', fileVersionId: 'version', fileId: 'file', presignedUpload: { method: 'PUT', url: 'https://s3.example.test/object?fixture=not-a-signature', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } };
  } };
}
test('SHA-256 uses exact bytes and rejects empty/oversize before creating any upload', async () => {
  assert.equal(await fileSha256(bytes), digest);
  for (const size of [0, MAX_FILE_BYTES + 1]) await assert.rejects(fileSha256({ size }), e => e.code === 'INVALID_FILE_SIZE');
});
test('S3 receives original file and every signed header, no credentials/CSRF; complete pins opaque version', async () => {
  const api = fixture(), sessions = [];
  const result = await startUpload(api, 'project', bytes, { fileId: 'existing-file', onSession: value => sessions.push({ ...value }), fetchImpl: async (_url, options) => {
    assert.equal(options.body, bytes); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { 'Content-Type': 'text/plain', 'If-None-Match': '*' });
    assert.equal(options.redirect, 'error');
    return new Response(null, { headers: { 'x-amz-version-id': 'v+/=%' } });
  } });
  assert.deepEqual(api.calls[0].body, { filename: 'hello.txt', contentType: 'text/plain', size: 3, expectedSha256: digest, fileId: 'existing-file' });
  assert.deepEqual(api.calls[1].body, { versionId: 'v+/=%' });
  assert.equal(result.state.fileVersion.integrityStatus, 'INTEGRITY_PENDING');
  assert.equal(sessions[0].versionId, null); assert.equal(sessions[1].versionId, 'v+/=%');
  assert.ok(sessions.every(session => !JSON.stringify(session).includes('https:')));
});
test('missing/null/blank Version ID and S3 errors never complete or retry PUT', async () => {
  for (const headers of [{}, { 'x-amz-version-id': 'null' }, { 'x-amz-version-id': ' ' }]) {
    const api = fixture(); let puts = 0;
    await assert.rejects(startUpload(api, 'p', bytes, { fetchImpl: async () => { puts++; return new Response(null, { headers }); } }), e => e.code === 'MISSING_VERSION_ID');
    assert.equal(api.calls.length, 1); assert.equal(puts, 1);
  }
  for (const status of [409, 412, 403, 503]) {
    const api = fixture(); let puts = 0;
    await assert.rejects(startUpload(api, 'p', bytes, { fetchImpl: async () => { puts++; return new Response(null, { status }); } }), e => e.status === status);
    assert.equal(api.calls.length, 1); assert.equal(puts, 1);
  }
});
test('complete 503 retains version and explicit retry sends the same version only', async () => {
  const api = fixture({ completeError: new ApiError(503, 'STORAGE_UNAVAILABLE') }); let saved;
  await assert.rejects(startUpload(api, 'p', bytes, { onSession: value => { saved = { ...value }; }, fetchImpl: async () => new Response(null, { headers: { 'x-amz-version-id': 'original' } }) }));
  const retried = fixture(); await completeUpload(retried, saved);
  assert.deepEqual(retried.calls[0].body, { versionId: 'original' }); assert.equal(retried.calls.length, 1);
});
test('poll is bounded, respects terminal/mismatch/failed, propagates 503 and can resume FAILED manually', async () => {
  for (const integrityStatus of ['VERIFIED', 'MISMATCH', 'FAILED']) {
    let calls = 0;
    const result = await pollUpload({ request: async () => { calls++; return { fileVersion: { uploadStatus: 'AVAILABLE', integrityStatus } }; } }, 'p', 'u', { attempts: 3, delayMs: 0 });
    assert.equal(result.stopped, 'status'); assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await pollUpload({ request: async () => { calls++; return { fileVersion: { uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING' } }; } }, 'p', 'u', { attempts: 3, delayMs: 0 });
  assert.equal(calls, 3); assert.equal(result.stopped, 'limit');
  await assert.rejects(pollUpload({ request: async () => { throw new ApiError(503, 'STORAGE_UNAVAILABLE'); } }, 'p', 'u'));
});
test('PUT network/timeout and abort stop the flow without a guessed version', async () => {
  const api = fixture();
  await assert.rejects(startUpload(api, 'p', bytes, { fetchImpl: async () => { throw new TypeError('offline'); } }), e => e.code === 'S3_NETWORK_ERROR');
  assert.equal(api.calls.length, 1);
  await assert.rejects(startUpload(fixture(), 'p', bytes, { putTimeoutMs: 5, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')))) }), e => e.code === 'S3_TIMEOUT');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startUpload(fixture(), 'p', bytes, { signal: controller.signal }), e => e.name === 'AbortError');
});

test('binary bytes, unknown content type and cancellation during hashing preserve initialization boundaries', async () => {
  const binary = new File([new Uint8Array([0, 255, 128, 13, 10])], 'du lieu.bin');
  const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([0, 255, 128, 13, 10]))), b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await fileSha256(binary), expected);
  const api = fixture();
  await startUpload(api, 'p', binary, { fetchImpl: async () => new Response(null, { headers: { 'x-amz-version-id': 'binary-v1' } }) });
  assert.equal(api.calls[0].body.contentType, 'application/octet-stream');
  assert.equal(api.calls[0].body.size, 5); assert.equal(api.calls[0].body.expectedSha256, expected);
  assert.ok(!Object.hasOwn(api.calls[0].body, 'fileId'));
  const controller = new AbortController(); let initCalls = 0;
  const interrupted = { size: 3, arrayBuffer: async () => { controller.abort(); return new Uint8Array([1, 2, 3]).buffer; } };
  await assert.rejects(startUpload({ request: () => { initCalls++; } }, 'p', interrupted, { signal: controller.signal }), e => e.name === 'AbortError');
  assert.equal(initCalls, 0);
  const failing = { request: async () => { initCalls++; throw new ApiError(0, 'REQUEST_TIMEOUT'); } };
  await assert.rejects(startUpload(failing, 'p', bytes), e => e.code === 'REQUEST_TIMEOUT');
  assert.equal(initCalls, 1);
});
