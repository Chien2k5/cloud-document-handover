import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const id = '10000000-0000-0000-0000-000000000001', other = '10000000-0000-0000-0000-000000000002';
const file = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001', uploadId: '40000000-0000-0000-0000-000000000001', versionId: 'opaque-v1', filename: 'navigation.txt', size: 3, expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
const nav = page => page.getByRole('navigation', { name: 'Điều hướng workspace', exact: true });

test('C09.02: same-project hash navigation preserves selection and supports Back/Forward/reload without writes', async ({ page }) => {
  let writes = 0;
  await mockProject(page, 'OWNER', async route => {
    if (route.request().method() !== 'GET') writes++;
    if (!new URL(route.request().url()).pathname.endsWith('/files')) return false;
    await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true;
  });
  const selected = page.getByLabel(`Chọn bàn giao navigation.txt · ${file.id}`, { exact: true });
  await selected.check();
  await nav(page).getByRole('link', { name: 'Tài liệu', exact: true }).click();
  await nav(page).getByRole('link', { name: 'Thành viên', exact: true }).click();
  await expect(nav(page).getByRole('link', { name: 'Thành viên', exact: true })).toHaveAttribute('aria-current', 'location');
  await nav(page).getByRole('link', { name: 'Mở gói bàn giao', exact: true }).click();
  await expect(selected).toBeChecked();
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/members$`));
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/files$`)); await expect(selected).toBeChecked();
  await page.goForward(); await expect(page).toHaveURL(new RegExp(`/members$`));
  await page.reload(); await expect(page.getByText('Project ID:', { exact: false })).toContainText(id);
  await expect(page.getByRole('button', { name: 'Project fixture · OWNER', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(writes).toBe(0); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('C09.02: navigation during PUT retains session and retry complete never repeats the PUT', async ({ page }) => {
  let release, puts = 0, inits = 0; const completes = [];
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('https://s3.example.test/**', async route => {
    puts++; expect(route.request().headers().cookie).toBeUndefined(); expect(route.request().headers()['x-csrf']).toBeUndefined();
    await gate; await route.fulfill({ status: 200, headers: { 'x-amz-version-id': 'opaque+/=%', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-version-id' } });
  });
  await mockProject(page, 'OWNER', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files/uploads')) { inits++; await route.fulfill({ json: { uploadId: file.uploadId, fileId: file.fileId, fileVersionId: file.id, presignedUpload: { method: 'PUT', url: 'https://s3.example.test/nav-fixture', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } } }); return true; }
    if (path.endsWith('/complete')) {
      completes.push(route.request().postDataJSON());
      await route.fulfill(completes.length === 1 ? { status: 503, json: { code: 'STORAGE_UNAVAILABLE' } } : { json: { uploadId: file.uploadId, fileVersion: { ...file, versionId: 'opaque+/=%' } } }); return true;
    }
    if (path.endsWith('/uploads/' + file.uploadId)) { await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: { ...file, versionId: 'opaque+/=%' } } }); return true; }
    return false;
  });
  try {
    await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'navigation.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
    await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true }).click();
    await expect.poll(() => puts).toBe(1);
    for (const name of ['Thành viên', 'Mở gói bàn giao', 'Tài liệu']) await nav(page).getByRole('link', { name, exact: true }).click();
    release(); await expect(page.getByRole('alert')).toContainText('Không truy cập được S3');
    await expect(page.getByRole('button', { name: 'Thử lại complete cùng Version ID', exact: true })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Thành viên', exact: true }).click();
    await nav(page).getByRole('link', { name: 'Tài liệu', exact: true }).click();
    await page.getByRole('button', { name: 'Thử lại complete cùng Version ID', exact: true }).click();
    await expect.poll(() => completes.length).toBe(2);
    expect(completes).toEqual([{ versionId: 'opaque+/=%' }, { versionId: 'opaque+/=%' }]); expect(puts).toBe(1); expect(inits).toBe(1);
  } finally { release(); }
});

test('C09.02: switching projects cancels stale reads and resets protected file state', async ({ page }) => {
  let hold = false, release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const projects = [{ id, name: 'Alpha', role: 'OWNER', quotaBytes: 100, usedBytes: 0, reservedBytes: 0 }, { id: other, name: 'Beta', role: 'VIEWER', quotaBytes: 100, usedBytes: 0, reservedBytes: 0 }];
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id, displayName: 'Fixture', email: 'fixture@example.test' } });
    if (path.endsWith('/projects')) return route.fulfill({ json: { items: projects, page: 0, size: 20 } });
    const isA = path.includes('/' + id), project = projects[isA ? 0 : 1];
    if (path.endsWith('/members')) return route.fulfill({ json: [] });
    if (path.endsWith('/files')) return route.fulfill({ json: { items: [{ ...file, filename: isA ? 'A-only.txt' : 'B-only.txt', id: isA ? file.id : other }], page: 0, size: 20 } });
    if (isA && hold) await gate;
    return route.fulfill({ json: project });
  });
  try {
    await page.goto('/'); await page.getByRole('button', { name: 'Alpha · OWNER', exact: true }).click();
    await page.getByLabel(`Chọn bàn giao A-only.txt · ${file.id}`, { exact: true }).check();
    hold = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
    await page.getByRole('button', { name: 'Beta · VIEWER', exact: true }).click();
    await expect(page.locator('#project-overview').getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
    release();
    await expect(page.getByRole('heading', { name: 'B-only.txt · 3 byte', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A-only.txt · 3 byte', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Chọn file', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toHaveCount(0);
  } finally { release(); }
});

for (const status of [403, 404]) test(`C09.02: project ${status} removes members and files`, async ({ page }) => {
  let denied = false;
  await mockProject(page, 'OWNER', async route => {
    if (!denied || new URL(route.request().url()).pathname !== '/api/v1/projects/' + id) return false;
    await route.fulfill({ status, json: { code: status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND' } }); return true;
  });
  denied = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#project-files')).toHaveCount(0); await expect(page.locator('#project-members')).toHaveCount(0);
});

test('C09.02: external recipient can use a hash URL; invalid UUID never fetches a package', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: other, displayName: 'Recipient fixture', email: 'recipient@example.test' } });
    if (path.endsWith('/projects')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    if (path.includes('/handovers/')) { reads++; return route.fulfill({ json: { id, projectId: id, title: 'External package', status: 'READY', accessStatus: 'ACTIVE', expiresAt: '2099-01-01T00:00:00Z', items: [], recipients: [{ userId: other, accessStatus: 'ACTIVE', confirmedAt: null }] } }); }
    return route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND' } });
  });
  await page.goto('/#/handovers/' + id); await expect(page.getByRole('button', { name: 'Xác nhận nhận bàn giao', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phát hành gói', exact: true })).toHaveCount(0); expect(reads).toBe(1);
  await page.goto('/#/handovers/not-a-uuid'); await expect(page.getByText('Đường dẫn không hợp lệ.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận nhận bàn giao', exact: true })).toHaveCount(0); expect(reads).toBe(1);
});

for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) test(`C09.02: navigation keyboard and layout at ${viewport.width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport); await mockProject(page);
  const toggle = page.getByRole('button', { name: /^(Mở|Đóng) điều hướng$/ });
  if (viewport.width <= 900) {
    await toggle.focus(); await page.keyboard.press('Enter'); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(toggle).toHaveAccessibleName('Đóng điều hướng');
    await nav(page).getByRole('link', { name: 'Thành viên', exact: true }).focus(); await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(toggle).toHaveAccessibleName('Mở điều hướng');
    await toggle.click();
  } else await expect(toggle).toBeHidden();
  await nav(page).getByRole('link', { name: 'Thành viên', exact: true }).click();
  await expect(page.locator('#project-members')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fixture-shell-${viewport.width}.png`), fullPage: true });
});

test('C09.02: skip link focuses main without corrupting the hash route', async ({ page }) => {
  await mockProject(page); const url = page.url();
  await page.getByRole('link', { name: 'Bỏ qua điều hướng', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-main')).toBeFocused(); expect(page.url()).toBe(url);
  await expect(page.getByText('Đường dẫn không hợp lệ.', { exact: false })).toHaveCount(0);
});
