import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';

// Controlled MOCK_E2E only. Existing backend.live.spec.js/runner remains the REAL_E2E gate.
const success = 'Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.';
const password = '  CaseFixtureR07#  ';
const baseInput = { displayName: 'R07 Fixture', email: 'signup@example.test', password, confirmPassword: password };
const existingUser = { id: '80000000-0000-0000-0000-000000000008', email: 'returning@example.test', displayName: 'Returning fixture' };
const submit = page => page.locator('.guest-panel form button[type="submit"]');
const mode = page => page.locator('.auth-mode-switch button');
const observations = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => {
  const audit = { origin: new URL(baseURL).origin, requests: [], console: [], errors: [], secrets: [] }; observations.set(page, audit);
  page.on('request', request => audit.requests.push(request));
  page.on('pageerror', error => audit.errors.push(error.message));
  page.on('console', message => {
    audit.console.push(message.text());
    if (message.type() === 'error' && !/Failed to load resource:.*(?:status of (?:400|401|403|409|500|503)|net::ERR_)/.test(message.text())) audit.errors.push(message.text());
  });
  // Prevent an unexpected request from leaving the local test origin; do not contact external services.
  await page.route('**/*', route => new URL(route.request().url()).origin === audit.origin ? route.fallback() : route.abort('blockedbyclient'));
  await page.addInitScript(() => {
    window.r07Audit = { storageWrites: 0, cookieWrites: 0, cookieInterceptor: false };
    const store = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) { window.r07Audit.storageWrites++; return store.apply(this, args); };
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookie?.set) {
      Object.defineProperty(Document.prototype, 'cookie', { ...cookie, set(value) { window.r07Audit.cookieWrites++; cookie.set.call(this, value); } });
      window.r07Audit.cookieInterceptor = true;
    }
    window.r07Injected = false;
  });
});
test.afterEach(async ({ page }) => {
  const audit = observations.get(page);
  expect(audit.errors).toEqual([]);
  for (const request of audit.requests) {
    const url = new URL(request.url()); expect(url.origin).toBe(audit.origin);
    for (const secret of audit.secrets) {
      expect(request.url().includes(secret) || request.url().includes(encodeURIComponent(secret))).toBe(false);
      if ((request.postData() || '').includes(secret)) {
        expect(request.method()).toBe('POST'); expect(['/api/v1/auth/register', '/api/v1/auth/login']).toContain(url.pathname);
      }
    }
  }
  for (const secret of audit.secrets) expect(audit.console.some(text => text.includes(secret))).toBe(false);
  const visible = await page.evaluate(() => {
    const clone = document.body.cloneNode(true); clone.querySelectorAll('input[type="password"]').forEach(input => input.remove());
    return { ...window.r07Audit, local: localStorage.length, session: sessionStorage.length, html: clone.innerHTML, href: location.href };
  });
  expect(visible.storageWrites).toBe(0); expect(visible.cookieWrites).toBe(0); expect(visible.cookieInterceptor).toBe(true);
  expect([visible.local, visible.session]).toEqual([0, 0]);
  for (const secret of audit.secrets) {
    expect(visible.html.includes(secret)).toBe(false); expect(visible.href.includes(secret) || visible.href.includes(encodeURIComponent(secret))).toBe(false);
    expect((await page.context().cookies()).some(cookie => cookie.value.includes(secret))).toBe(false);
  }
});
async function fixture(page, { register, initiallyAuthenticated = false } = {}) {
  const state = { posts: [], calls: [], loginCalls: 0, csrfFetches: 0, token: '', active: initiallyAuthenticated ? existingUser : null, accounts: new Map([[existingUser.email, { user: existingUser, password }]]) };
  state.succeed = async (route, body) => {
    const user = { id: '70000000-0000-0000-0000-000000000007', email: body.email.trim().toLowerCase(), displayName: body.displayName.trim() };
    state.accounts.set(user.email, { user, password: body.password }); await route.fulfill({ status: 201, json: user });
  };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname; state.calls.push({ method: request.method(), path });
    if (path.endsWith('/auth/me')) return route.fulfill({ status: state.active ? 200 : 401, json: state.active || { code: 'UNAUTHENTICATED' } });
    if (path.endsWith('/auth/csrf')) { state.token = `masked-r07-${++state.csrfFetches}`; return route.fulfill({ json: { headerName: 'X-R07-CSRF', token: state.token } }); }
    if (path.endsWith('/auth/register')) {
      expect(request.method()).toBe('POST'); expect(request.headers()['x-r07-csrf']).toBe(state.token);
      expect(request.headers()['content-type']).toContain('application/json'); const body = request.postDataJSON();
      expect(Object.keys(body).sort()).toEqual(['confirmPassword', 'displayName', 'email', 'password']); state.posts.push(body);
      return register ? register(route, body, state) : state.succeed(route, body);
    }
    if (path.endsWith('/auth/login')) {
      state.loginCalls++; expect(request.headers()['x-r07-csrf']).toBe(state.token); expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
      const form = Object.fromEntries(new URLSearchParams(request.postData())), account = state.accounts.get(form.email);
      if (!account || form.password !== account.password) return route.fulfill({ status: 401, json: { code: 'INVALID_CREDENTIALS' } });
      state.active = account.user; return route.fulfill({ json: state.active });
    }
    if (path.endsWith('/auth/logout')) { state.active = null; return route.fulfill({ status: 204 }); }
    if (path === '/api/v1/projects') return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    throw new Error(`Unexpected R07 fixture endpoint: ${request.method()} ${path}`);
  });
  await page.goto('/?r07=preserve#/projects'); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); return state;
}
async function open(page) { await mode(page).click(); await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible(); }
async function fill(page, values = {}) {
  const body = { ...baseInput, ...values }; observations.get(page).secrets.push(body.password, body.confirmPassword);
  for (const [key, value] of Object.entries(body)) await page.locator(`#register-${key}`).fill(value);
}
async function login(page, email = existingUser.email, secret = password) {
  observations.get(page).secrets.push(secret);
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Mật khẩu', { exact: true }).fill(secret); await submit(page).click();
  await expect(page.locator('.app-shell')).toBeVisible(); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const surface = await page.locator('.guest-panel > .card').count() ? page.locator('.guest-panel > .card') : page.locator('#workspace-main');
  await expect(surface).toBeVisible(); const box = await surface.boundingBox(); expect(box).not.toBe(null);
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
}

test('R07 mock: reload and repeated mode cycles preserve URL/history, clear passwords and never mutate', async ({ page }) => {
  const state = await fixture(page); const before = await page.evaluate(() => ({ href: location.href, history: history.length }));
  await page.evaluate(() => { window.r07Document = document; });
  for (let i = 0; i < 6; i++) {
    await open(page); await fill(page); await mode(page).click();
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
    expect(await page.evaluate(() => document === window.r07Document)).toBe(true);
    expect(await page.evaluate(() => ({ href: location.href, history: history.length }))).toEqual(before);
  }
  await open(page); await page.reload();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.locator('form input')).toHaveCount(2);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(page.url()).toBe(before.href); expect(state.posts).toHaveLength(0); expect(state.calls.filter(call => call.path.endsWith('/auth/me'))).toHaveLength(2);
});
for (const [name, displayName] of [['one character', 'A'], ['100 characters', 'N'.repeat(100)], ['Vietnamese', 'Nhóm Đăng và Dũng'], ['HTML as text', '<img src=x onerror="window.r07Injected=true">'], ['special punctuation', `O'Hara & Co <team> / \\`]]) test(`R07 mock: name data ${name} survives JSON and renders safely after explicit login`, async ({ page }) => {
  const state = await fixture(page); await open(page); await fill(page, { displayName }); await submit(page).click();
  await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(1); expect(state.posts[0].displayName).toBe(displayName);
  expect(state.active).toBe(null); await login(page, baseInput.email);
  await expect(page.locator('.account-area__identity strong')).toHaveText(displayName); expect(await page.evaluate(() => window.r07Injected)).toBe(false);
  await expect(page.locator('.account-area__identity img, .account-area__identity script')).toHaveCount(0);
});
for (const [name, field, value, message] of [
  ['name 101', 'displayName', 'n'.repeat(101), 'Tên tài khoản tối đa 100 ký tự.'],
  ['very long name', 'displayName', 'n'.repeat(100000), 'Tên tài khoản tối đa 100 ký tự.'],
  ['email 255', 'email', 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(62), 'Email tối đa 254 ký tự.'],
]) test(`R07 mock: handler rejects ${name} even if the browser maxlength gate is removed`, async ({ page }) => {
  const state = await fixture(page); await open(page);
  // Explicit DOM tampering exercises the submit guard in addition to R04's native typing limit.
  await page.locator(`#register-${field}`).evaluate(input => input.removeAttribute('maxlength'));
  await fill(page, { [field]: value }); await submit(page).click();
  await expect(page.locator(`#register-${field}-error`)).toHaveText(message); await expect(page.locator(`#register-${field}`)).toBeFocused();
  expect(state.posts).toHaveLength(0); expect(state.csrfFetches).toBe(0); await mode(page).click(); await expect(submit(page)).toBeEnabled();
});
for (const [name, email, accepted] of [['special local part', "o'hara+tag@example.test", true], ['padded uppercase', '  Mixed@Example.TEST  ', true], ['missing domain', 'person@', false]]) test(`R07 mock: email format ${name} respects existing browser/server boundary`, async ({ page }) => {
  const state = await fixture(page); await open(page); await fill(page, { email }); await submit(page).click();
  if (accepted) {
    await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(1);
    expect(state.posts[0].email.trim()).toBe(email.trim()); await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email.trim().toLowerCase());
  } else { await expect(page.locator('#register-email-error')).toHaveText('Email không hợp lệ.'); expect(state.posts).toHaveLength(0); }
});
test('R07 mock: a syntactically valid 254-character email can actually submit', async ({ page }) => {
  const email = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
  expect([...email]).toHaveLength(254); const state = await fixture(page); await open(page); await fill(page, { email });
  expect(await page.getByLabel('Email', { exact: true }).evaluate(input => input.validity.typeMismatch)).toBe(false);
  await submit(page).click(); await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(1); expect(state.posts[0].email).toBe(email);
});
for (const [name, secret, bytes, accepted] of [
  ['Vietnamese 72 bytes', 'ắ'.repeat(24), 72, true], ['Vietnamese 73 bytes', 'ắ'.repeat(24) + 'a', 73, false],
  ['combining 72 bytes', 'e\u0301'.repeat(24), 72, true], ['combining 73 bytes', 'e\u0301'.repeat(24) + 'a', 73, false],
  ['seven emoji code points', '😀'.repeat(7), 28, false], ['eight emoji code points', '😀'.repeat(8), 32, true],
]) test(`R07 mock: UTF-8 boundary ${name}`, async ({ page }) => {
  expect(new TextEncoder().encode(secret).length).toBe(bytes);
  const state = await fixture(page); await open(page); await fill(page, { password: secret, confirmPassword: secret }); await submit(page).click();
  if (accepted) { await expect(page.getByRole('status')).toHaveText(success); expect(state.posts).toHaveLength(1); expect(state.posts[0].password === secret && state.posts[0].confirmPassword === secret).toBe(true); }
  else { await expect(page.locator('#register-password-error')).toHaveText(bytes > 72 ? 'Mật khẩu tối đa 72 byte UTF-8.' : 'Mật khẩu phải có tối thiểu 8 ký tự.'); expect(state.posts).toHaveLength(0); }
});
for (const [name, confirmation] of [['different case', password.toLowerCase()], ['missing padding', password.trim()]]) test(`R07 mock: confirmation ${name} cannot submit`, async ({ page }) => {
  const state = await fixture(page); await open(page); await fill(page, { confirmPassword: confirmation }); await submit(page).click();
  await expect(page.locator('#register-confirmPassword-error')).toHaveText('Mật khẩu nhập lại không khớp.'); expect(state.posts).toHaveLength(0);
});
for (const action of ['double click', 'repeated Enter', 'click then Enter']) test(`R07 mock: native race ${action} has exactly one pending POST and one success notice`, async ({ page }) => {
  const gate = Promise.withResolvers(); const state = await fixture(page, { register: async (route, body, current) => { await gate.promise; return current.succeed(route, body); } });
  try {
    await open(page); await fill(page); await page.clock.install();
    if (action === 'double click') await submit(page).dblclick();
    else if (action === 'repeated Enter') { await page.getByLabel('Nhập lại mật khẩu', { exact: true }).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press('Enter'); }
    else { await submit(page).click(); await page.keyboard.press('Enter'); }
    await expect.poll(() => state.posts.length).toBe(1); await expect(submit(page)).toBeDisabled(); await expect(mode(page)).toBeDisabled();
    await expect(submit(page)).toHaveText('Đang đăng ký…'); await expect(page.getByRole('status')).toHaveCount(0);
    gate.resolve(); await expect(page.getByRole('status')).toHaveText(success); await expect(page.getByRole('status')).toHaveCount(1);
    await page.clock.fastForward(60000); expect(state.posts).toHaveLength(1); expect(state.loginCalls).toBe(0);
  } finally { gate.resolve(); }
});
test('R07 mock: reload during pending registration discards the old document and does not replay POST', async ({ page }) => {
  const gate = Promise.withResolvers(); const state = await fixture(page, { register: async (route, body, current) => { await gate.promise; return current.succeed(route, body); } });
  try {
    await open(page); await fill(page); await submit(page).click(); await expect.poll(() => state.posts.length).toBe(1);
    const url = page.url(); await page.reload(); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('fresh@example.test'); gate.resolve();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('status')).toHaveCount(0); await expect(page.getByLabel('Email', { exact: true })).toHaveValue('fresh@example.test');
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); expect(state.posts).toHaveLength(1); expect(page.url()).toBe(url);
  } finally { gate.resolve(); }
});
for (const status of [201, 500]) test(`R07 mock: old registration ${status} cannot overwrite a newly logged-in account`, async ({ page }) => {
  const gate = Promise.withResolvers(); const state = await fixture(page, { register: async (route, body, current) => { await gate.promise; return status === 201 ? current.succeed(route, body) : route.fulfill({ status, json: { code: 'INTERNAL_ERROR' } }); } });
  try {
    await open(page); await fill(page); await submit(page).click(); await expect.poll(() => state.posts.length).toBe(1);
    // Exercise the existing expiry event contract; the separate protected-401 test exercises its real API trigger.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('portal-session-expired', { detail: { status: 401, code: 'UNAUTHENTICATED' } })));
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await login(page);
    const response = page.waitForResponse(reply => reply.url().endsWith('/auth/register')); gate.resolve(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.account-area__identity strong')).toHaveText(existingUser.displayName); await expect(page.locator('.app-shell .error')).toHaveCount(0);
    await expect(page.getByText(success, { exact: true })).toHaveCount(0); expect(state.posts).toHaveLength(1); expect(state.loginCalls).toBe(1);
  } finally { gate.resolve(); }
});
for (const malformed of ['missing id', 'missing email', 'non JSON']) test(`R07 mock: response ${malformed} stays an unconfirmed error without retry`, async ({ page }) => {
  const state = await fixture(page, { register: route => {
    if (malformed === 'non JSON') return route.fulfill({ status: 201, contentType: 'text/html', body: '<html>fixture failure</html>' });
    const user = { id: '70000000-0000-0000-0000-000000000007', email: baseInput.email, displayName: baseInput.displayName };
    delete user[malformed === 'missing id' ? 'id' : 'email']; return route.fulfill({ status: 201, json: user });
  } });
  await open(page); await fill(page); await submit(page).click();
  await expect(page.getByRole('alert')).toContainText('Phản hồi máy chủ không xác nhận được kết quả đăng ký.');
  await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible(); await expect(submit(page)).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0); expect(state.posts).toHaveLength(1); expect(state.loginCalls).toBe(0);
});
for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) test(`R07 mock: responsive states and manual 400 recovery at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height }); const gate = Promise.withResolvers();
  const state = await fixture(page, { register: async (route, body, current) => {
    if (current.posts.length === 1) return route.fulfill({ status: 400, json: { code: 'VALIDATION_ERROR' } });
    await gate.promise; return current.succeed(route, body);
  } });
  try {
    await open(page); await submit(page).click();
    for (const field of ['displayName', 'email', 'password', 'confirmPassword']) {
      await expect(page.locator(`#register-${field}-error`)).toHaveAttribute('role', 'alert'); await expect(page.locator(`#register-${field}`)).toHaveAttribute('aria-invalid', 'true');
    }
    await noOverflow(page); await page.screenshot({ path: info.outputPath(`mock-validation-${width}.png`), fullPage: true });
    await fill(page); await submit(page).click(); await expect(page.getByRole('alert')).toContainText('Thông tin đăng ký không hợp lệ.');
    await expect(submit(page)).toBeEnabled(); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); expect(state.posts).toHaveLength(1);
    await noOverflow(page); await page.screenshot({ path: info.outputPath(`mock-server-error-${width}.png`), fullPage: true });
    await fill(page, { displayName: 'Corrected fixture' }); expect(state.posts).toHaveLength(1); await submit(page).click();
    await expect.poll(() => state.posts.length).toBe(2); await expect(submit(page)).toHaveText('Đang đăng ký…'); await expect(mode(page)).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('status')).toHaveCount(0); await noOverflow(page);
    for (const field of ['displayName', 'email', 'password', 'confirmPassword']) {
      await page.locator(`#register-${field}`).scrollIntoViewIfNeeded(); await expect(page.locator(`#register-${field}`)).toBeInViewport();
    }
    await submit(page).scrollIntoViewIfNeeded(); await expect(submit(page)).toBeInViewport();
    gate.resolve(); await expect(page.getByRole('status')).toHaveText(success); await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`mock-recovered-${width}.png`), fullPage: true });
    await login(page, baseInput.email); await expect(page.locator('#workspace-projects')).toBeVisible(); await noOverflow(page);
    await page.reload(); await expect(page.locator('.app-shell')).toBeVisible(); await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Cloud Handover', exact: true })).toBeVisible(); expect(state.posts).toHaveLength(2);
  } finally { gate.resolve(); }
});
test('R07 mock: a protected API 401 removes the old workspace and returns safely to login', async ({ page }) => {
  let expired = false;
  await mockProject(page, 'OWNER', async route => {
    if (expired) { await route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }); return true; }
    return false;
  });
  expired = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Phiên đăng nhập đã hết.'); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  expect(observations.get(page).requests.filter(request => request.url().endsWith('/auth/register'))).toHaveLength(0);
});
