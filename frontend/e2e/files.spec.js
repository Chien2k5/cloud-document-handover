import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const file = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001', uploadId: '40000000-0000-0000-0000-000000000001', versionId: 'opaque-v1', filename: 'hello.txt', size: 3, expectedSha256: 'a'.repeat(64), actualSha256: null, uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING' };
test('mock backend: reload resumes by durable uploadId, download pins FileVersion ID, Viewer cannot add versions', async ({ page }) => {
  let reads = 0, downloadRequests = 0;
  await mockProject(page, 'VIEWER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true; }
    if (path.endsWith('/uploads/' + file.uploadId)) { reads++; await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: { ...file, integrityStatus: 'VERIFIED', actualSha256: 'a'.repeat(64) } } }); return true; }
    if (path.endsWith('/download')) {
      expect(path).toContain('/files/' + file.id + '/download'); downloadRequests++;
      await route.fulfill({ json: { url: 'https://s3.example.test/key?versionId=opaque-v1', versionId: file.versionId, expiresAt: new Date(Date.now() + 60000).toISOString() } }); return true;
    }
    return false;
  });
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thêm phiên bản hello.txt' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Lấy link tải hello.txt' }).click();
  await expect(page.getByRole('link', { name: 'Tải phiên bản đã chọn' })).toHaveAttribute('href', 'https://s3.example.test/key?versionId=opaque-v1');
  await page.reload();
  await page.getByRole('button', { name: 'Project fixture · VIEWER' }).click();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2); expect(downloadRequests).toBe(1);
});
test('mock backend: MISMATCH is visible and download disabled; new version targets existing File ID', async ({ page }) => {
  await mockProject(page, 'OWNER', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/files')) return false;
    await route.fulfill({ json: { items: [{ ...file, integrityStatus: 'MISMATCH', actualSha256: 'b'.repeat(64) }], page: 0, size: 20 } }); return true;
  });
  await expect(page.getByText('MISMATCH', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lấy link tải hello.txt' })).toBeDisabled();
  await page.getByRole('button', { name: 'Thêm phiên bản hello.txt' }).click();
  await expect(page.getByText('Thêm phiên bản cho', { exact: false })).toContainText(file.fileId);
});
