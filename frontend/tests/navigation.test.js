import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceHash, projectHash, handoverHash } from '../src/navigation.js';
const id = '10000000-0000-0000-0000-000000000001';
test('C09.02: hash navigation validates project identity and known section names', () => {
  for (const section of ['overview', 'files', 'members', 'draft']) assert.deepEqual(readWorkspaceHash(projectHash(id, section)), { view: 'project', projectId: id, section });
  for (const hash of ['#/projects/bad/files', '#/projects/'+id+'/admin', '#/projects/%2f/files']) assert.equal(readWorkspaceHash(hash).invalid, true);
  assert.equal(projectHash('bad'), '#/projects');
});
test('C09.02: handover navigation is independent of project membership and rejects invalid UUIDs', () => {
  assert.deepEqual(readWorkspaceHash(handoverHash(id)), { view: 'handovers', handoverId: id });
  assert.deepEqual(readWorkspaceHash('#/handovers/bad'), { view: 'handovers', invalid: true });
  assert.equal(handoverHash('bad'), '#/handovers');
});
test('C09.02: workspace roots remain hash-only and fail closed for unsupported URLs', () => {
  for (const hash of ['', '#/', '#/projects']) assert.deepEqual(readWorkspaceHash(hash), { view: 'projects' });
  assert.deepEqual(readWorkspaceHash('#/handovers'), { view: 'handovers' });
  for (const hash of ['#https://outside.example.test', '#/admin', '#/projects?role=OWNER']) assert.equal(readWorkspaceHash(hash).invalid, true);
});
