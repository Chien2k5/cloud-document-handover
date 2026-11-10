import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';

test('mock backend: a protected 401 clears project UI and asks for login again', async ({ page }) => {
  let expired = false;
  await mockProject(page, 'OWNER', async route => {
    if (!expired || new URL(route.request().url()).pathname !== '/api/v1/projects') return false;
    await route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }); return true;
  });
  expired = true; await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Tải lại dự án' }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Phiên đăng nhập đã hết');
  await expect(page.getByRole('heading', { name: 'Chi tiết dự án' })).toHaveCount(0);
});
test('mock backend: 403 does not retry a mutation; CSRF can refresh without repeating the write', async ({ page }) => {
  let mutations = 0;
  await mockProject(page, 'OWNER', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'POST' || !path.endsWith('/projects')) return false;
    mutations++; await route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } }); return true;
  });
  await workspaceView(page, 'Dự án'); await page.getByText('Tạo dự án mới', { exact: true }).click();
  await page.getByLabel('Tên dự án', { exact: true }).fill('Retry fixture');
  await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Không đủ quyền hoặc CSRF');
  await page.getByRole('button', { name: 'Làm mới CSRF' }).click();
  await expect(page.getByRole('alert')).toContainText('Đã lấy token mới'); expect(mutations).toBe(1);
});
test('mock backend: quota 409 and storage 503 are visible and never start a PUT', async ({ page }) => {
  let unavailable = false, puts = 0;
  await page.route('https://s3.example.test/**', route => { puts++; return route.abort(); });
  await mockProject(page, 'EDITOR', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/files/uploads')) return false;
    await route.fulfill({ status: unavailable ? 503 : 409, json: { code: unavailable ? 'STORAGE_UNAVAILABLE' : 'QUOTA_EXCEEDED' } }); return true;
  });
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByRole('alert')).toContainText('không còn đủ quota');
  unavailable = true; await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByRole('alert')).toContainText('Không truy cập được S3'); expect(puts).toBe(0);
});
test('mock backend: FAILED integrity can be checked again when a late valid result arrives', async ({ page }) => {
  const file = { id: 'version', fileId: 'file', uploadId: 'upload', versionId: 'v1', filename: 'late.txt', size: 3, uploadStatus: 'AVAILABLE', integrityStatus: 'FAILED', expectedSha256: 'a'.repeat(64) };
  let reads = 0;
  await mockProject(page, 'VIEWER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true; }
    if (path.endsWith('/uploads/upload')) { reads++; await route.fulfill({ json: { uploadId: 'upload', fileVersion: reads === 1 ? file : { ...file, integrityStatus: 'VERIFIED', actualSha256: 'a'.repeat(64) } } }); return true; }
    return false;
  });
  await expect(page.getByText('FAILED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lấy link tải late.txt' })).toBeDisabled();
  await page.getByRole('button', { name: 'Kiểm tra lại late.txt' }).click();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lấy link tải late.txt' })).toBeEnabled();
});
test('mock backend: project pagination uses page/size and does not hardcode a selected project', async ({ page }) => {
  const pages = [];
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { id: 'fixture-user', email: 'fixture@example.test', displayName: 'Fixture' } });
    const pageIndex = Number(url.searchParams.get('page')); pages.push(pageIndex); expect(url.searchParams.get('size')).toBe('20');
    const items = pageIndex === 0 ? Array.from({ length: 20 }, (_, index) => ({ id: `fixture-${index}`, name: `Page 1 project ${index}`, role: 'OWNER' })) : [{ id: 'next-page', name: 'Page 2 project', role: 'VIEWER' }];
    return route.fulfill({ json: { items, page: pageIndex, size: 20 } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page 2 project · VIEWER' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled(); expect(pages).toEqual([0, 1]);
});
