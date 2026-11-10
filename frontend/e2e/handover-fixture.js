import { mockProject, workspaceView } from './fixtures.js';
export const projectId = '10000000-0000-0000-0000-000000000001';
export const recipientId = '50000000-0000-0000-0000-000000000005';
export const handoverId = '70000000-0000-0000-0000-000000000007';
export const file = { id: '20000000-0000-0000-0000-000000000002', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000004', filename: 'handover.txt', size: 3, versionId: 'pinned-v1+/=', uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED', expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64) };
export const manifest = (changes = {}) => ({ id: handoverId, projectId, title: 'Gói kiểm thử bàn giao', status: 'DRAFT', accessStatus: 'ACTIVE', expiresAt: '2099-01-01T05:00:00Z', items: [{ fileVersionId: file.id, filename: file.filename, versionId: file.versionId, expectedSha256: file.expectedSha256 }], recipients: [{ userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: null }], ...changes });
export async function setupHandover(page, { role = 'OWNER', userId = projectId, value = manifest(), items = [file], extra = async () => false } = {}) {
  const current = { value }, calls = [];
  await mockProject(page, role, async (route, project, user) => {
    user.id = userId;
    if (await extra(route, current, project, user)) return true;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items, page: 0, size: 20 } }); return true; }
    if (path.endsWith('/handovers/' + handoverId)) { calls.push({ method: 'GET', path }); await route.fulfill({ json: current.value }); return true; } return false;
  });
  return { current, calls };
}
export async function openHandover(page, id = handoverId) { await workspaceView(page, 'Mở gói bàn giao'); await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(id); await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click(); }
export async function fillDraft(page, { title = 'Gói kiểm thử', recipients = recipientId, deadline = '2099-01-01T12:00' } = {}) { await page.getByLabel('Tiêu đề bàn giao', { exact: true }).fill(title); await page.getByLabel('UUID người nhận', { exact: true }).fill(recipients); await page.getByLabel('Hạn bàn giao (giờ trên máy bạn)', { exact: true }).fill(deadline); }
