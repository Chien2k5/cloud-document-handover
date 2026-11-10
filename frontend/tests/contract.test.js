import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ApiClient } from '../src/api.js';
import { startUpload, pollUpload } from '../src/upload.js';
import { createHandoverBody } from '../src/handover.js';
const root = new URL('../../', import.meta.url);
const contract = YAML.parse(fs.readFileSync(new URL('contracts/openapi.yaml', root), 'utf8'));
const trace = JSON.parse(fs.readFileSync(new URL('frontend/tests/endpoint-trace.json', root), 'utf8'));
const shape = (name, body) => {
  const schema = contract.components.schemas[name];
  assert.ok(schema, name);
  for (const key of schema.required || []) assert.ok(Object.hasOwn(body, key), `${name}.${key} required`);
  for (const key of Object.keys(body)) assert.ok(Object.hasOwn(schema.properties, key), `${name}.${key} not declared`);
};
test('all declared operations trace to existing controller, frontend caller and integration test', () => {
  const actual = Object.entries(contract.paths).flatMap(([path, operations]) => Object.entries(operations)
    .filter(([method]) => ['get', 'post', 'put', 'delete'].includes(method)).map(([method, operation]) => `${method} ${path} ${operation.operationId}`));
  assert.deepEqual(trace.map(row => `${row.method} ${row.path} ${row.operationId}`).sort(), actual.sort());
  for (const row of trace) {
    const controller = fs.readFileSync(new URL(row.controller, root), 'utf8');
    assert.match(controller, new RegExp(`\\b${row.controllerMethod}\\(`));
    assert.ok(fs.existsSync(fileURLToPath(new URL(row.backendTest, root))));
    if (row.frontend) assert.ok(fs.readFileSync(new URL(row.frontend, root), 'utf8').includes(row.caller));
  }
});
test('actual auth serialization matches form schema and no-body logout contract', async () => {
  const login = contract.paths['/api/v1/auth/login'].post;
  assert.ok(login.requestBody.content['application/x-www-form-urlencoded']);
  assert.equal(contract.paths['/api/v1/auth/logout'].post.requestBody, undefined);
  const api = new ApiClient({ fetchImpl: async (path, options) => {
    if (path.endsWith('/csrf')) return Response.json({ headerName: 'X-Contract-CSRF', token: 'fixture' });
    if (path.endsWith('/login')) {
      shape('Login', Object.fromEntries(new URLSearchParams(options.body)));
      assert.equal(options.headers['X-Contract-CSRF'], 'fixture');
    }
    if (path.endsWith('/logout')) { assert.equal(options.body, undefined); return new Response(null, { status: 204 }); }
    return Response.json({ id: 'fixture-user' });
  } });
  await api.login('fixture@example.test', 'fixture-only'); await api.logout();
});
test('upload and handover helpers produce schema field sets and exact opaque Version ID', async () => {
  const file = new File(['abc'], 'contract.txt', { type: 'text/plain' });
  const methods = [];
  const api = { request: async (path, options = {}) => {
    methods.push(options.method || 'GET');
    if (path.endsWith('/complete')) { shape('CompleteUpload', options.body); assert.equal(options.body.versionId, 'opaque+/=%'); return { fileVersion: { uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING' } }; }
    if (path.endsWith('/uploads')) {
      shape('UploadRequest', options.body); assert.match(options.body.expectedSha256, /^[0-9a-f]{64}$/);
      return { uploadId: 'upload', fileVersionId: 'version', presignedUpload: { method: 'PUT', url: 'https://s3.example.test/contract', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } };
    }
    return { fileVersion: { uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' } };
  } };
  await startUpload(api, 'project', file, { fetchImpl: async () => new Response(null, { headers: { 'x-amz-version-id': 'opaque+/=%' } }) });
  await pollUpload(api, 'project', 'upload'); assert.deepEqual(methods, ['POST', 'POST', 'GET']);
  const id = '10000000-0000-0000-0000-000000000001';
  shape('CreateHandover', createHandoverBody({ title: 'Contract', files: [{ id, uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' }], recipients: id, expiresAt: '2099-01-01T00:00:00Z' }));
  assert.ok(contract.components.schemas.FileVersion.required.includes('uploadId'));
  assert.deepEqual(new Set(contract.components.schemas.IntegrityStatus.enum), new Set(['INTEGRITY_PENDING', 'VERIFIED', 'MISMATCH', 'FAILED']));
});
