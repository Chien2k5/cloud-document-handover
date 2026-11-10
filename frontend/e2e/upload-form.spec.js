import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const panel = page => page.locator('.upload-panel');
const submit = page => panel(page).getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true });

for (const role of ['OWNER', 'EDITOR', 'VIEWER']) test(`C09.07A: ${role} upload controls and actual chosen file metadata`, async ({ page }) => {
  await mockProject(page, role); await workspaceView(page, 'Tài liệu');
  if (role === 'VIEWER') { await expect(panel(page).getByText('Viewer chỉ xem và tải file đã VERIFIED.', { exact: true })).toBeVisible(); await expect(page.getByLabel('Chọn file', { exact: true })).toHaveCount(0); await expect(submit(page)).toHaveCount(0); return; }
  await expect(submit(page)).toBeDisabled(); await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'nội dung.bin', mimeType: '', buffer: Buffer.from([0, 255, 128]) });
  await expect(panel(page).getByLabel('File đã chọn')).toContainText('nội dung.bin'); await expect(panel(page).getByLabel('File đã chọn')).toContainText('3 byte'); await expect(panel(page).getByLabel('File đã chọn')).toContainText('application/octet-stream'); await expect(submit(page)).toBeEnabled();
});

for (const size of [0, 1]) test(`C09.07A: ${size}-byte input validates before init and hashes real bytes`, async ({ page }) => {
  const bodies = [];
  await mockProject(page, 'OWNER', async route => { if (!new URL(route.request().url()).pathname.endsWith('/files/uploads')) return false; bodies.push(route.request().postDataJSON()); expect(route.request().headers()['x-csrf']).toBe('fixture'); await route.fulfill({ status: 503, json: { code: 'STORAGE_UNAVAILABLE' } }); return true; });
  const bytes = Buffer.alloc(size, 0xff); await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'bytes.bin', mimeType: 'application/octet-stream', buffer: bytes }); await submit(page).click();
  await expect(panel(page).getByRole('alert')).toContainText(size ? 'Không truy cập được S3' : 'Chọn file từ 1 byte đến 100 MiB');
  expect(bodies).toEqual(size ? [{ filename: 'bytes.bin', contentType: 'application/octet-stream', size, expectedSha256: createHash('sha256').update(bytes).digest('hex') }] : []);
});

test('C09.07A: add-version preserves logical file ID and refuses a different filename before any request', async ({ page }) => {
  const file = { id: '20000000-0000-0000-0000-000000000002', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000004', filename: 'existing.txt', size: 3, uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED', versionId: 'v1' }, bodies = [];
  await mockProject(page, 'EDITOR', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/files')) { await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true; }
    if (p.endsWith('/files/uploads')) { bodies.push(route.request().postDataJSON()); await route.fulfill({ status: 503, json: { code: 'STORAGE_UNAVAILABLE' } }); return true; } return false;
  });
  await page.getByRole('button', { name: 'Thêm phiên bản existing.txt', exact: true }).click(); await expect(panel(page).locator('.upload-target')).toContainText(file.fileId);
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'different.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') }); await submit(page).click(); await expect(panel(page).getByRole('alert')).toContainText('phải giữ nguyên tên'); expect(bodies).toHaveLength(0);
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: file.filename, mimeType: 'text/plain', buffer: Buffer.from('abc') }); await submit(page).click(); await expect(panel(page).getByRole('alert')).toContainText('Không truy cập được S3'); expect(bodies).toHaveLength(1); expect(bodies[0].fileId).toBe(file.fileId); expect(bodies[0].filename).toBe(file.filename); expect(bodies[0].expectedSha256).toBe(createHash('sha256').update('abc').digest('hex'));
});

for (const width of [375, 768, 1440]) test(`C09.07A: file picker, 233-character name, keyboard and layout at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 }); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await mockProject(page); await workspaceView(page, 'Tài liệu'); const input = page.getByLabel('Chọn file', { exact: true }); await input.focus(); await expect(input).toBeFocused();
  await input.setInputFiles({ name: 'x'.repeat(229) + '.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') }); await expect(panel(page).getByLabel('File đã chọn')).toContainText('3 byte'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`fixture-upload-form-${width}.png`) }); expect(errors).toEqual([]);
});
