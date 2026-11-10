import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandoverBody } from '../src/handover.js';
const id = '10000000-0000-0000-0000-000000000001';
test('DRAFT boundaries preserve immutable version IDs, title limit, unique recipients and exact future deadline', () => {
  const now = Date.parse('2030-01-01T00:00:00Z'), file = { id, uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
  const input = { title: 'x'.repeat(200), files: [file, file], recipients: `${id}; ${id}`, expiresAt: '2030-01-01T07:00:00.001+07:00' };
  assert.deepEqual(createHandoverBody(input, now), { title: input.title, fileVersionIds: [id], recipientUserIds: [id], expiresAt: '2030-01-01T00:00:00.001Z' });
  for (const change of [{ title: 'x'.repeat(201) }, { title: '   ' }, { expiresAt: '2030-01-01T00:00:00Z' }, { expiresAt: 'invalid' }, ...['INTEGRITY_PENDING', 'FAILED', 'MISMATCH'].map(integrityStatus => ({ files: [{ ...file, integrityStatus }] })), { files: [{ ...file, uploadStatus: 'PENDING' }] }]) assert.throws(() => createHandoverBody({ ...input, ...change }, now), e => e.code === 'VALIDATION_ERROR');
  assert.equal(input.files.length, 2); assert.equal(input.recipients, `${id}; ${id}`);
});
