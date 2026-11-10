import { test, expect } from '@playwright/test';
const id = '10000000-0000-0000-0000-000000000001';
const createdId = '20000000-0000-0000-0000-000000000002';
const sample = (index = 1) => ({ id: `10000000-0000-0000-0000-${String(index).padStart(12, '0')}`, name: `Project ${index}`, description: 'Tài liệu bàn giao', role: 'OWNER', quotaBytes: 1000000, usedBytes: 0, reservedBytes: 0 });
async function landing(page, { count = 1, get, post } = {}) {
  const reads = [], writes = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id, displayName: 'MOCK DATA · Workspace', email: 'fixture@example.test' } });
    if (path.endsWith('/auth/csrf')) return route.fulfill({ json: { headerName: 'X-CSRF', token: 'fixture' } });
    if (path.endsWith('/projects') && request.method() === 'POST') {
      writes.push(request.postDataJSON()); expect(request.headers()['x-csrf']).toBe('fixture');
      return post ? post(route) : route.fulfill({ json: { ...sample(), id: createdId, name: request.postDataJSON().name } });
    }
    if (path.endsWith('/projects')) {
      const pageNumber = Number(url.searchParams.get('page')); reads.push(url.search);
      expect(url.searchParams.get('size')).toBe('20');
      if (get) return get(route, pageNumber);
      return route.fulfill({ json: { items: Array.from({ length: Math.max(0, Math.min(20, count - pageNumber * 20)) }, (_, i) => sample(i + 1 + pageNumber * 20)), page: pageNumber, size: 20 } });
    }
    if (path.endsWith('/members')) return route.fulfill({ json: [] });
    if (path.endsWith('/files')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    if (path.endsWith('/projects/' + createdId)) return route.fulfill({ json: { ...sample(), id: createdId, name: 'Created project' } });
    if (path.includes('/projects/')) return route.fulfill({ json: sample(Number(path.slice(-12))) });
    throw new Error(`Unexpected request ${request.method()} ${path}`);
  });
  await page.goto('/');
  return { reads, writes };
}
const list = page => page.locator('#workspace-projects');
async function createForm(page) { await page.getByRole('button', { name: 'Tạo dự án mới', exact: true }).click(); await expect(page.getByLabel('Tên dự án', { exact: true })).toBeFocused(); }

for (const count of [0, 1, 20, 21]) test(`C09.03: API pagination with ${count} total fixture projects`, async ({ page }) => {
  const { reads } = await landing(page, { count });
  await expect(list(page).getByRole('status')).toHaveCount(0);
  await expect(list(page).locator('.project-tile')).toHaveCount(Math.min(count, 20));
  const next = list(page).getByRole('button', { name: 'Trang sau', exact: true });
  if (count < 20) await expect(next).toBeDisabled();
  else {
    await next.click(); await expect(list(page).getByText('Trang 2', { exact: true })).toBeVisible();
    await expect(list(page).locator('.project-tile')).toHaveCount(Math.max(0, count - 20)); await expect(next).toBeDisabled();
    await list(page).getByRole('button', { name: 'Trang trước', exact: true }).click();
    await expect(list(page).locator('.project-tile')).toHaveCount(20);
  }
  await list(page).getByRole('button', { name: 'Tải lại dự án', exact: true }).click();
  await expect.poll(() => reads.length).toBeGreaterThan(1);
  expect(reads.every(query => /[?&]size=20/.test(query))).toBe(true);
  if (count) { await list(page).getByRole('button', { name: 'Project 1 · OWNER', exact: true }).click(); await expect(page).toHaveURL(new RegExp(id + '/overview$')); }
});

for (const status of [401, 403, 503, 'network']) test(`C09.03: list ${status} is visible and never becomes a fake empty success`, async ({ page }) => {
  await landing(page, { get: route => status === 'network' ? route.abort('failed') : route.fulfill({ status, json: { code: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'ACCESS_DENIED' : 'SERVICE_UNAVAILABLE', requestId: 'fixture-list-error' } }) });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Chưa có dự án ở trang này', { exact: true })).toHaveCount(0);
  if (status === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  else { await expect(list(page).locator('.project-tile')).toHaveCount(0); await expect(list(page).getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled(); }
});

test('C09.03: loading state and limits, blank and whitespace cannot send a POST', async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const { writes } = await landing(page, { get: async route => { await pending; return route.fulfill({ json: { items: [], page: 0, size: 20 } }); } });
    await expect(list(page).getByRole('status')).toHaveText('Đang tải dự án…');
    await expect(list(page).getByRole('button', { name: 'Tải lại dự án', exact: true })).toBeDisabled(); release();
    await createForm(page);
    const name = page.getByLabel('Tên dự án', { exact: true }), description = page.getByLabel('Mô tả', { exact: true });
    await expect(name).toHaveAttribute('maxlength', '150'); await expect(description).toHaveAttribute('maxlength', '2000');
    await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click(); expect(writes).toHaveLength(0);
    await name.fill('   '); await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Nhập tên dự án, không chỉ khoảng trắng.'); expect(writes).toHaveLength(0);
    await name.fill('x'.repeat(151)); await expect(name).toHaveValue('x'.repeat(150));
    await description.fill('y'.repeat(2001)); await expect(description).toHaveValue('y'.repeat(2000)); expect(writes).toHaveLength(0);
  } finally { release(); }
});

for (const boundary of [false, true]) test(`C09.03: create ${boundary ? 'max length' : 'trimmed name, empty description'} once, select actual response UUID`, async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const { writes, reads } = await landing(page, { post: async route => { await pending; return route.fulfill({ json: { id: createdId } }); } });
    await createForm(page); await page.getByLabel('Tên dự án', { exact: true }).fill(boundary ? 'x'.repeat(150) : '  Project  ');
    await page.getByLabel('Mô tả', { exact: true }).fill(boundary ? 'y'.repeat(2000) : '   ');
    await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click(); await expect.poll(() => writes.length).toBe(1);
    const pendingButton = page.getByRole('button', { name: 'Đang tạo dự án…', exact: true }); await expect(pendingButton).toBeDisabled();
    await pendingButton.evaluate(element => { element.click(); element.form.requestSubmit(); }); expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ name: boundary ? 'x'.repeat(150) : 'Project', description: boundary ? 'y'.repeat(2000) : '' });
    release(); await expect(page).toHaveURL(new RegExp(createdId + '/overview$'));
    await expect(page.locator('#project-overview').getByRole('heading', { name: 'Created project', exact: true })).toBeVisible();
    await expect.poll(() => reads.length).toBe(2); expect(writes).toHaveLength(1);
    await expect(page.getByLabel('Tên dự án', { exact: true })).toHaveValue('');
  } finally { release(); }
});

for (const status of [400, 401, 403, 409, 503, 'timeout', 'invalid-response']) test(`C09.03: create ${status} retains error and never automatically retries`, async ({ page }) => {
  if (status === 'timeout') await page.clock.install();
  const { writes } = await landing(page, { post: route => status === 'timeout' ? new Promise(() => {}) : route.fulfill(status === 'invalid-response' ? { json: { id: 'invalid' } } : { status, json: { code: status === 401 ? 'UNAUTHENTICATED' : status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR', requestId: 'fixture-create-error' } }) });
  await createForm(page); await page.getByLabel('Tên dự án', { exact: true }).fill('Keep typed value');
  await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click(); await expect.poll(() => writes.length).toBe(1);
  if (status === 'timeout') await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toBeVisible();
  if (status === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  else {
    await expect(page.getByLabel('Tên dự án', { exact: true })).toHaveValue('Keep typed value');
    if (typeof status === 'number') await expect(page.getByRole('alert')).toContainText('fixture-create-error');
    if (status === 'timeout') await expect(page.getByRole('alert')).toContainText('có thể đã được máy chủ nhận');
    await expect(page.getByRole('button', { name: 'Tạo dự án', exact: true })).toBeEnabled();
  }
  expect(writes).toHaveLength(1); expect(page.url()).not.toContain(createdId);
});

for (const width of [375, 768, 1440]) test(`C09.03: project landing and form responsive at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await landing(page, { count: 3 }); await expect(list(page).locator('.project-tile')).toHaveCount(3);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath(`fixture-projects-${width}.png`) });
  await createForm(page); await page.getByLabel('Tên dự án', { exact: true }).fill('MOCK DATA · Dự án nhóm 5');
  await page.getByLabel('Mô tả', { exact: true }).fill('Bản xem trước bằng fixture, không phải dữ liệu backend thật.');
  await page.locator('.create-project').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fixture-create-project-${width}.png`) }); expect(errors).toEqual([]);
});
