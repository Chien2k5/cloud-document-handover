import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// API fixtures only; favicon bytes are always served by the actual Vite server.
const alice = { id: 'a1000000-0000-4000-8000-000000000001', displayName: 'Alice fixture', email: 'alice@example.test' };
const bob = { id: 'b2000000-0000-4000-8000-000000000002', displayName: 'Bob fixture', email: 'bob@example.test' };
const projectId = 'c3000000-0000-4000-8000-000000000003';
const secret = 'FixtureProfileOnly#123';
const profileButton = page => page.getByRole('button', { name: 'Thông tin tài khoản', exact: true });
const profile = page => page.getByRole('region', { name: 'Thông tin tài khoản', exact: true });
const uuid = page => page.getByLabel('UUID tài khoản', { exact: true });
const copy = page => page.getByRole('button', { name: 'Sao chép UUID', exact: true });
const audit = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; audit.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/status of 401/.test(message.text())) errors.push(message.text()); });
  page.on('response', response => { if (new URL(response.url()).pathname === '/favicon.ico') expect(response.status()).toBe(200); });
});
test.afterEach(async ({ page }) => { expect(audit.get(page)).toEqual([]); });

async function fixture(page, { guest = false, role = 'OWNER', user = alice } = {}) {
  const state = { current: guest ? null : user, calls: [], registrations: 0 };
  const project = { id: projectId, name: 'Profile project', description: 'Fixture', role, usedBytes: 0, reservedBytes: 0, quotaBytes: 1000000 };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.calls.push({ method: request.method(), path });
    if (path.endsWith('/auth/csrf')) return route.fulfill({ json: { headerName: 'X-Profile-CSRF', token: 'fixture-masked' } });
    if (path.endsWith('/auth/me')) return route.fulfill({ status: state.current ? 200 : 401, json: state.current || { code: 'UNAUTHENTICATED' } });
    if (path.endsWith('/auth/login')) {
      expect(request.headers()['x-profile-csrf']).toBe('fixture-masked');
      expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
      const input = new URLSearchParams(request.postData()); expect(input.get('password')).toBe(secret);
      state.current = input.get('email') === bob.email ? bob : user; return route.fulfill({ json: state.current });
    }
    if (path.endsWith('/auth/logout')) {
      expect(request.headers()['x-profile-csrf']).toBe('fixture-masked'); expect(request.postData()).toBe(null);
      state.current = null; return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/auth/register')) {
      state.registrations++; expect(request.method()).toBe('POST'); expect(request.headers()['x-profile-csrf']).toBe('fixture-masked');
      const input = request.postDataJSON(); expect(Object.keys(input).sort()).toEqual(['confirmPassword', 'displayName', 'email', 'password']);
      expect(input.email).toBe(bob.email); expect(input.password).toBe(secret); expect(input.confirmPassword).toBe(secret);
      return route.fulfill({ status: 201, json: bob });
    }
    if (!state.current) return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
    if (path === '/api/v1/projects') return route.fulfill({ json: { items: state.current.id === bob.id ? [] : [project], page: 0, size: 20 } });
    if (path === `/api/v1/projects/${projectId}`) return route.fulfill({ json: project });
    if (path.endsWith('/files')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    if (path.endsWith('/members')) return route.fulfill({ json: [{ userId: user.id, displayName: user.displayName, role }] });
    throw new Error(`Unexpected profile fixture API: ${request.method()} ${path}`);
  });
  await page.goto('/?profile=fixture#/projects');
  if (guest) await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  else await expect(page.getByRole('button', { name: project.name + ' · ' + role, exact: true })).toBeVisible();
  return state;
}
async function open(page) { await profileButton(page).click(); await expect(profile(page)).toBeVisible(); }
async function login(page, user = alice) {
  await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Mật khẩu', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(profileButton(page)).toBeVisible();
}
async function clipboard(page, mode = 'success') {
  await page.addInitScript(mode => {
    window.profileCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
      writeText: value => {
        window.profileCopies.push(value);
        if (mode === 'failure') return Promise.reject(new DOMException('Fixture denial', 'NotAllowedError'));
        if (mode === 'pending') return new Promise(resolve => { window.finishProfileCopy = resolve; });
        return Promise.resolve();
      },
    } });
  }, mode);
}
async function favicon(page) {
  const link = page.locator('head link[rel="icon"]'); await expect(link).toHaveAttribute('href', '/favicon.ico'); await expect(link).toHaveAttribute('type', 'image/x-icon');
  const response = await page.request.get('/favicon.ico'); expect(response.status()).toBe(200);
  const bytes = await response.body(); expect(bytes).toEqual(readFileSync(new URL('../public/favicon.ico', import.meta.url)));
  expect(bytes.readUInt16LE(0)).toBe(0); expect(bytes.readUInt16LE(2)).toBe(1); expect(bytes.readUInt16LE(4)).toBe(7);
  const sizes = [];
  for (let i = 0; i < 7; i++) {
    const entry = 6 + i * 16, length = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
    const width = bytes[entry] || 256, height = bytes[entry + 1] || 256; expect(height).toBe(width); sizes.push(width);
    expect(offset).toBeGreaterThanOrEqual(118); expect(length).toBeGreaterThan(0); expect(offset + length).toBeLessThanOrEqual(bytes.length);
    expect(bytes.subarray(offset, offset + 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  }
  expect(sizes.sort((a,b) => a-b)).toEqual([16,24,32,48,64,128,256]);
}

test('FIX01 F01-F06/P01: real favicon bytes on guest Login and Register; no profile or mutation', async ({ page }) => {
  const state = await fixture(page, { guest: true }); await favicon(page);
  await expect(profileButton(page)).toHaveCount(0); await expect(uuid(page)).toHaveCount(0); await expect(copy(page)).toHaveCount(0);
  await page.locator('.auth-mode-switch button').click(); await expect(page.locator('form input')).toHaveCount(4); await favicon(page);
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
});
test('FIX01 F07/P02-P08/P12-P13: profile shows exact auth User fields and stable UUID, never Project ID or extra API', async ({ page }) => {
  const state = await fixture(page); const calls = [...state.calls], url = page.url(); await favicon(page);
  await open(page); await expect(profile(page)).toContainText(alice.displayName); await expect(profile(page)).toContainText(alice.email);
  await expect(uuid(page)).toHaveValue(alice.id); await expect(uuid(page)).not.toHaveValue(projectId); await expect(uuid(page)).toHaveJSProperty('readOnly', true);
  await profileButton(page).click(); await expect(profile(page)).toHaveCount(0); await open(page); await expect(uuid(page)).toHaveValue(alice.id);
  expect(state.calls).toEqual(calls); expect(page.url()).toBe(url); await expect(profileButton(page)).toHaveAttribute('type', 'button'); await expect(copy(page)).toHaveAttribute('type', 'button');
});
test('FIX01 P09: session reload preserves backend User UUID, panel state is closed', async ({ page }) => {
  await fixture(page); await open(page); await expect(uuid(page)).toHaveValue(alice.id); await page.reload();
  await expect(profileButton(page)).toBeVisible(); await expect(profile(page)).toHaveCount(0); await open(page); await expect(uuid(page)).toHaveValue(alice.id);
});
test('FIX01 C01-C06/C09-C10: clipboard success receives only unchanged user.id, no storage/API/navigation', async ({ page }) => {
  await clipboard(page); const state = await fixture(page); await open(page); const url = page.url(), calls = [...state.calls];
  await page.evaluate(() => { window.profileDocument = document; }); await copy(page).click(); await expect(profile(page).getByRole('status')).toHaveText('Đã sao chép UUID.');
  expect(await page.evaluate(() => window.profileCopies)).toEqual([alice.id]); expect(state.calls).toEqual(calls); expect(page.url()).toBe(url);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0,0]); expect(await page.evaluate(() => document === window.profileDocument)).toBe(true);
});
for (const mode of ['failure', 'missing']) test(`FIX01 C07-C08: clipboard ${mode} gives honest fallback and selectable exact UUID`, async ({ page }) => {
  await clipboard(page, mode); await fixture(page); await open(page); await copy(page).click();
  await expect(profile(page).getByRole('alert')).toHaveText('Không thể sao chép tự động. Vui lòng chọn UUID và sao chép thủ công.');
  await expect(profile(page).getByRole('status')).toHaveCount(0); await expect(uuid(page)).toHaveValue(alice.id); await uuid(page).focus();
  expect(await uuid(page).evaluate(input => [input.selectionStart,input.selectionEnd,input.readOnly])).toEqual([0,alice.id.length,true]);
});
test('FIX01: pending copy cannot double-submit or announce early; closing ignores late completion', async ({ page }) => {
  await clipboard(page, 'pending'); await fixture(page); await open(page); await copy(page).click();
  const pending = page.getByRole('button', { name: 'Đang sao chép…', exact: true }); await expect(pending).toBeDisabled(); await pending.evaluate(button => button.click());
  expect(await page.evaluate(() => window.profileCopies)).toEqual([alice.id]); await expect(profile(page).getByRole('status')).toHaveCount(0);
  await profileButton(page).click(); await open(page); await page.evaluate(() => window.finishProfileCopy());
  await expect(copy(page)).toBeEnabled(); await expect(profile(page).getByRole('status')).toHaveCount(0);
});
test('FIX01 keyboard: Enter/Tab/Escape, visible focus, manual selection and no keyboard trap', async ({ page }) => {
  await fixture(page); await profileButton(page).focus(); await page.keyboard.press('Enter'); await expect(profile(page)).toBeVisible();
  await page.keyboard.press('Tab'); await expect(uuid(page)).toBeFocused(); await page.keyboard.press('Tab'); await expect(copy(page)).toBeFocused();
  const ring = await copy(page).evaluate(button => ({ width: parseFloat(getComputedStyle(button).outlineWidth), style: getComputedStyle(button).outlineStyle })); expect(ring.width).toBeGreaterThan(0); expect(ring.style).not.toBe('none');
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeFocused();
  await profileButton(page).focus(); await page.keyboard.press('Escape'); await expect(profile(page)).toHaveCount(0); await expect(profileButton(page)).toBeFocused();
});
test('FIX01 P10-P11/R06-R07: logout hides old identity and next login shows new backend UUID', async ({ page }) => {
  await fixture(page); await open(page); await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(profileButton(page)).toHaveCount(0); await expect(uuid(page)).toHaveCount(0); await expect(page.locator('body')).not.toContainText(alice.id);
  await login(page, bob); await expect(profile(page)).toHaveCount(0); await open(page); await expect(uuid(page)).toHaveValue(bob.id);
  await expect(profile(page)).toContainText(bob.displayName); await expect(profile(page)).toContainText(bob.email); await expect(page.locator('body')).not.toContainText(alice.id);
});
test('FIX01: old clipboard completion cannot leak status/UUID into another account', async ({ page }) => {
  await clipboard(page, 'pending'); await fixture(page); await open(page); await copy(page).click();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await login(page, bob); await open(page);
  await page.evaluate(() => window.finishProfileCopy()); await expect(uuid(page)).toHaveValue(bob.id); await expect(profile(page).getByRole('status')).toHaveCount(0);
});
test('FIX01: expired backend session removes profile on reload', async ({ page }) => {
  const state = await fixture(page); await open(page); state.current = null; await page.reload();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible(); await expect(profileButton(page)).toHaveCount(0); await expect(page.locator('body')).not.toContainText(alice.id);
});
for (const role of ['OWNER','EDITOR','VIEWER']) test(`FIX01: ${role} sees own UUID and project navigation still works`, async ({ page }) => {
  await fixture(page, { role }); await open(page); await expect(uuid(page)).toHaveValue(alice.id); await profileButton(page).click();
  await page.getByRole('button', { name: 'Profile project · ' + role, exact: true }).click(); await expect(page.locator('#project-overview')).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Điều hướng workspace', exact: true }); await navigation.getByRole('link', { name: 'Dự án', exact: true }).click(); await expect(page.locator('#workspace-projects')).toBeVisible();
});
for (const [width,height] of [[375,812],[768,1024],[1440,1000]]) test(`FIX01 R01-R05/R09-R10: profile/header/navigation at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width,height }); await fixture(page, { user: { ...alice, displayName: 'Tên tài khoản rất dài '.repeat(4), email: 'long-account-name-for-profile-layout@example.test' } });
  await open(page); await expect(uuid(page)).toHaveValue(alice.id); await copy(page).scrollIntoViewIfNeeded(); await expect(copy(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await profile(page).boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  await expect(page.locator('.app-header .brand-mark')).toHaveText('CH'); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`profile-${width}.png`), fullPage: true }); await profileButton(page).click();
  if (width <= 900) { const toggle = page.getByRole('button', { name: 'Mở điều hướng', exact: true }); await expect(toggle).toBeInViewport(); await toggle.click(); }
  await page.getByRole('navigation', { name: 'Điều hướng workspace', exact: true }).getByRole('link', { name: 'Mở gói bàn giao', exact: true }).click(); await expect(page.locator('#workspace-handovers')).toBeVisible();
});
test('FIX01 R08: registration still confirms201 without login; explicit login shows the returned account ID', async ({ page }) => {
  const state = await fixture(page, { guest: true }); await page.locator('.auth-mode-switch button').click();
  for (const [label,value] of [['Tên tài khoản',bob.displayName],['Email',bob.email],['Mật khẩu',secret],['Nhập lại mật khẩu',secret]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.');
  expect(state.registrations).toBe(1); expect(state.current).toBe(null); await expect(profileButton(page)).toHaveCount(0);
  await login(page,bob); await open(page); await expect(uuid(page)).toHaveValue(bob.id); await favicon(page);
});
