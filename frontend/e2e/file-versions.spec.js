import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const project = '10000000-0000-0000-0000-000000000001';
const v1 = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001', uploadId: '40000000-0000-0000-0000-000000000001', versionId: 's3-v1+opaque/=', filename: 'same-name.txt', contentType: 'text/plain', size: 3, expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
const v2 = { ...v1, id: '20000000-0000-0000-0000-000000000002', uploadId: '40000000-0000-0000-0000-000000000002', versionId: 's3-v2+opaque/=' };
const sameName = { ...v1, id: '20000000-0000-0000-0000-000000000003', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000003', versionId: 'another-object-v1' };
const card = (page, id) => page.locator(`[data-file-version-id="${id}"]`);
async function files(page, role = 'OWNER', items = [v1], extra) {
  let reads = 0;
  await mockProject(page, role, async (route, _project, user) => {
    user.displayName = 'MOCK DATA · FileVersions';
    if (extra && await extra(route)) return true;
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/files')) { reads++; expect(url.searchParams.get('size')).toBe('20'); await route.fulfill({ json: { items, page: Number(url.searchParams.get('page')), size: 20 } }); return true; }
    if (url.pathname.includes('/uploads/')) { await route.fulfill({ json: { uploadId: items[0]?.uploadId, fileVersion: items[0] } }); return true; } return false;
  });
  await workspaceView(page, 'Tài liệu'); return { reads: () => reads };
}

for (const role of ['OWNER', 'EDITOR', 'VIEWER']) test(`C09.06A: ${role} sees exact API metadata and only permitted controls`, async ({ page }) => {
  await files(page, role); const row = card(page, v1.id); await expect(row.getByRole('heading', { name: 'same-name.txt · 3 byte', exact: true })).toBeVisible();
  await expect(row.getByText('AVAILABLE', { exact: true })).toBeVisible(); await expect(row.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(row.getByRole('checkbox')).toHaveCount(role === 'OWNER' ? 1 : 0); await expect(row.getByRole('button', { name: 'Thêm phiên bản same-name.txt', exact: true })).toHaveCount(role === 'VIEWER' ? 0 : 1);
  await expect(row.getByRole('button', { name: 'Lấy link tải same-name.txt', exact: true })).toBeEnabled();
  await expect(row.getByText(v1.fileId, { exact: true })).toBeHidden(); await row.getByLabel('Thông tin kỹ thuật phiên bản ' + v1.id, { exact: true }).click();
  for (const value of [v1.id, v1.fileId, v1.uploadId, v1.versionId, v1.contentType]) await expect(row.getByText(value, { exact: true })).toBeVisible();
});

for (const [uploadStatus, integrityStatus] of [['AVAILABLE', 'INTEGRITY_PENDING'], ['AVAILABLE', 'MISMATCH'], ['AVAILABLE', 'FAILED'], ['PENDING', 'VERIFIED'], ['FAILED', 'FAILED'], ['EXPIRED', 'FAILED']]) test(`C09.06A: ${uploadStatus}/${integrityStatus} stays distinct and ineligible`, async ({ page }) => {
  const value = { ...v1, uploadStatus, integrityStatus }; await files(page, 'OWNER', [value]);
  await expect(card(page, v1.id).getByRole('checkbox')).toBeDisabled(); await expect(card(page, v1.id).getByRole('button', { name: 'Lấy link tải same-name.txt', exact: true })).toBeDisabled();
  await expect(card(page, v1.id).locator('[data-stage="upload"]')).toHaveText(uploadStatus); await expect(card(page, v1.id).locator('[data-stage="integrity"]')).toHaveText(integrityStatus);
  if (integrityStatus === 'MISMATCH') await expect(card(page, v1.id).getByText('Checksum không khớp.', { exact: false })).toBeVisible();
  if (uploadStatus === 'AVAILABLE' && integrityStatus === 'INTEGRITY_PENDING') await expect(card(page, v1.id).getByText('đang chờ backend đối soát SHA-256', { exact: false })).toBeVisible();
});

test('C09.06A: empty API result shows empty state without inventing a FileVersion', async ({ page }) => {
  await files(page, 'VIEWER', []); await expect(page.getByRole('heading', { name: 'Chưa có file ở trang này.', exact: true })).toBeVisible(); await expect(page.locator('[data-file-version-id]')).toHaveCount(0);
});

test('C09.06A: same filename is not a key; v1/v2 of one logical file and another file remain separate', async ({ page }) => {
  await files(page, 'OWNER', [v1, v2, sameName]); await expect(page.locator('[data-file-version-id]')).toHaveCount(3);
  for (const value of [v1, v2, sameName]) {
    await card(page, value.id).getByLabel('Thông tin kỹ thuật phiên bản ' + value.id, { exact: true }).click();
    await expect(card(page, value.id).getByText(value.id, { exact: true })).toBeVisible(); await expect(card(page, value.id).getByText(value.fileId, { exact: true })).toBeVisible(); await expect(card(page, value.id).getByText(value.versionId, { exact: true })).toBeVisible();
  }
  await card(page, v1.id).getByRole('checkbox').check(); await expect(card(page, v2.id).getByRole('checkbox')).not.toBeChecked(); await expect(card(page, sameName.id).getByRole('checkbox')).not.toBeChecked();
});

test('C09.06A: FileVersion selection survives page changes, refresh, global navigation and pins v1 in the DRAFT payload', async ({ page }) => {
  let listReads = 0, body;
  const filler = Array.from({ length: 19 }, (_, index) => ({ ...v1, id: `50000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, uploadId: `60000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, filename: `other-${index}.txt` }));
  const handover = { id: '70000000-0000-0000-0000-000000000007', projectId: project, title: 'Pinned after pages', status: 'DRAFT', accessStatus: 'ACTIVE', expiresAt: '2099-01-01T00:00:00Z', items: [], recipients: [] };
  await files(page, 'OWNER', [], async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/files')) { listReads++; const pageIndex = Number(url.searchParams.get('page')); expect(url.searchParams.get('size')).toBe('20'); await route.fulfill({ json: { items: pageIndex ? [v2, sameName] : [v1, ...filler], page: pageIndex, size: 20 } }); return true; }
    if (path.endsWith('/handovers') && route.request().method() === 'POST') { body = route.request().postDataJSON(); expect(route.request().headers()['x-csrf']).toBe('fixture'); await route.fulfill({ json: handover }); return true; }
    if (path.endsWith('/handovers/' + handover.id)) { await route.fulfill({ json: handover }); return true; } return false;
  });
  await card(page, v1.id).getByRole('checkbox').check(); const pager = page.locator('.files-section').getByRole('navigation', { name: 'Phân trang', exact: true });
  await pager.getByRole('button', { name: 'Trang sau', exact: true }).click(); await expect(card(page, v2.id)).toBeVisible(); await expect(card(page, v2.id).getByRole('checkbox')).not.toBeChecked();
  await card(page, sameName.id).getByRole('checkbox').check(); await expect(pager.getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled();
  await pager.getByRole('button', { name: 'Trang trước', exact: true }).click(); await expect(card(page, v1.id).getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Tải lại danh sách file', exact: true }).click(); await expect(card(page, v1.id).getByRole('checkbox')).toBeChecked();
  await workspaceView(page, 'Mở gói bàn giao'); await workspaceView(page, 'Tài liệu'); await expect(card(page, v1.id).getByRole('checkbox')).toBeChecked();
  await page.getByLabel('Tiêu đề bàn giao', { exact: true }).fill('Pinned after pages'); await page.getByLabel('UUID người nhận', { exact: true }).fill(project); await page.getByLabel('Hạn bàn giao (giờ trên máy bạn)', { exact: true }).fill('2099-01-01T12:00');
  await page.getByRole('button', { name: 'Tạo DRAFT', exact: true }).click(); await expect.poll(() => body).toBeTruthy(); expect(body.fileVersionIds.sort()).toEqual([v1.id, sameName.id].sort()); expect(body.fileVersionIds).not.toContain(v2.id); expect(listReads).toBe(4);
});

test('C09.06A: a selected version that becomes ineligible on reload is removed from selection', async ({ page }) => {
  let pending = false;
  await files(page, 'OWNER', [], async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [{ ...v1, integrityStatus: pending ? 'MISMATCH' : 'VERIFIED' }], page: 0, size: 20 } }); return true; } return false;
  });
  await card(page, v1.id).getByRole('checkbox').check(); pending = true; await page.getByRole('button', { name: 'Tải lại danh sách file', exact: true }).click();
  await expect(card(page, v1.id).getByRole('checkbox')).not.toBeChecked(); await expect(card(page, v1.id).getByRole('checkbox')).toBeDisabled(); await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toBeDisabled();
});

for (const width of [375, 768, 1440]) test(`C09.06A: 233-character filename, IDs and hashes fit ${width}px with keyboard disclosure`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const file = { ...v1, filename: 'x'.repeat(229) + '.txt' }; await files(page, 'VIEWER', [file]);
  const details = card(page, v1.id).getByLabel('Thông tin kỹ thuật phiên bản ' + v1.id, { exact: true }); await details.focus(); await page.keyboard.press('Enter'); await expect(card(page, v1.id).getByText(v1.versionId, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`fixture-file-versions-${width}.png`) }); expect(errors).toEqual([]);
});
