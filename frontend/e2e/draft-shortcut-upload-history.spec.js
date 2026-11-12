import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const projectId = '10000000-0000-0000-0000-000000000001';
const base = { fileId: '30000000-0000-0000-0000-000000000001', size: 3, contentType: 'text/plain', expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), versionId: 'v1', uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
const file = (i, changes = {}) => ({ ...base, id: '20000000-0000-0000-0000-' + String(i).padStart(12, '0'), uploadId: '40000000-0000-0000-0000-' + String(i).padStart(12, '0'), filename: 'file-' + i + '.txt', ...changes });
const card = (page, item) => page.locator('[data-file-version-id="' + item.id + '"]');
const history = 'Hiện upload thất bại và hết hạn ở trang này';
async function setup(page, items, role = 'OWNER') {
  return mockProject(page, role, async route => {
    const path = new URL(route.request().url()).pathname;
    const item = items.find(item => path.endsWith('/uploads/' + item.uploadId));
    if (item) { await route.fulfill({ json: { uploadId: item.uploadId, fileVersion: item } }); return true; }
    if (path.endsWith('/files')) { await route.fulfill({ json: { items, page: 0, size: 20 } }); return true; }
    return false;
  });
}
for (const width of [375, 1440]) test('draft shortcut reaches the existing form at ' + width + 'px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const item = file(1); await setup(page, [item]);
  await card(page, item).getByRole('checkbox').check();
  await workspaceView(page, 'Tạo gói DRAFT');
  await expect(page).toHaveURL(new RegExp('/projects/' + projectId + '/draft$'));
  const panel = page.locator('#project-draft'); await expect(panel).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Tạo gói DRAFT', exact: true })).toBeInViewport();
  await expect.poll(async () => {
    const heading = await panel.getByRole('heading', { name: 'Tạo gói DRAFT', exact: true }).boundingBox();
    const header = await page.locator('.app-header').boundingBox();
    return heading.y - header.y - header.height;
  }).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('draft-shortcut.png') });
  await expect(card(page, item).getByRole('checkbox')).toBeChecked();
  await panel.getByLabel('Tiêu đề bàn giao', { exact: true }).fill('Keep this draft');
  await workspaceView(page, 'Thành viên'); await workspaceView(page, 'Tạo gói DRAFT');
  await expect(panel.getByLabel('Tiêu đề bàn giao', { exact: true })).toHaveValue('Keep this draft');
  if (width === 375) await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
  const names = await page.getByRole('navigation', { name: 'Điều hướng workspace', exact: true }).getByRole('link').allTextContents();
  expect(names.indexOf('Tạo gói DRAFT')).toBe(names.indexOf('Thành viên') + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(panel).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Tạo gói DRAFT', exact: true })).toBeInViewport();
});
for (const role of ['EDITOR', 'VIEWER']) test('draft shortcut keeps create permission restricted for ' + role, async ({ page }) => {
  await setup(page, [], role); await workspaceView(page, 'Tạo gói DRAFT');
  await expect(page.locator('#project-draft')).toBeFocused();
  await expect(page.locator('#project-draft')).toContainText('Chỉ OWNER của dự án có thể tạo gói bàn giao.');
  await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toHaveCount(0);
});
test('failed uploads are hidden, history is reversible, integrity failures remain visible without mutations', async ({ page }, testInfo) => {
  const items = [file(1, { uploadStatus: 'FAILED', integrityStatus: 'INTEGRITY_PENDING', versionId: null }), file(2, { uploadStatus: 'EXPIRED', versionId: null }), file(3), file(4, { integrityStatus: 'FAILED' }), file(5, { integrityStatus: 'MISMATCH' })];
  const mutations = []; page.on('request', request => { if (request.url().includes('/api/v1/') && request.method() !== 'GET') mutations.push(request.method()); });
  await setup(page, items); await workspaceView(page, 'Tài liệu');
  for (const item of items.slice(0, 2)) await expect(card(page, item)).toHaveCount(0);
  for (const item of items.slice(2)) await expect(card(page, item)).toBeVisible();
  await page.locator('.files-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('default-upload-list.png') });
  await page.getByLabel(history, { exact: true }).check();
  for (const item of items) await expect(card(page, item)).toBeVisible();
  for (const item of items.slice(0, 2)) {
    await expect(card(page, item).getByRole('checkbox')).toBeDisabled();
    await expect(card(page, item).getByRole('button', { name: 'Lấy link tải ' + item.filename, exact: true })).toBeDisabled();
  }
  await page.getByLabel(history, { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Tải lại danh sách file', exact: true }).click();
  await expect(card(page, items[0])).toHaveCount(0); await expect(card(page, items[2])).toBeVisible();
  expect(mutations).toEqual([]);
});
test('all-failed page keeps pagination usable', async ({ page }) => {
  const usable = file(21), failed = Array.from({ length: 20 }, (_, i) => file(i + 1, { uploadStatus: 'FAILED', versionId: null }));
  await mockProject(page, 'OWNER', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/files')) { const index = Number(url.searchParams.get('page')); await route.fulfill({ json: { items: index ? [usable] : failed, page: index, size: 20 } }); return true; } return false;
  });
  await workspaceView(page, 'Tài liệu');
  await expect(page.locator('.files-section')).toContainText('Không có phiên bản hiển thị ở trang này.');
  await expect(page.locator('[data-file-version-id]')).toHaveCount(0);
  const next = page.locator('.files-section').getByRole('button', { name: 'Trang sau', exact: true });
  await expect(next).toBeEnabled(); await next.click(); await expect(card(page, usable)).toBeVisible(); await expect(next).toBeDisabled();
});
