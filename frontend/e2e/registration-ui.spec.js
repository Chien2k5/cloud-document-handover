import { test, expect } from '@playwright/test';

const observations = new WeakMap();
test.beforeEach(async ({ page }) => {
  const state = { registerRequests: 0, errors: [] }; observations.set(page, state);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/auth/register') state.registerRequests++;
  });
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of 401/.test(message.text())) state.errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(observations.get(page).registerRequests).toBe(0);
  expect(observations.get(page).errors).toEqual([]);
});

async function mockGuest(page, { loginFails = false, loginGate = Promise.resolve() } = {}) {
  const state = { loggedIn: false, calls: [], loginCalls: 0 };
  const user = { id: 'r04-fixture-user', displayName: 'Fixture account', email: 'login@example.test' };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.calls.push({ method: request.method(), path });
    if (path === '/api/v1/auth/register') return route.abort(); // Never fake registration success.
    if (path.endsWith('/auth/me')) return route.fulfill({ status: state.loggedIn ? 200 : 401, json: state.loggedIn ? user : { code: 'UNAUTHENTICATED' } });
    if (path.endsWith('/auth/csrf')) return route.fulfill({ json: { headerName: 'X-Fixture-CSRF', token: state.loggedIn ? 'after' : 'before' } });
    if (path.endsWith('/auth/login')) {
      state.loginCalls++;
      expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
      expect(request.headers()['x-fixture-csrf']).toBe('before');
      await loginGate;
      if (loginFails) return route.fulfill({ status: 401, json: { code: 'INVALID_CREDENTIALS' } });
      state.loggedIn = true; return route.fulfill({ json: user });
    }
    if (path.endsWith('/auth/logout')) {
      expect(request.headers()['x-fixture-csrf']).toBe('after'); state.loggedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/projects')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    throw new Error(`Unexpected R04 fixture API: ${request.method()} ${path}`);
  });
  return state;
}
const submit = page => page.locator('.guest-panel form button[type="submit"]');
const switchMode = page => page.locator('.auth-mode-switch button');
async function openRegister(page) {
  await switchMode(page).click();
  await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible();
}
async function fillRegister(page, { displayName = 'Fixture Name', email = 'registration@example.test', password = '  FixtureR04#Pass  ', confirmPassword = password } = {}) {
  await page.getByLabel('Tên tài khoản', { exact: true }).fill(displayName);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(confirmPassword);
}

// UI-only fixtures: these tests never return a fake successful registration response.
test('R04: defaults to unchanged login and switches within the same Card without navigation or new auth requests', async ({ page }) => {
  await page.addInitScript(() => { window.r04DocumentIdentity = crypto.randomUUID(); });
  const api = await mockGuest(page);
  await page.goto('/?r04=preserve#/handovers');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(1); await expect(page.locator('form input')).toHaveCount(2);
  await expect(page.getByLabel('Tên tài khoản', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveCount(0);
  await expect(switchMode(page)).toHaveText('Đăng ký'); await expect(switchMode(page)).toHaveAttribute('type', 'button');
  const before = await page.evaluate(() => ({ href: location.href, pathname: location.pathname, search: location.search, hash: location.hash, identity: window.r04DocumentIdentity, history: history.length }));
  await page.locator('.guest-panel > .card').evaluate(card => { window.r04CardIdentity = card; });
  await openRegister(page);
  await expect(page.locator('form')).toHaveCount(1); await expect(page.locator('form input')).toHaveCount(4);
  expect(await page.locator('.guest-panel > .card').evaluate(card => card === window.r04CardIdentity)).toBe(true);
  await expect(switchMode(page)).toHaveText('Đăng nhập'); await switchMode(page).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ href: location.href, pathname: location.pathname, search: location.search, hash: location.hash, identity: window.r04DocumentIdentity, history: history.length }))).toEqual(before);
  expect(api.calls).toEqual([{ method: 'GET', path: '/api/v1/auth/me' }]);
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toHaveCount(0);
});

test('R04: login and register states remain separate and all passwords disappear when leaving a mode', async ({ page }) => {
  await mockGuest(page); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('login@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('login-private-fixture');
  await openRegister(page); await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  await fillRegister(page, { password: 'registration-private-fixture' });
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
  expect(await page.locator('body').innerText()).not.toContain('registration-private-fixture');
  expect(await page.evaluate(() => { const copy = document.body.cloneNode(true); copy.querySelectorAll('input[type="password"]').forEach(input => input.remove()); return copy.innerHTML; })).not.toContain('registration-private-fixture');
  await switchMode(page).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('login@example.test');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  await openRegister(page);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('registration@example.test');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Nhập lại mật khẩu', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('R04: required labels, autocomplete, maxlength and accessible validation stay attached to the four inputs', async ({ page }) => {
  await mockGuest(page); await page.goto('/'); await openRegister(page);
  for (const [label, name, type, autoComplete] of [
    ['Tên tài khoản', 'displayName', 'text', 'name'], ['Email', 'email', 'email', 'email'],
    ['Mật khẩu', 'password', 'password', 'new-password'], ['Nhập lại mật khẩu', 'confirmPassword', 'password', 'new-password'],
  ]) {
    const input = page.getByLabel(label, { exact: true });
    await expect(input).toHaveAttribute('name', name); await expect(input).toHaveAttribute('type', type);
    await expect(input).toHaveAttribute('autocomplete', autoComplete); await expect(input).toHaveJSProperty('required', true);
  }
  await expect(page.getByLabel('Tên tài khoản', { exact: true })).toHaveAttribute('maxlength', '100');
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('maxlength', '254');
  await submit(page).click();
  await expect(page.getByLabel('Tên tài khoản', { exact: true })).toBeFocused();
  for (const name of ['displayName', 'email', 'password', 'confirmPassword']) {
    const input = page.locator(`#register-${name}`);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect((await input.getAttribute('aria-describedby')).split(' ')).toContain(`register-${name}-error`);
    await expect(page.locator(`#register-${name}-error`)).toHaveAttribute('role', 'alert');
  }
});

test('R04: maxlength blocks typing past name/email limits without truncating passwords', async ({ page }) => {
  await mockGuest(page); await page.goto('/'); await openRegister(page);
  const name = page.getByLabel('Tên tài khoản', { exact: true }), email = page.getByLabel('Email', { exact: true });
  await name.fill('a'.repeat(100)); await name.press('End'); await name.press('b'); await expect(name).toHaveValue('a'.repeat(100));
  const longEmail = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
  await email.fill(longEmail); await email.press('End'); await email.press('b'); await expect(email).toHaveValue(longEmail);
  const password = 'á'.repeat(36) + 'a'; await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(password);
});

for (const scenario of [
  { name: 'blank name', values: { displayName: '   ' }, field: 'displayName', message: 'Vui lòng nhập tên tài khoản.' },
  { name: 'invalid email', values: { email: 'not-an-email' }, field: 'email', message: 'Email không hợp lệ.' },
  { name: 'short password', values: { password: '1234567' }, field: 'password', message: 'Mật khẩu phải có tối thiểu 8 ký tự.' },
  { name: 'ASCII blank password', values: { password: '        ' }, field: 'password', message: 'Vui lòng nhập mật khẩu.' },
  { name: 'Unicode blank password', values: { password: '\u00a0'.repeat(8) }, field: 'password', message: 'Vui lòng nhập mật khẩu.' },
  { name: 'supplementary character count', values: { password: '😀'.repeat(4) }, field: 'password', message: 'Mật khẩu phải có tối thiểu 8 ký tự.' },
  { name: 'ASCII 73 byte password', values: { password: 'a'.repeat(73) }, field: 'password', message: 'Mật khẩu tối đa 72 byte UTF-8.' },
  { name: 'two byte UTF-8 boundary', values: { password: 'á'.repeat(36) + 'a' }, field: 'password', message: 'Mật khẩu tối đa 72 byte UTF-8.' },
  { name: 'four byte UTF-8 boundary', values: { password: '😀'.repeat(18) + 'a' }, field: 'password', message: 'Mật khẩu tối đa 72 byte UTF-8.' },
  { name: 'exact confirmation', values: { confirmPassword: 'different-fixture' }, field: 'confirmPassword', message: 'Mật khẩu nhập lại không khớp.' },
]) test(`R04: rejects ${scenario.name} locally and never calls registration`, async ({ page }) => {
  await mockGuest(page); await page.goto('/'); await openRegister(page); await fillRegister(page, scenario.values); await submit(page).click();
  await expect(page.locator(`#register-${scenario.field}-error`)).toHaveText(scenario.message);
  await expect(page.locator(`#register-${scenario.field}`)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Chức năng đăng ký chưa kết nối máy chủ.', { exact: true })).toHaveCount(0);
});

for (const [name, password] of [['ASCII minimum', '12345678'], ['ASCII maximum', 'a'.repeat(72)], ['two-byte maximum', 'á'.repeat(36)], ['four-byte maximum', '😀'.repeat(18)], ['unchanged spaces and case', '  MixedFixtureR04  ']]) test(`R04: valid ${name} only shows the honest disconnected notice`, async ({ page }) => {
  const api = await mockGuest(page); await page.goto('/'); await openRegister(page); await fillRegister(page, { password });
  const url = page.url(); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(password); await submit(page).click();
  await expect(page.getByRole('status')).toHaveText('Chức năng đăng ký chưa kết nối máy chủ.');
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Đăng ký', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/đăng ký thành công/i); expect(page.url()).toBe(url);
  expect(api.calls).toEqual([{ method: 'GET', path: '/api/v1/auth/me' }]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('R04: Enter on a valid register form does not navigate or submit a native password query', async ({ page }) => {
  await mockGuest(page); await page.goto('/?fixture=keyboard#/projects'); await openRegister(page); await fillRegister(page);
  const url = page.url(); await page.getByLabel('Nhập lại mật khẩu', { exact: true }).press('Enter');
  await expect(page.getByRole('status')).toHaveText('Chức năng đăng ký chưa kết nối máy chủ.'); expect(page.url()).toBe(url);
});

test('R04: login errors and register validation never cross modes; login success and logout remain unchanged', async ({ page }) => {
  const api = await mockGuest(page, { loginFails: true }); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('login@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-fixture');
  await submit(page).click(); await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng.');
  await openRegister(page); await expect(page.getByRole('alert')).toHaveCount(0); await submit(page).click();
  await expect(page.locator('#register-displayName-error')).toBeVisible(); await switchMode(page).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  expect(api.loginCalls).toBe(1);
});

test('R04: returning from register uses the original login and logout protocol', async ({ page }) => {
  const api = await mockGuest(page); await page.goto('/'); await openRegister(page); await fillRegister(page); await switchMode(page).click();
  await page.getByLabel('Email', { exact: true }).fill('login@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('LoginFixtureR04!');
  await submit(page).click(); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible(); await expect(page.locator('.guest-panel')).toHaveCount(0); expect(api.loginCalls).toBe(1);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
});

test('R04: an in-flight login cannot switch mode or double-submit', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const api = await mockGuest(page, { loginGate: gate });
  try {
    await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill('login@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('LoginFixtureR04!');
    await submit(page).click(); await expect(submit(page)).toBeDisabled(); await expect(switchMode(page)).toBeDisabled();
    await switchMode(page).evaluate(button => button.click()); await submit(page).evaluate(button => button.click());
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(page.getByLabel('Tên tài khoản', { exact: true })).toHaveCount(0);
    await expect.poll(() => api.loginCalls).toBe(1); release(); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
  } finally { release(); }
});

test('R04: switching and all four fields work with keyboard focus indicators', async ({ page }) => {
  await mockGuest(page); await page.goto('/'); await switchMode(page).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Tên tài khoản', { exact: true })).toBeFocused();
  for (const name of ['Email', 'Mật khẩu', 'Nhập lại mật khẩu']) { await page.keyboard.press('Tab'); await expect(page.getByLabel(name, { exact: true })).toBeFocused(); }
  await page.keyboard.press('Tab'); await expect(submit(page)).toBeFocused(); await page.keyboard.press('Tab'); await expect(switchMode(page)).toBeFocused();
  const indicator = await switchMode(page).evaluate(button => ({ style: getComputedStyle(button).outlineStyle, width: parseFloat(getComputedStyle(button).outlineWidth) }));
  expect(indicator.style).not.toBe('none'); expect(indicator.width).toBeGreaterThan(0);
  await page.keyboard.press('Space'); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
});

for (const width of [375, 768, 1440]) test(`R04: the existing auth Card remains responsive at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  await mockGuest(page); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  const dimensions = () => page.locator('.guest-panel > .card').evaluate(card => { const style = getComputedStyle(card); return { width: card.getBoundingClientRect().width, background: style.backgroundColor, radius: style.borderRadius, shadow: style.boxShadow }; });
  const before = await dimensions();
  await page.screenshot({ path: testInfo.outputPath(`mock-login-${width}.png`), fullPage: true });
  await openRegister(page); expect(await dimensions()).toEqual(before);
  await expect(page.locator('.guest-brand .brand-mark')).toHaveText('CH'); await expect(page.getByRole('heading', { name: 'Cloud Handover', exact: true })).toBeVisible();
  for (const label of ['Tên tài khoản', 'Email', 'Mật khẩu', 'Nhập lại mật khẩu']) {
    const input = page.getByLabel(label, { exact: true }); await input.scrollIntoViewIfNeeded(); await expect(input).toBeInViewport();
    const box = await input.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await submit(page).scrollIntoViewIfNeeded(); await expect(submit(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`mock-register-${width}.png`), fullPage: true });
});
