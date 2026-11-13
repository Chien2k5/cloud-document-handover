import { test, expect } from '@playwright/test';
import { file, recipientId, handoverId, manifest, setupHandover, openHandover } from './handover-fixture.js';
const view = page => page.locator('.handover');
const requestLink = page => view(page).getByRole('button', { name: 'Lấy link tải item ' + file.filename, exact: true });
const link = page => view(page).getByRole('link', { name: 'Tải item đúng phiên bản', exact: true });
const valid = (expiresAt = '2099-01-01T00:00:00Z') => ({ url: `https://s3.example.test/item?versionId=${encodeURIComponent(file.versionId)}`, versionId: file.versionId, expiresAt });
async function freeze(page) { const now = Date.parse('2030-01-01T00:00:00Z'); await page.clock.install({ time: now }); await page.clock.pauseAt(now + 1000); return now + 1000; }
async function setup(page, { respond, value = manifest({ status: 'READY' }), extra = async () => false, ...options } = {}) {
  const calls = [];
  await setupHandover(page, { ...options, value, extra: async (route, current, project, user) => {
    if (await extra(route, current, project, user)) return true;
    const r = route.request(), path = new URL(r.url()).pathname;
    if (path.endsWith('/download')) { expect(path).toBe(`/api/v1/handovers/${handoverId}/items/${file.id}/download`); expect(r.method()).toBe('GET'); expect(r.postData()).toBeNull(); calls.push(path); if (respond) await respond(route); else await route.fulfill({ json: valid() }); return true; } return false;
  } });
  await openHandover(page); return calls;
}

test('C09.08D: manifest v1 remains exact when project has v2; response URL/version and link semantics match v1', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const calls = await setup(page, { items: [{ ...file, id: '20000000-0000-0000-0000-000000000099', versionId: 'latest-v2' }] });
  await requestLink(page).focus(); await page.keyboard.press('Enter'); await expect(link(page)).toHaveAttribute('href', valid().url); await expect(link(page)).toHaveAttribute('target', '_blank'); await expect(link(page)).toHaveAttribute('rel', 'noopener noreferrer'); expect(calls).toEqual([`/api/v1/handovers/${handoverId}/items/${file.id}/download`]); expect(errors).toEqual([]);
});

for (const invalid of ['wrong-version', 'http', 'javascript', 'credentials', 'malformed', 'expired', 'missing-expiry']) test(`C09.08D: ${invalid} response never exposes a usable item URL`, async ({ page }) => {
  const response = valid();
  if (invalid === 'wrong-version') response.versionId = 'new-v2';
  if (invalid === 'http') response.url = 'http://s3.example.test/item';
  if (invalid === 'javascript') response.url = 'javascript:alert(1)';
  if (invalid === 'credentials') response.url = 'https://user:password@s3.example.test/item';
  if (invalid === 'malformed') response.url = 'not-a-url';
  if (invalid === 'expired') response.expiresAt = '2000-01-01T00:00:00Z';
  if (invalid === 'missing-expiry') delete response.expiresAt;
  const calls = await setup(page, { respond: route => route.fulfill({ json: response }) }); await requestLink(page).click(); await expect(view(page).getByRole('alert')).toBeVisible(); await expect(link(page)).toHaveCount(0); expect(calls).toHaveLength(1);
});

test('C09.08D: displayed URL expires, including hidden navigation, and a new authorized URL may be requested', async ({ page }) => {
  const now = await freeze(page); let deadline = now + 5000;
  const calls = await setup(page, { value: manifest({ status: 'READY', expiresAt: new Date(now + 60000).toISOString() }), respond: route => route.fulfill({ json: valid(new Date(deadline).toISOString()) }) });
  await requestLink(page).click(); await expect(link(page)).toBeVisible(); await page.getByRole('navigation', { name: 'Điều hướng workspace', exact: true }).getByRole('link', { name: 'Dự án', exact: true }).click(); await page.clock.fastForward(6000); await page.goBack(); await expect(link(page)).toHaveCount(0); await expect(view(page).getByRole('status')).toContainText('Lấy link tải mới');
  deadline = now + 16000; await requestLink(page).click(); await expect(link(page)).toHaveAttribute('href', valid().url); expect(calls).toHaveLength(2);
});

for (const bound of ['url', 'package']) test(`C09.08D: ${bound} expiry is rechecked at activation before delayed timers can open the URL`, async ({ page }) => {
  const now = await freeze(page); let popups = 0; page.on('popup', () => popups++);
  await setup(page, { value: manifest({ status: 'READY', expiresAt: new Date(now + (bound === 'package' ? 5000 : 60000)).toISOString() }), respond: route => route.fulfill({ json: valid(new Date(now + (bound === 'url' ? 5000 : 60000)).toISOString()) }) });
  await requestLink(page).click(); await expect(link(page)).toBeVisible(); await page.clock.setSystemTime(now + 6000); await link(page).focus(); await page.keyboard.press('Enter'); await expect(link(page)).toHaveCount(0); expect(popups).toBe(0);
});

for (const changes of [{ status: 'DRAFT' }, { accessStatus: 'REVOKED' }, { expiresAt: '2000-01-01T00:00:00Z' }]) test(`C09.08D: ${JSON.stringify(changes)} never requests an item URL`, async ({ page }) => {
  const calls = await setup(page, { value: manifest({ status: 'READY', ...changes }) }); await expect(requestLink(page)).toBeDisabled(); await requestLink(page).evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await expect(link(page)).toHaveCount(0); expect(calls).toHaveLength(0);
});

test('C09.08D: revoke clears an existing item URL and never provides a new URL, preserving confirmation history', async ({ page }) => {
  const calls = await setup(page, { value: manifest({ status: 'CONFIRMED', recipients: [{ userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: '2030-01-01T00:00:00Z' }] }), extra: async (route, current) => {
    if (!new URL(route.request().url()).pathname.endsWith('/revoke')) return false; current.value = { ...current.value, accessStatus: 'REVOKED' }; await route.fulfill({ json: current.value }); return true;
  } });
  await requestLink(page).click(); await expect(link(page)).toBeVisible(); await view(page).getByRole('button', { name: 'Thu hồi gói', exact: true }).click(); await expect(view(page).locator('.handover-states').getByText('REVOKED', { exact: true })).toBeVisible(); await expect(view(page).locator('.handover-states').getByText('CONFIRMED', { exact: true })).toBeVisible(); await expect(view(page).locator('.handover-recipients')).toContainText('Đã xác nhận'); await expect(link(page)).toHaveCount(0); await expect(requestLink(page)).toBeDisabled(); expect(calls).toHaveLength(1);
});

for (const failure of [401, 403, 404, 409, 503]) test(`C09.08D: download ${failure} does not retain a stale URL or report success`, async ({ page }) => {
  let denied = false;
  const calls = await setup(page, { respond: route => route.fulfill(denied ? { status: failure, json: { code: failure === 401 ? 'UNAUTHENTICATED' : failure === 409 ? 'HANDOVER_REVOKED' : 'HTTP_ERROR' } } : { json: valid() }) });
  await requestLink(page).click(); await expect(link(page)).toBeVisible(); denied = true; await requestLink(page).click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('link', { name: 'Tải item đúng phiên bản', exact: true })).toHaveCount(0); expect(calls).toHaveLength(2);
  if ([401, 403, 404, 409].includes(failure)) await expect(view(page).locator('.handover-item')).toHaveCount(0);
});

for (const exit of ['package', 'account']) test(`C09.08D: ${exit} change removes old item URL and protected manifest`, async ({ page }) => {
  let otherAccount = false; const nextId = '80000000-0000-0000-0000-000000000008';
  await setup(page, { extra: async (route, _current, _project, user) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/auth/logout')) { await route.fulfill({ status: 204 }); return true; }
    if (p.endsWith('/auth/login')) { otherAccount = true; await route.fulfill({ json: {} }); return true; }
    if (otherAccount) {
      user.id = '90000000-0000-0000-0000-000000000009'; user.displayName = 'Account B fixture';
      if (p.endsWith('/projects')) { await route.fulfill({ json: { items: [], page: 0, size: 20 } }); return true; }
      if (p.includes('/handovers/')) { await route.fulfill({ status: 404, json: { code: 'HANDOVER_NOT_FOUND' } }); return true; }
    }
    if (p.endsWith('/handovers/' + nextId)) { await route.fulfill({ json: manifest({ id: nextId, title: 'Package B', status: 'READY' }) }); return true; } return false;
  } });
  await requestLink(page).click(); await expect(link(page)).toBeVisible();
  if (exit === 'package') { await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(nextId); await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click(); await expect(view(page).getByRole('heading', { name: 'Package B', exact: true })).toBeVisible(); }
  else { await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await expect(view(page)).toHaveCount(0); await page.getByLabel('Email', { exact: true }).fill('other@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page.getByText('Account B fixture', { exact: true })).toBeVisible(); await expect(view(page).getByRole('alert')).toContainText('không phải người được cấp quyền'); await expect(view(page).locator('.handover-item')).toHaveCount(0); }
  await expect(page.getByRole('link', { name: 'Tải item đúng phiên bản', exact: true })).toHaveCount(0); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
