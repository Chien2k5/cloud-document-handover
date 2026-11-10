import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const file = { id: '20000000-0000-0000-0000-000000000002', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000004', filename: 'flow.txt', size: 3, versionId: 'opaque+/=v1', uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING', expectedSha256: hash, actualSha256: null };
const panel = page => page.locator('.upload-panel');
const result = (integrityStatus = 'INTEGRITY_PENDING') => ({ uploadId: file.uploadId, fileVersion: { ...file, integrityStatus, actualSha256: integrityStatus === 'VERIFIED' ? hash : integrityStatus === 'MISMATCH' ? 'b'.repeat(64) : null } });
const init = { uploadId: file.uploadId, fileVersionId: file.id, fileId: file.fileId, presignedUpload: { method: 'PUT', url: 'https://s3.example.test/progress', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } };
async function choose(page) { await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: file.filename, mimeType: 'text/plain', buffer: Buffer.from('abc') }); await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true }).click(); }

test('C09.07B: stages follow real async boundaries, preserve bytes/headers/hash/version and never invent percent completion', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { const original = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async function () { await new Promise(resolve => { window.releaseHash = resolve; }); return original.call(this); }; });
  const releases = {}, waits = Object.fromEntries(['init', 'put', 'complete', 'integrity'].map(key => [key, new Promise(resolve => { releases[key] = resolve; })])); const calls = [];
  await page.route('https://s3.example.test/**', async route => { calls.push('put'); expect(route.request().postDataBuffer()).toEqual(Buffer.from('abc')); expect(route.request().headers()['x-csrf']).toBeUndefined(); expect(route.request().headers().cookie).toBeUndefined(); expect(route.request().headers()['if-none-match']).toBe('*'); await waits.put; await route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-version-id' } }); });
  await mockProject(page, 'OWNER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files/uploads')) { calls.push('init'); expect(route.request().postDataJSON().expectedSha256).toBe(hash); await waits.init; await route.fulfill({ json: init }); return true; }
    if (path.endsWith('/complete')) { calls.push('complete'); expect(route.request().postDataJSON()).toEqual({ versionId: file.versionId }); await waits.complete; await route.fulfill({ json: result() }); return true; }
    if (path.endsWith('/uploads/' + file.uploadId)) { calls.push('integrity'); await waits.integrity; await route.fulfill({ json: result('VERIFIED') }); return true; } return false;
  });
  try {
    await choose(page); await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'hash'); expect(calls).toEqual([]); await page.evaluate(() => window.releaseHash());
    await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'init'); releases.init(); await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'put'); releases.put();
    await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'complete'); releases.complete(); await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'integrity');
    await expect(panel(page).getByText('AVAILABLE', { exact: true })).toBeVisible(); await expect(panel(page).getByText('INTEGRITY_PENDING', { exact: true })).toBeVisible(); await expect(panel(page).getByText('VERIFIED', { exact: true })).toHaveCount(0);
    await panel(page).getByText('Thông tin kỹ thuật phiên upload', { exact: true }).click(); for (const value of [file.id, file.uploadId, file.versionId]) await expect(panel(page).getByText(value, { exact: true })).toBeVisible();
    await panel(page).getByText('Đối chiếu SHA-256', { exact: true }).click(); await expect(panel(page).getByText(hash, { exact: true })).toHaveCount(1); await expect(panel(page).getByText('Chưa có kết quả', { exact: true })).toBeVisible();
    releases.integrity(); await expect(panel(page).locator('.upload-progress')).toHaveAttribute('data-phase', 'verified'); await expect(panel(page).getByText(hash, { exact: true })).toHaveCount(2);
    expect(calls).toEqual(['init', 'put', 'complete', 'integrity']); await expect(panel(page).getByRole('progressbar')).toHaveCount(0); expect(await panel(page).innerText()).not.toMatch(/\b(?:30|70|100)%/); expect(errors).toEqual([]);
  } finally { Object.values(releases).forEach(release => release()); }
});

for (const status of ['VERIFIED', 'MISMATCH', 'FAILED']) test(`C09.07B: backend ${status} is distinct from upload AVAILABLE and displays exact checksum data`, async ({ page }) => {
  await page.route('https://s3.example.test/**', route => route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-version-id' } }));
  await mockProject(page, 'EDITOR', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files/uploads')) { await route.fulfill({ json: init }); return true; }
    if (path.endsWith('/complete')) { await route.fulfill({ json: result() }); return true; }
    if (path.endsWith('/uploads/' + file.uploadId)) { await route.fulfill({ json: result(status) }); return true; } return false;
  });
  await choose(page); await expect(panel(page).getByText(status, { exact: true })).toBeVisible(); await expect(page.getByLabel('Chọn file', { exact: true })).toBeEnabled();
  await panel(page).getByText('Đối chiếu SHA-256', { exact: true }).click(); const values = result(status).fileVersion; await expect(panel(page).getByText(values.actualSha256 || 'Chưa có kết quả', { exact: true })).toHaveCount(status === 'VERIFIED' ? 2 : 1);
  if (status !== 'VERIFIED') await expect(panel(page).getByText('VERIFIED', { exact: true })).toHaveCount(0);
});
