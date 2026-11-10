import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const projectId = '10000000-0000-0000-0000-000000000001';
const file = { id: '20000000-0000-0000-0000-000000000002', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000004', filename: 'recover.txt', size: 3, versionId: 'opaque+/=original', uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };
const signed = { method: 'PUT', url: 'https://s3.example.test/recovery', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } };
const state = { uploadId: file.uploadId, fileVersion: file };
const panel = page => page.locator('.upload-panel');
const submit = page => page.getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true });
const retry = page => page.getByRole('button', { name: 'Thử lại complete cùng Version ID', exact: true });
async function setup(page, options = {}) {
  const calls = { init: [], put: 0, complete: [], read: 0 };
  await page.route('https://s3.example.test/**', async route => {
    calls.put++; expect(route.request().headers().cookie).toBeUndefined(); expect(route.request().headers()['x-csrf']).toBeUndefined();
    if (options.put) return options.put(route);
    return route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-expose-headers': 'x-amz-version-id', 'access-control-allow-origin': '*' } });
  });
  await mockProject(page, 'OWNER', async (route, project) => {
    if (options.extra && await options.extra(route, project)) return true;
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p.endsWith('/files/uploads')) {
      expect(request.method()).toBe('POST'); expect(request.headers()['x-csrf']).toBe('fixture'); calls.init.push(request.postDataJSON());
      if (options.init) await options.init(route); else await route.fulfill({ json: { uploadId: file.uploadId, fileId: file.fileId, fileVersionId: file.id, presignedUpload: options.signed || signed } }); return true;
    }
    if (p.endsWith('/complete')) {
      expect(p).toBe(`/api/v1/projects/${projectId}/files/uploads/${file.uploadId}/complete`); expect(request.method()).toBe('POST'); expect(request.headers()['x-csrf']).toBe('fixture'); calls.complete.push(request.postDataJSON());
      if (options.complete) await options.complete(route, calls.complete.length); else await route.fulfill({ json: state }); return true;
    }
    if (p.endsWith('/uploads/' + file.uploadId)) { calls.read++; await route.fulfill({ json: state }); return true; } return false;
  });
  return calls;
}
async function start(page, filename = file.filename) { await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from('abc') }); await submit(page).click(); }

for (const failure of [400, 401, 403, 404, 409, 503, 'network', 'timeout']) test(`C09.07C: init ${failure} never PUTs or retries; access loss clears protected session UI`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install();
  const calls = await setup(page, { init: route => failure === 'timeout' ? new Promise(() => {}) : failure === 'network' ? route.abort('failed') : route.fulfill({ status: failure, json: { code: failure === 401 ? 'UNAUTHENTICATED' : failure === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR', requestId: 'init-failure-fixture' } }) });
  await start(page, failure === 400 ? '   ' : file.filename); await expect.poll(() => calls.init.length).toBe(1); if (failure === 'timeout') await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toBeVisible(); expect(calls.put).toBe(0); expect(calls.complete).toEqual([]); expect(calls.init).toHaveLength(1);
  if ([401, 403, 404].includes(failure)) { await expect(panel(page)).toHaveCount(0); await expect(page.locator('#project-members')).toHaveCount(0); }
  if (failure === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
});

for (const invalid of ['http', 'credentials', 'method', 'content-type', 'missing-conditional', 'wrong-conditional', 'duplicate-header']) test(`C09.07C: invalid signed ${invalid} refuses PUT and retains session identity without guessing a version`, async ({ page }) => {
  const value = structuredClone(signed);
  if (invalid === 'http') value.url = 'http://s3.example.test/recovery';
  if (invalid === 'credentials') value.url = 'https://user:password@s3.example.test/recovery';
  if (invalid === 'method') value.method = 'POST';
  if (invalid === 'content-type') value.headers['Content-Type'] = 'application/pdf';
  if (invalid === 'missing-conditional') delete value.headers['If-None-Match'];
  if (invalid === 'wrong-conditional') value.headers['If-None-Match'] = 'wrong';
  if (invalid === 'duplicate-header') value.headers['content-type'] = 'text/plain';
  const calls = await setup(page, { signed: value }); await start(page); await expect(panel(page).getByRole('alert')).toContainText('upload không hợp lệ'); expect(calls.put).toBe(0); expect(calls.complete).toHaveLength(0); await expect(retry(page)).toHaveCount(0);
  await panel(page).getByText('Thông tin kỹ thuật phiên upload', { exact: true }).click(); await expect(panel(page).getByText(file.uploadId, { exact: true })).toBeVisible(); await expect(panel(page).getByText('Chưa nhận được', { exact: true })).toBeVisible();
});

for (const failure of [409, 412, 'missing-version', 'network', 'timeout']) test(`C09.07C: PUT ${failure} never repeats PUT, never completes without exact version and does not claim cancellation on server`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install();
  const calls = await setup(page, { put: route => failure === 'timeout' ? new Promise(() => {}) : failure === 'network' ? route.abort('failed') : failure === 'missing-version' ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }) : route.fulfill({ status: failure }) });
  await start(page); await expect.poll(() => calls.put).toBe(1); if (failure === 'timeout') await page.clock.fastForward(120001);
  await expect(panel(page).getByRole('alert')).toBeVisible();
  const message = failure === 409 ? 'S3 trả 409' : failure === 412 ? 'S3 trả 412' : failure === 'missing-version' ? 'Không đọc được S3 Version ID' : failure === 'timeout' ? 'Upload S3 hết thời gian chờ' : 'Không nhận được phản hồi S3';
  await expect(panel(page).getByRole('alert')).toContainText(message); await expect(retry(page)).toHaveCount(0); expect(calls.complete).toHaveLength(0); expect(calls.put).toBe(1); expect(calls.init).toHaveLength(1);
  await expect(panel(page)).toContainText('Bấm upload lần nữa sẽ khởi tạo phiên mới');
});

for (const failure of [409, 503, 'network', 'timeout']) test(`C09.07C: complete ${failure} retains exact version; explicit retry is single-flight and never re-PUTs`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install();
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const calls = await setup(page, { complete: async (route, attempt) => {
      if (attempt === 1) { if (failure === 'timeout') await new Promise(() => {}); else if (failure === 'network') await route.abort('failed'); else await route.fulfill({ status: failure, json: { code: 'HTTP_ERROR' } }); }
      else { await pending; await route.fulfill({ json: state }); }
    } });
    await start(page); await expect.poll(() => calls.complete.length).toBe(1); if (failure === 'timeout') await page.clock.fastForward(21000);
    await expect(panel(page).getByRole('alert')).toBeVisible(); await expect(retry(page)).toBeEnabled(); await retry(page).click(); await expect.poll(() => calls.complete.length).toBe(2); await expect(retry(page)).toBeDisabled();
    await retry(page).evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); expect(calls.complete).toEqual([{ versionId: file.versionId }, { versionId: file.versionId }]); release();
    await expect(panel(page).getByText('VERIFIED', { exact: true })).toBeVisible(); expect(calls.put).toBe(1); expect(calls.init).toHaveLength(1);
  } finally { release(); }
});

test('C09.07C: stop waiting during PUT keeps an uncertain session, ignores a late response and never offers guessed complete', async ({ page }) => {
  let release, returned; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { returned = resolve; });
  try {
    const calls = await setup(page, { put: async route => { await pending; await route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-expose-headers': 'x-amz-version-id', 'access-control-allow-origin': '*' } }); returned(); } });
    await start(page); await expect.poll(() => calls.put).toBe(1); await page.getByRole('button', { name: 'Dừng chờ', exact: true }).click(); await expect(panel(page).getByRole('status')).toContainText('Thao tác trên máy chủ có thể vẫn đã xảy ra');
    release(); await done; await expect(retry(page)).toHaveCount(0); expect(calls.complete).toHaveLength(0); expect(calls.put).toBe(1); await expect(panel(page).getByRole('status')).toContainText('Đã dừng chờ');
  } finally { release(); }
});

for (const exit of ['logout', 'project']) test(`C09.07C: ${exit} during pending PUT clears old session; a late result cannot update the new screen`, async ({ page }) => {
  let release, returned; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { returned = resolve; }); const other = { id: '90000000-0000-0000-0000-000000000009', name: 'Beta upload view', role: 'VIEWER', quotaBytes: 1000, usedBytes: 0, reservedBytes: 0 };
  try {
    const calls = await setup(page, { put: async route => { await pending; await route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-expose-headers': 'x-amz-version-id', 'access-control-allow-origin': '*' } }); returned(); }, extra: async (route, project) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/auth/logout')) { await route.fulfill({ status: 204 }); return true; }
      if (p.endsWith('/projects')) { await route.fulfill({ json: { items: [project, other], page: 0, size: 20 } }); return true; }
      if (p.includes('/' + other.id)) { await route.fulfill({ json: p.endsWith('/members') ? [] : p.endsWith('/files') ? { items: [], page: 0, size: 20 } : other }); return true; } return false;
    } });
    await start(page); await expect.poll(() => calls.put).toBe(1);
    if (exit === 'logout') { await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await expect(submit(page)).toHaveCount(0); }
    else { await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Beta upload view · VIEWER', exact: true }).click(); await workspaceView(page, 'Tài liệu'); }
    release(); await done; await expect(page.getByText('Thông tin kỹ thuật phiên upload', { exact: true })).toHaveCount(0); await expect(retry(page)).toHaveCount(0); expect(calls.complete).toHaveLength(0); expect(calls.put).toBe(1); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { release(); }
});
