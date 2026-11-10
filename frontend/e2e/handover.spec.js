import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const projectId = '10000000-0000-0000-0000-000000000001';
const fileId = '20000000-0000-0000-0000-000000000001';
const v1 = '30000000-0000-0000-0000-000000000001', v2 = '30000000-0000-0000-0000-000000000002';
const handoverId = '40000000-0000-0000-0000-000000000001';
const recipientId = '50000000-0000-0000-0000-000000000001';
const file = { id: v1, fileId, uploadId: '60000000-0000-0000-0000-000000000001', versionId: 's3-v1', filename: 'v1.txt', size: 3, expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
function handover(changes = {}) {
  return { id: handoverId, projectId, title: 'Gói fixture', status: 'DRAFT', accessStatus: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000).toISOString(),
    items: [{ fileVersionId: v1, filename: file.filename, versionId: file.versionId, expectedSha256: file.expectedSha256 }],
    recipients: [{ userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: null }], ...changes };
}
async function open(page) {
  await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(handoverId);
  await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click();
}
test('mock backend: complete DRAFT payload pins selected v1 after v2; Owner publishes, downloads v1 and revokes', async ({ page }) => {
  let value = handover(), secondVersion = false, created = false;
  await mockProject(page, 'OWNER', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: secondVersion ? [file, { ...file, id: v2, versionId: 's3-v2', uploadId: v2 }] : [file], page: 0, size: 20 } }); return true; }
    if (path.endsWith('/projects/' + projectId + '/handovers')) {
      const body = request.postDataJSON();
      expect(body.fileVersionIds).toEqual([v1]); expect(body.recipientUserIds).toEqual([recipientId]);
      expect(body.title).toBe('Gói test'); expect(body.expiresAt).toMatch(/Z$/);
      expect(Object.keys(body).sort()).toEqual(['title', 'fileVersionIds', 'recipientUserIds', 'expiresAt'].sort());
      created = true; await route.fulfill({ status: 201, json: value }); return true;
    }
    if (path.endsWith('/publish') || path.endsWith('/revoke')) {
      expect(request.postData()).toBeNull();
      value = path.endsWith('/publish') ? { ...value, status: 'READY' } : { ...value, accessStatus: 'REVOKED' };
      await route.fulfill({ json: value }); return true;
    }
    if (path.endsWith('/handovers/' + handoverId)) { await route.fulfill({ json: value }); return true; }
    if (path.endsWith('/download')) {
      expect(path).toContain(`/items/${v1}/download`);
      await route.fulfill({ json: { url: 'https://s3.example.test/item?versionId=s3-v1', versionId: 's3-v1', expiresAt: new Date(Date.now() + 60000).toISOString() } }); return true;
    }
    return false;
  });
  await page.getByLabel(`Chọn bàn giao v1.txt · ${v1}`, { exact: true }).check();
  secondVersion = true; await page.getByRole('button', { name: 'Tải lại danh sách file' }).click();
  await expect(page.getByLabel(`Chọn bàn giao v1.txt · ${v2}`, { exact: true })).toBeVisible();
  await page.getByLabel('Tiêu đề bàn giao', { exact: true }).fill('Gói test');
  await page.getByLabel('UUID người nhận', { exact: true }).fill(recipientId);
  await page.getByLabel('Hạn bàn giao (giờ trên máy bạn)', { exact: true }).fill('2099-01-01T12:00');
  await page.getByRole('button', { name: 'Tạo DRAFT', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Phát hành gói' })).toBeVisible(); expect(created).toBe(true);
  await page.getByRole('button', { name: 'Phát hành gói' }).click();
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lấy link tải item v1.txt' }).click();
  await expect(page.getByRole('link', { name: 'Tải item đúng phiên bản' })).toHaveAttribute('href', 'https://s3.example.test/item?versionId=s3-v1');
  await page.getByRole('button', { name: 'Thu hồi gói' }).click();
  await expect(page.getByText('REVOKED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lấy link tải item v1.txt' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Tải item đúng phiên bản' })).toHaveCount(0);
});
test('mock backend: recipient confirmation reads aggregate state; one of two confirms and package stays READY', async ({ page }) => {
  let value = handover({ status: 'READY', recipients: [{ userId: projectId, accessStatus: 'ACTIVE', confirmedAt: null }, { userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: null }] });
  await mockProject(page, 'VIEWER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/handovers/' + handoverId)) { await route.fulfill({ json: value }); return true; }
    if (path.endsWith('/confirm')) {
      expect(route.request().postData()).toBeNull();
      value = { ...value, recipients: value.recipients.map(person => person.userId === projectId ? { ...person, confirmedAt: new Date().toISOString() } : person) };
      await route.fulfill({ json: { handoverId, userId: projectId, confirmedAt: new Date().toISOString(), status: 'CONFIRMED' } }); return true;
    }
    return false;
  });
  await open(page); await expect(page.getByRole('button', { name: 'Phát hành gói' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Xác nhận nhận bàn giao' }).click();
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận nhận bàn giao' })).toHaveCount(0);
  await expect(page.getByText('CONFIRMED', { exact: true })).toHaveCount(0);
});
test('mock backend: expired package cannot download/publish; mismatch cannot be selected for a draft', async ({ page }) => {
  const value = handover({ status: 'READY', expiresAt: '2000-01-01T00:00:00Z' });
  await mockProject(page, 'OWNER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [{ ...file, integrityStatus: 'MISMATCH' }], page: 0, size: 20 } }); return true; }
    if (path.endsWith('/handovers/' + handoverId)) { await route.fulfill({ json: value }); return true; }
    return false;
  });
  await expect(page.getByLabel(`Chọn bàn giao v1.txt · ${v1}`, { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toBeDisabled();
  await open(page);
  await expect(page.getByText('Expired — đã hết hạn', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lấy link tải item v1.txt' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Phát hành gói' })).toHaveCount(0);
});
test('mock backend: unassigned recipient gets 404 and no handover actions', async ({ page }) => {
  await mockProject(page, 'VIEWER', async route => {
    if (!new URL(route.request().url()).pathname.includes('/handovers/')) return false;
    await route.fulfill({ status: 404, json: { code: 'HANDOVER_NOT_FOUND' } }); return true;
  });
  await open(page); await expect(page.getByRole('alert')).toContainText('không phải người được cấp quyền');
  await expect(page.getByRole('button', { name: 'Xác nhận nhận bàn giao' })).toHaveCount(0);
});
