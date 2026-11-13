import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';

test('mock S3/backend: original bytes, signed headers, exact complete version and backend VERIFIED', async ({ page }) => {
  let complete = false;
  const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const file = { id: 'version', fileId: 'file', uploadId: 'upload', filename: 'hello.txt', uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING', expectedSha256: hash, actualSha256: null };
  await page.route('https://s3.example.test/**', async route => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataBuffer()).toEqual(Buffer.from('abc'));
    expect(route.request().headers()['if-none-match']).toBe('*');
    expect(route.request().headers()['content-type']).toBe('text/plain');
    expect(route.request().headers()['x-csrf']).toBeUndefined();
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({ status: 200, headers: { 'x-amz-version-id': 'v+/=%', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-version-id' } });
  });
  await mockProject(page, 'OWNER', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/files/uploads')) {
      expect(request.postDataJSON()).toEqual({ filename: 'hello.txt', contentType: 'text/plain', size: 3, expectedSha256: hash });
      await route.fulfill({ json: { uploadId: 'upload', fileVersionId: 'version', fileId: 'file', presignedUpload: { method: 'PUT', url: 'https://s3.example.test/object', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } } }); return true;
    }
    if (path.endsWith('/upload/complete')) {
      expect(request.postDataJSON()).toEqual({ versionId: 'v+/=%' }); complete = true;
      await route.fulfill({ json: { uploadId: 'upload', fileVersion: file } }); return true;
    }
    if (path.endsWith('/uploads/upload')) {
      expect(complete).toBe(true);
      await route.fulfill({ json: { uploadId: 'upload', fileVersion: { ...file, integrityStatus: 'VERIFIED', actualSha256: hash } } }); return true;
    }
    return false;
  });
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  expect(complete).toBe(true);
});

test('mock S3: missing Version ID blocks complete and explains CORS; Viewer has no upload form', async ({ page }) => {
  let completes = 0;
  await page.route('https://s3.example.test/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }));
  await mockProject(page, 'OWNER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files/uploads')) {
      await route.fulfill({ json: { uploadId: 'upload', fileVersionId: 'version', presignedUpload: { method: 'PUT', url: 'https://s3.example.test/object', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } } }); return true;
    }
    if (path.endsWith('/complete')) { completes++; return false; }
    return false;
  });
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByRole('alert')).toContainText('Không đọc được S3 Version ID');
  expect(completes).toBe(0);
  await page.unroute('**/api/v1/**');
  await mockProject(page, 'VIEWER');
  await expect(page.getByLabel('Chọn file', { exact: true })).toHaveCount(0);
});
