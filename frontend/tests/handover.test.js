import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandoverBody, handoverPermissions } from '../src/handover.js';
const id = '10000000-0000-0000-0000-000000000001', recipient = '20000000-0000-0000-0000-000000000002';
const file = { id, uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
test('DRAFT payload is complete, unique, UTC and rejects unverified/past/invalid recipient', () => {
  const input = { title: ' Draft ', files: [file], recipients: recipient + ', ' + recipient, expiresAt: '2099-01-01T12:00:00+07:00' };
  assert.deepEqual(createHandoverBody(input), { title: 'Draft', fileVersionIds: [id], recipientUserIds: [recipient], expiresAt: '2099-01-01T05:00:00.000Z' });
  for (const changes of [{ title: '' }, { recipients: '' }, { recipients: 'bad' }, { expiresAt: '2000-01-01T00:00:00Z' }, { files: [{ ...file, integrityStatus: 'MISMATCH' }] }, { files: [] }]) assert.throws(() => createHandoverBody({ ...input, ...changes }));
});
test('Owner publishes; only assigned recipient confirms; revoke/expiry disable new downloads', () => {
  const h = { projectId: id, status: 'DRAFT', accessStatus: 'ACTIVE', expiresAt: '2099-01-01T00:00:00Z', recipients: [{ userId: recipient, accessStatus: 'ACTIVE', confirmedAt: null }] };
  const project = { id, role: 'OWNER' };
  assert.equal(handoverPermissions(h, project, id).publish, true);
  assert.equal(handoverPermissions(h, { id, role: 'VIEWER' }, id).publish, false);
  assert.equal(handoverPermissions({ ...h, status: 'READY' }, project, id).confirm, false);
  assert.equal(handoverPermissions({ ...h, status: 'READY' }, null, recipient).confirm, true);
  for (const changes of [{ accessStatus: 'REVOKED' }, { expiresAt: '2000-01-01T00:00:00Z' }]) {
    const permissions = handoverPermissions({ ...h, status: 'READY', ...changes }, project, recipient);
    assert.equal(permissions.confirm, false); assert.equal(permissions.download, false); assert.equal(permissions.publish, false);
  }
});
