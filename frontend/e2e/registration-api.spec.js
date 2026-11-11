import { test, expect } from '@playwright/test';

// Controlled mocks only. backend.live.spec.js proves the separate real PostgreSQL round trip.
const fixture = { displayName: '  Registration Fixture  ', email: 'NewAccount@Example.TEST', password: '  MixedCaseFixture#  ', confirmPassword: '  MixedCaseFixture#  ' };
const user = { id: '10000000-0000-0000-0000-000000000005', email: 'newaccount@example.test', displayName: 'Registration Fixture' };
const success = 'Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.';
const submit = page => page.locator('.guest-panel form button[type="submit"]');
const switchMode = page => page.locator('.auth-mode-switch button');
const observations = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; observations.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR_/.test(message.text())) errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => { expect(observations.get(page)).toEqual([]); });
async function setup(page, register = route => route.fulfill({ status: 201, json: user })) {
  const state = { posts: [], calls: [], loginCalls: 0, logoutCalls: 0, csrfFetches: 0, token: '', loggedIn: false };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.calls.push({ method: request.method(), path });
    if (path.endsWith('/auth/me')) return route.fulfill({ status: state.loggedIn ? 200 : 401, json: state.loggedIn ? user : { code: 'UNAUTHENTICATED' } });
    if (path.endsWith('/auth/csrf')) { state.token = `masked-${++state.csrfFetches}`; return route.fulfill({ json: { headerName: 'X-Registration-CSRF', token: state.token } }); }
    if (path.endsWith('/auth/register')) {
      expect(request.method()).toBe('POST'); expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
      expect(request.headers()['content-type']).toContain('application/json'); expect(request.headers()['accept']).toBe('application/json');
      expect(request.headers()['x-registration-csrf']).toBe(state.token); expect(state.csrfFetches).toBeGreaterThan(0);
      const body = request.postDataJSON(); expect(Object.keys(body).sort()).toEqual(['confirmPassword', 'displayName', 'email', 'password']);
      state.posts.push(body); return register(route, body, state);
    }
    if (path.endsWith('/auth/login')) {
      state.loginCalls++; expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
      expect(request.headers()['x-registration-csrf']).toBe(state.token);
      expect(Object.fromEntries(new URLSearchParams(request.postData()))).toEqual({ email: user.email, password: fixture.password });
      state.loggedIn = true; return route.fulfill({ json: user });
    }
    if (path.endsWith('/auth/logout')) {
      state.logoutCalls++; expect(request.postData()).toBe(null); expect(request.headers()['x-registration-csrf']).toBe(state.token);
      state.loggedIn = false; return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/projects')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    throw new Error(`Unexpected mock registration API: ${request.method()} ${path}`);
  });
  await page.goto('/?registration=mock#/projects');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await switchMode(page).click(); await fill(page); return state;
}
async function fill(page, values = {}) {
  const input = { ...fixture, ...values };
  for (const [name, value] of Object.entries(input)) await page.locator(`#register-${name}`).fill(value);
}
async function failed(page, text) {
  await expect(page.getByRole('alert')).toContainText(text);
  await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible();
  await expect(page.getByText(success, { exact: true })).toHaveCount(0); await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(submit(page)).toBeEnabled(); await expect(switchMode(page)).toBeEnabled();
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Tên tài khoản', { exact: true })).toHaveValue(fixture.displayName);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(fixture.email);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator('body').innerText()).not.toContain(fixture.password);
}
for (const width of [375, 1440]) test(`R05 mock: confirmed 201 returns to the same login Card with safe status at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  const state = await setup(page); const url = page.url();
  await page.locator('.guest-panel > .card').evaluate(card => { window.registrationCard = card; window.registrationDocument = document; });
  await submit(page).click(); await expect(page.getByRole('status')).toHaveText(success);
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(user.email); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveCount(0); await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await page.locator('.guest-panel > .card').evaluate(card => card === window.registrationCard && document === window.registrationDocument)).toBe(true);
  expect(state.posts).toEqual([fixture]); expect(state.loginCalls).toBe(0); expect(state.logoutCalls).toBe(0);
  expect(state.calls).toEqual([{ method: 'GET', path: '/api/v1/auth/me' }, { method: 'GET', path: '/api/v1/auth/csrf' }, { method: 'POST', path: '/api/v1/auth/register' }]);
  expect(page.url()).toBe(url); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`mock-registration-success-${width}.png`), fullPage: true });
  await switchMode(page).click(); await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveValue('');
});
test('R05 mock: synchronous submit events and repeated clicks send one POST; no premature success or mode switch', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const state = await setup(page, async route => { await gate; await route.fulfill({ status: 201, json: user }); });
  try {
    await page.locator('form').evaluate(form => { for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await expect.poll(() => state.posts.length).toBe(1); await expect(submit(page)).toHaveText('Đang đăng ký…');
    await expect(submit(page)).toBeDisabled(); await expect(switchMode(page)).toBeDisabled();
    for (const input of await page.locator('form input').all()) await expect(input).toBeDisabled();
    await submit(page).evaluate(button => button.click()); await switchMode(page).evaluate(button => button.click());
    await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible(); await expect(page.getByText(success, { exact: true })).toHaveCount(0);
    release(); await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(1);
  } finally { release(); }
});
test('R05 mock: duplicate email stays on Register; only an explicit corrected submit retries', async ({ page }) => {
  const state = await setup(page, (route, body, current) => current.posts.length === 1 ? route.fulfill({ status: 409, json: { code: 'EMAIL_ALREADY_EXISTS', message: 'private SQL ignored' } }) : route.fulfill({ status: 201, json: { ...user, email: body.email.toLowerCase() } }));
  await submit(page).click(); await failed(page, 'Email này đã được sử dụng. Vui lòng dùng email khác hoặc đăng nhập.');
  expect(state.posts).toHaveLength(1); expect(await page.locator('body').innerText()).not.toContain('private SQL');
  await fill(page, { email: 'other@example.test' }); expect(state.posts).toHaveLength(1); await submit(page).click();
  await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(2); expect(state.loginCalls).toBe(0);
});
test('R05 mock: backend 400 preserves nonsensitive input and uses registration validation message', async ({ page }) => {
  const state = await setup(page, route => route.fulfill({ status: 400, json: { code: 'VALIDATION_ERROR', message: fixture.password } }));
  await submit(page).click(); await failed(page, 'Thông tin đăng ký không hợp lệ. Vui lòng kiểm tra lại.'); expect(state.posts).toHaveLength(1);
});
test('R05 mock: 403 permits manual CSRF refresh without replay; manual submit uses new dynamic token', async ({ page }) => {
  const state = await setup(page, (route, _body, current) => current.csrfFetches === 1 ? route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } }) : route.fulfill({ status: 201, json: user }));
  await submit(page).click(); await failed(page, 'Không đủ quyền hoặc CSRF đã hết hạn.'); expect(state.posts).toHaveLength(1);
  await page.getByRole('button', { name: 'Làm mới CSRF', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Đã lấy token mới.'); expect(state.csrfFetches).toBe(2); expect(state.posts).toHaveLength(1);
  await fill(page); await submit(page).click(); await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(2);
});
for (const [status, code] of [[500, 'INTERNAL_ERROR'], [503, 'AUTH_UNAVAILABLE'], [401, 'UNAUTHENTICATED']]) test(`R05 mock: ${status} does not authenticate, retry or lock navigation`, async ({ page }) => {
  const state = await setup(page, route => route.fulfill({ status, json: { code, message: fixture.password } }));
  await submit(page).click(); await failed(page, status === 500 ? 'Dịch vụ tạm thời không sẵn sàng.' : status === 503 ? 'Dịch vụ xác thực tạm thời không sẵn sàng.' : 'Phiên đăng nhập đã hết.');
  expect(state.posts).toHaveLength(1); await switchMode(page).click(); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
});
test('R05 mock: network loss leaves an uncertain outcome, clears passwords and never auto retries', async ({ page }) => {
  const state = await setup(page, route => route.abort('failed'));
  await submit(page).click(); await failed(page, 'Không kết nối được máy chủ. Chưa xác nhận được kết quả đăng ký;');
  expect(state.posts).toHaveLength(1); await switchMode(page).click(); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
});
test('R05 mock: timeout is uncertain; a late 201 cannot change the returned login form', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const state = await setup(page, async route => { await gate; await route.fulfill({ status: 201, json: user }); });
  try {
    await page.clock.install(); await submit(page).click(); await expect.poll(() => state.posts.length).toBe(1);
    await page.clock.runFor(20001);
    await failed(page, 'Chưa xác nhận được kết quả đăng ký. Hãy thử đăng nhập bằng email vừa nhập trước khi gửi đăng ký lại.');
    expect(state.posts).toHaveLength(1); await switchMode(page).click();
    await page.getByLabel('Email', { exact: true }).fill('different@example.test'); release();
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('different@example.test'); await expect(page.getByText(success, { exact: true })).toHaveCount(0);
  } finally { release(); }
});
for (const [name, status, body] of [['wrong success status', 200, user], ['missing field', 201, { email: user.email, id: user.id }], ['wrong type', 201, { ...user, displayName: 1 }], ['extra secret', 201, { ...user, passwordHash: 'private-hash' }]]) test(`R05 mock: ${name} cannot falsely confirm registration`, async ({ page }) => {
  const state = await setup(page, route => route.fulfill({ status, json: body }));
  await submit(page).click(); await failed(page, 'Phản hồi máy chủ không xác nhận được kết quả đăng ký.');
  expect(state.posts).toHaveLength(1); expect(await page.locator('body').innerText()).not.toContain('private-hash');
});
for (const [name, values, field] of [
  ['missing name', { displayName: '' }, 'displayName'], ['invalid email', { email: 'not-email' }, 'email'], ['short password', { password: '1234567', confirmPassword: '1234567' }, 'password'],
  ['UTF-8 73 bytes', { password: 'á'.repeat(36) + 'a', confirmPassword: 'á'.repeat(36) + 'a' }, 'password'], ['confirmation mismatch', { confirmPassword: 'DifferentFixture' }, 'confirmPassword'],
]) test(`R05 mock: ${name} makes zero requests`, async ({ page }) => {
  const state = await setup(page); await fill(page, values); await submit(page).click();
  await expect(page.locator(`#register-${field}-error`)).toBeVisible(); expect(state.posts).toHaveLength(0); expect(state.csrfFetches).toBe(0);
});
for (const status of [201, 400]) test(`R05 mock: stale ${status} after session expiry cannot overwrite another mode`, async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const state = await setup(page, async route => { await gate; await route.fulfill({ status, json: status === 201 ? user : { code: 'VALIDATION_ERROR' } }); });
  try {
    await submit(page).click(); await expect.poll(() => state.posts.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('portal-session-expired', { detail: { status: 401, code: 'UNAUTHENTICATED' } })));
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('different@example.test');
    const response = page.waitForResponse(r => r.url().endsWith('/auth/register')); release(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('different@example.test');
    await expect(page.getByRole('alert')).toContainText('Phiên đăng nhập đã hết.'); await expect(page.getByText(success, { exact: true })).toHaveCount(0);
    expect(state.posts).toHaveLength(1); expect(state.loginCalls).toBe(0);
  } finally { release(); }
});
test('R05 mock: explicit login and logout still rotate CSRF; registration never automatically authenticates', async ({ page }) => {
  const state = await setup(page); await submit(page).click(); await expect(page.getByRole('status')).toHaveText(success);
  expect(state.loginCalls).toBe(0); await expect(page.locator('.app-shell')).toHaveCount(0);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password); await submit(page).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible(); expect(state.loginCalls).toBe(1); expect(state.csrfFetches).toBe(3);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.getByRole('status')).toHaveCount(0);
  expect(state.logoutCalls).toBe(1); expect(state.csrfFetches).toBe(4); expect(state.posts).toHaveLength(1);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
