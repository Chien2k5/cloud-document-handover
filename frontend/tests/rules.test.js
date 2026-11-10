import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOwn, canWrite, isUuid, isVerified } from '../src/rules.js';
test('only Owner edits membership; Viewer and unknown roles cannot upload', () => {
  assert.equal(canOwn({ role: 'OWNER' }), true);
  assert.equal(canWrite({ role: 'EDITOR' }), true);
  for (const role of ['VIEWER', 'ADMIN', undefined]) {
    assert.equal(canOwn({ role }), false); assert.equal(canWrite({ role }), false);
  }
});
test('UUID and verified selection reject invalid or pending values', () => {
  assert.equal(isUuid('10000000-0000-0000-0000-000000000001'), true);
  assert.equal(isUuid('someone@example.test'), false);
  for (const integrityStatus of ['INTEGRITY_PENDING', 'FAILED', 'MISMATCH']) assert.equal(isVerified({ uploadStatus: 'AVAILABLE', integrityStatus }), false);
  assert.equal(isVerified({ uploadStatus: 'PENDING', integrityStatus: 'VERIFIED' }), false);
  assert.equal(isVerified({ uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' }), true);
});
