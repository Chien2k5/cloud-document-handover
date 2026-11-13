import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const projectId = '10000000-0000-0000-0000-000000000001';
const first = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001', uploadId: '40000000-0000-0000-0000-000000000001', versionId: 'opaque-v1+/=', filename: 'same.txt', size: 3, uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
const second = { ...first, id: '20000000-0000-0000-0000-000000000002', uploadId: '40000000-0000-0000-0000-000000000002', versionId: 'opaque-v2+/=' };
const row = (page, file) => page.locator(`[data-file-version-id="${file.id}"]`);
const link = page => page.getByRole('link', { name: 'Tải phiên bản đã chọn', exact: true });
const button = (page, file = first) => row(page, file).getByRole('button', { name: 'Lấy link tải same.txt', exact: true });
const valid = (file, expiresAt = '2099-01-01T00:00:00Z') => ({ url: `https://s3.example.test/object?versionId=${encodeURIComponent(file.versionId)}`, versionId: file.versionId, expiresAt });
async function setup(page, { respond, extra = async () => false } = {}) {
  const requests = [];
  await mockProject(page, 'OWNER', async (route, project, user) => {
    if (await extra(route, project, user)) return true;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [first, second], page: 0, size: 20 } }); return true; }
    if (path.endsWith('/download')) {
      const file = path.includes('/' + first.id + '/') ? first : second;
      expect(route.request().method()).toBe('GET'); expect(route.request().postData()).toBeNull();
      expect(path).toBe(`/api/v1/projects/${projectId}/files/${file.id}/download`); requests.push(file.id);
      if (respond) await respond(route, file); else await route.fulfill({ json: valid(file) }); return true;
    }
    return false;
  });
  await workspaceView(page, 'Tài liệu'); return requests;
}

test('C09.06D: exact v1/v2 path and S3 version, keyboard access, Back/Forward keep the selected version', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const requests = await setup(page);
  await row(page, first).getByRole('checkbox').check(); await button(page, first).focus(); await page.keyboard.press('Enter');
  await expect(row(page, first).getByRole('link', { name: 'Tải phiên bản đã chọn', exact: true })).toHaveAttribute('href', valid(first).url);
  await expect(link(page)).toHaveAttribute('target', '_blank'); await expect(link(page)).toHaveAttribute('rel', 'noopener noreferrer');
  await workspaceView(page, 'Thành viên'); await page.goBack(); await expect(page).toHaveURL(/\/files$/); await expect(link(page)).toHaveAttribute('href', valid(first).url);
  await page.goForward(); await expect(page).toHaveURL(/\/members$/); await expect(row(page, first).getByRole('checkbox')).toBeChecked();
  await workspaceView(page, 'Tài liệu'); await button(page, second).click(); await expect(link(page)).toHaveCount(1); await expect(row(page, first).getByRole('link')).toHaveCount(0);
  await expect(row(page, second).getByRole('link')).toHaveAttribute('href', valid(second).url); expect(requests).toEqual([first.id, second.id]); expect(errors).toEqual([]);
});

for (const invalid of ['wrong-version', 'http', 'javascript', 'malformed', 'credentials', 'expired', 'missing-expiry', 'invalid-expiry']) test(`C09.06D: ${invalid} response never exposes a download URL`, async ({ page }) => {
  const result = valid(first);
  if (invalid === 'wrong-version') result.versionId = second.versionId;
  if (invalid === 'http') result.url = 'http://s3.example.test/object';
  if (invalid === 'javascript') result.url = 'javascript:alert(1)';
  if (invalid === 'malformed') result.url = 'not-a-url';
  if (invalid === 'credentials') result.url = 'https://user:password@s3.example.test/object';
  if (invalid === 'expired') result.expiresAt = '2000-01-01T00:00:00Z';
  if (invalid === 'missing-expiry') delete result.expiresAt;
  if (invalid === 'invalid-expiry') result.expiresAt = 'invalid';
  const requests = await setup(page, { respond: route => route.fulfill({ json: result }) }); await button(page).click();
  await expect(page.getByRole('alert')).toBeVisible(); await expect(link(page)).toHaveCount(0); expect(requests).toEqual([first.id]);
});

test('C09.06D: a visible link expires without another render, including hidden navigation; a fresh backend link can be requested', async ({ page }) => {
  const start = Date.parse('2030-01-01T00:00:00Z'); await page.clock.install({ time: start }); let deadline = start + 5000;
  const requests = await setup(page, { respond: (route, file) => route.fulfill({ json: valid(file, new Date(deadline).toISOString()) }) });
  await button(page).click(); await expect(link(page)).toHaveAttribute('href', valid(first).url);
  await workspaceView(page, 'Mở gói bàn giao'); await page.clock.fastForward(6000); await workspaceView(page, 'Tài liệu');
  await expect(link(page)).toHaveCount(0); await expect(row(page, first).getByRole('status')).toContainText('Lấy link tải mới');
  deadline = start + 16000; await button(page).click(); await expect(link(page)).toHaveAttribute('href', valid(first).url); expect(requests).toEqual([first.id, first.id]);
});

test('C09.06D: click-time expiry guard blocks navigation when the clock jumps before a timer fires', async ({ page }) => {
  const start = Date.parse('2030-01-01T00:00:00Z'); await page.clock.install({ time: start }); let popups = 0; page.on('popup', () => popups++);
  await setup(page, { respond: (route, file) => route.fulfill({ json: valid(file, new Date(start + 5000).toISOString()) }) });
  await button(page).click(); await expect(link(page)).toBeVisible(); await page.clock.setSystemTime(start + 6000);
  await link(page).focus(); await page.keyboard.press('Enter'); await expect(link(page)).toHaveCount(0); await expect(row(page, first).getByRole('status')).toContainText('Lấy link tải mới'); expect(popups).toBe(0);
});

test('C09.06D: changing the requested FileVersion clears the old URL while pending and allows only one manual request', async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const requests = await setup(page, { respond: async (route, file) => { if (file.id === second.id) await pending; await route.fulfill({ json: valid(file) }); } });
    await button(page).click(); await expect(link(page)).toBeVisible(); await button(page, second).click(); await expect.poll(() => requests.length).toBe(2);
    await expect(link(page)).toHaveCount(0); await expect(button(page)).toBeDisabled();
    await button(page).evaluate(element => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); expect(requests).toEqual([first.id, second.id]);
    release(); await expect(row(page, second).getByRole('link')).toHaveAttribute('href', valid(second).url);
  } finally { release(); }
});

for (const failure of [401, 403, 404, 503, 'network', 'timeout']) test(`C09.06D: download ${failure} shows failure without retry or stale URL, clearing protected content on access loss`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install(); let denied = false;
  const requests = await setup(page, { respond: (route, file) => !denied ? route.fulfill({ json: valid(file) }) : failure === 'timeout' ? new Promise(() => {}) : failure === 'network' ? route.abort('failed') : route.fulfill({ status: failure, json: { code: failure === 401 ? 'UNAUTHENTICATED' : failure === 404 ? 'PROJECT_NOT_FOUND' : 'HTTP_ERROR', requestId: 'file-download-fixture' } }) });
  await row(page, first).getByRole('checkbox').check(); await button(page).click(); await expect(link(page)).toBeVisible(); denied = true; await button(page, second).click(); await expect.poll(() => requests.length).toBe(2);
  if (failure === 'timeout') await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toBeVisible(); await expect(link(page)).toHaveCount(0);
  if ([401, 403, 404].includes(failure)) { await expect(page.locator('#project-files')).toHaveCount(0); await expect(page.locator('#project-members')).toHaveCount(0); }
  else await expect(row(page, first).getByRole('checkbox')).toBeChecked();
  if (failure === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  else if (typeof failure === 'number') await expect(page.getByRole('alert')).toContainText('file-download-fixture');
  if (failure === 403) { await page.getByRole('button', { name: 'Làm mới CSRF', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Đã lấy token mới'); }
  expect(requests).toEqual([first.id, second.id]);
});

for (const action of ['reload', 'check', 'new-version']) test(`C09.06D: ${action} clears an earlier download URL`, async ({ page }) => {
  await setup(page, { extra: async route => { if (!new URL(route.request().url()).pathname.endsWith('/uploads/' + first.uploadId)) return false; await route.fulfill({ json: { uploadId: first.uploadId, fileVersion: first } }); return true; } });
  await button(page).click(); await expect(link(page)).toBeVisible();
  await (action === 'reload' ? page.getByRole('button', { name: 'Tải lại danh sách file', exact: true }) : row(page, first).getByRole('button', { name: (action === 'check' ? 'Kiểm tra lại ' : 'Thêm phiên bản ') + first.filename, exact: true })).click();
  await expect(link(page)).toHaveCount(0);
});

test('C09.06D: logout removes URL and selected versions; a different account never inherits either', async ({ page }) => {
  let loggedOut = false, otherAccount = false;
  await setup(page, { extra: async (route, project) => {
    if (otherAccount) project.role = 'VIEWER';
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/logout')) { loggedOut = true; await route.fulfill({ status: 204 }); return true; }
    if (path.endsWith('/auth/login')) { otherAccount = true; await route.fulfill({ json: { id: '90000000-0000-0000-0000-000000000009', email: 'viewer@example.test', displayName: 'New account fixture' } }); return true; }
    if (loggedOut && path.endsWith('/auth/me')) { await route.fulfill(otherAccount ? { json: { id: '90000000-0000-0000-0000-000000000009', email: 'viewer@example.test', displayName: 'New account fixture' } } : { status: 401, json: { code: 'UNAUTHENTICATED' } }); return true; } return false;
  } });
  await row(page, first).getByRole('checkbox').check(); await button(page).click(); await expect(link(page)).toBeVisible(); await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.locator('[data-file-version-id]')).toHaveCount(0); await expect(link(page)).toHaveCount(0); await page.getByLabel('Email', { exact: true }).fill('viewer@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('New account fixture', { exact: true })).toBeVisible(); await workspaceView(page, 'Tài liệu');
  await expect(row(page, first)).toBeVisible(); await expect(row(page, first).getByRole('checkbox')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toHaveCount(0); await expect(link(page)).toHaveCount(0); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('C09.06D: late download for project A cannot expose a URL or selection in B', async ({ page }) => {
  let release, returned; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { returned = resolve; });
  const other = { id: '90000000-0000-0000-0000-000000000009', name: 'Beta file view', role: 'VIEWER', quotaBytes: 1000, usedBytes: 0, reservedBytes: 0 };
  try {
    const requests = await setup(page, { respond: async route => { await pending; await route.fulfill({ json: valid(first) }); returned(); }, extra: async (route, project) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/projects')) { await route.fulfill({ json: { items: [project, other], page: 0, size: 20 } }); return true; }
      if (path.includes('/' + other.id)) { await route.fulfill({ json: path.endsWith('/members') ? [] : path.endsWith('/files') ? { items: [], page: 0, size: 20 } : other }); return true; } return false;
    } });
    await row(page, first).getByRole('checkbox').check(); await button(page).click(); await expect.poll(() => requests.length).toBe(1);
    await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Beta file view · VIEWER', exact: true }).click(); release(); await done; await workspaceView(page, 'Tài liệu');
    await expect(link(page)).toHaveCount(0); await expect(page.locator('[data-file-version-id]')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toHaveCount(0); expect(requests).toEqual([first.id]);
  } finally { release(); }
});
