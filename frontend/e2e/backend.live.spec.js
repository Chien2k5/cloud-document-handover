import { test, expect } from '@playwright/test';
import { workspaceView } from './fixtures.js';
async function login(page, email = 'dung@example.test') {
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.LIVE_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
}
test('real Spring/PostgreSQL: form login, session rotation, reload, logout, 401 and wrong password', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.request.get('/api/v1/auth/csrf');
  const before = (await page.context().cookies()).find(cookie => cookie.name === 'JSESSIONID');
  await page.getByLabel('Email', { exact: true }).fill('dung@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('invalid-fixture-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng');
  await login(page);
  const after = (await page.context().cookies()).find(cookie => cookie.name === 'JSESSIONID');
  expect(Boolean(before && after && before.value !== after.value && after.httpOnly)).toBe(true);
  await page.reload(); await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  // Registration is a real UI -> Spring -> disposable PostgreSQL round trip, without API mocks.
  const email = `registration-${crypto.randomUUID()}@example.test`, password = `  Registration-${crypto.randomUUID()}  `;
  const calls = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request); });
  const url = page.url();
  await page.locator('.auth-mode-switch button').click();
  await page.getByLabel('Tên tài khoản', { exact: true }).fill('  Real Registration Fixture  ');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/register' && response.request().method() === 'POST');
  await page.locator('.guest-panel form button[type="submit"]').click();
  const response = await responsePromise; expect(response.status()).toBe(201);
  const created = await response.json();
  expect(Object.keys(created).sort()).toEqual(['displayName', 'email', 'id']); expect(created.email).toBe(email); expect(created.displayName).toBe('Real Registration Fixture');
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('status')).toHaveText('Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  await expect(page.locator('.app-shell')).toHaveCount(0); expect(page.url()).toBe(url);
  expect(calls.filter(request => request.url().endsWith('/auth/register'))).toHaveLength(1);
  expect(calls.some(request => /\/auth\/(login|logout|me)$/.test(request.url()))).toBe(false);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
  expect(await (await page.request.get('/api/v1/auth/me')).json()).toEqual(created);
  const projects = await page.request.get('/api/v1/projects'); expect(projects.status()).toBe(200); expect((await projects.json()).items).toEqual([]);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
test('real Spring/PostgreSQL: create/select project, Owner assigns Viewer then Editor; backend rejects Viewer mutation', async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: process.env.LIVE_BASE_URL }), viewer = await context.newPage();
  try {
    await login(viewer, 'viewer@example.test');
    const person = await (await viewer.request.get('/api/v1/auth/me')).json();
    await login(page); await page.getByText('Tạo dự án mới', { exact: true }).click();
    await page.getByLabel('Tên dự án', { exact: true }).fill('Live role project');
    await page.getByLabel('Mô tả', { exact: true }).fill('Isolated fixture');
    await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
    await page.getByText('Thông tin kỹ thuật dự án', { exact: true }).click(); await expect(page.getByText('Project ID:', { exact: false })).toBeVisible();
    const project = (await (await page.request.get('/api/v1/projects')).json()).items.find(item => item.name === 'Live role project');
    const owner = await (await page.request.get('/api/v1/auth/me')).json();
    const ownerCsrf = await (await page.request.get('/api/v1/auth/csrf')).json();
    for (const method of ['put', 'delete']) {
      const response = await page.request[method](`/api/v1/projects/${project.id}/members/${owner.id}`, { headers: { [ownerCsrf.headerName]: ownerCsrf.token }, ...(method === 'put' ? { data: { role: 'VIEWER' } } : {}) });
      expect(response.status()).toBe(409); expect((await response.json()).code).toBe('OWNER_IMMUTABLE');
    }
    await page.getByLabel('UUID thành viên', { exact: true }).fill(person.id);
    await page.getByLabel('Vai trò thành viên', { exact: true }).selectOption('VIEWER');
    await page.getByRole('button', { name: 'Lưu thành viên' }).click();
    await expect(page.getByLabel('UUID thành viên', { exact: true })).toHaveValue('');
    await viewer.reload(); await viewer.getByRole('button', { name: 'Live role project · VIEWER' }).click();
    await expect(viewer.getByText('Viewer chỉ xem', { exact: false })).toBeVisible();
    await expect(viewer.getByLabel('Chọn file', { exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Lưu thành viên' })).toHaveCount(0);
    const csrf = await (await viewer.request.get('/api/v1/auth/csrf')).json();
    const forbidden = await viewer.request.put(`/api/v1/projects/${project.id}/members/${person.id}`, { headers: { [csrf.headerName]: csrf.token }, data: { role: 'EDITOR' } });
    expect(forbidden.status()).toBe(403);
    await page.getByLabel('UUID thành viên', { exact: true }).fill(person.id);
    await page.getByLabel('Vai trò thành viên', { exact: true }).selectOption('EDITOR');
    await page.getByRole('button', { name: 'Lưu thành viên' }).click();
    await expect(page.getByLabel('UUID thành viên', { exact: true })).toHaveValue('');
    await viewer.getByRole('button', { name: 'Kiểm tra lại quyền dự án' }).click();
    await expect(viewer.getByLabel('Chọn file', { exact: true })).toBeVisible();
    const editorCsrf = await (await viewer.request.get('/api/v1/auth/csrf')).json();
    for (const method of ['put', 'delete']) {
      const response = await viewer.request[method](`/api/v1/projects/${project.id}/members/${owner.id}`, { headers: { [editorCsrf.headerName]: editorCsrf.token }, ...(method === 'put' ? { data: { role: 'VIEWER' } } : {}) });
      expect(response.status()).toBe(403);
    }
    await page.getByRole('button', { name: /Gỡ/ }).click();
    await page.getByRole('button', { name: /^Xác nhận gỡ / }).click();
    await expect(page.getByRole('button', { name: /Gỡ/ })).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Kiểm tra lại quyền dự án' }).click();
    await expect(viewer.getByRole('alert')).toContainText('không còn quyền');
  } finally { await context.close(); }
});
test('real Spring/PostgreSQL: S3 disabled fails closed with 503; unknown handover is 404; missing CSRF is 403', async ({ page }) => {
  await login(page); await page.getByText('Tạo dự án mới', { exact: true }).click();
  await page.getByLabel('Tên dự án', { exact: true }).fill('Live fail-closed project');
  await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByRole('alert')).toContainText('Không truy cập được S3');
  const projects = await (await page.request.get('/api/v1/projects')).json();
  const project = projects.items.find(item => item.name === 'Live fail-closed project');
  expect(project.reservedBytes).toBe(0);
  expect((await page.request.post('/api/v1/projects', { data: { name: 'Must fail CSRF' } })).status()).toBe(403);
  await workspaceView(page, 'Mở gói bàn giao'); await page.getByLabel('UUID gói bàn giao', { exact: true }).fill('00000000-0000-0000-0000-000000000000');
  await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click();
  await expect(page.getByText('Gói không tồn tại', { exact: false })).toBeVisible();
});
