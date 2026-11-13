import { test, expect } from '@playwright/test';
import { workspaceView } from './fixtures.js';
import { file, projectId, recipientId, handoverId, manifest, setupHandover, openHandover } from './handover-fixture.js';
const labels = { publish: 'Phát hành gói', confirm: 'Xác nhận nhận bàn giao', revoke: 'Thu hồi gói' };
const view = page => page.locator('.handover');
const button = (page, kind) => view(page).getByRole('button', { name: labels[kind], exact: true });
const input = kind => ({ role: kind === 'confirm' ? 'VIEWER' : 'OWNER', userId: kind === 'confirm' ? recipientId : projectId, value: manifest({ status: kind === 'publish' ? 'DRAFT' : kind === 'revoke' ? 'CONFIRMED' : 'READY', recipients: [{ userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: kind === 'revoke' ? '2030-01-01T00:00:00Z' : null }, { userId: projectId, accessStatus: 'ACTIVE', confirmedAt: kind === 'revoke' ? '2030-01-01T00:00:00Z' : null }] }) });

for (const kind of ['publish', 'confirm', 'revoke']) test(`C09.08C: ${kind} posts exact bodyless CSRF request and reads authoritative aggregate state`, async ({ page }) => {
  const posts = [], { current, calls } = await setupHandover(page, { ...input(kind), extra: async (route, data) => {
    const request = route.request(), path = new URL(request.url()).pathname; if (request.method() !== 'POST') return false;
    expect(path).toBe(`/api/v1/handovers/${handoverId}/${kind}`); expect(request.postData()).toBeNull(); expect(request.headers()['x-csrf']).toBe('fixture'); posts.push(path);
    if (kind === 'publish') data.value = { ...data.value, status: 'READY' };
    if (kind === 'revoke') data.value = { ...data.value, accessStatus: 'REVOKED' };
    if (kind === 'confirm') data.value = { ...data.value, recipients: data.value.recipients.map(person => person.userId === recipientId ? { ...person, confirmedAt: '2030-01-01T00:00:00Z' } : person) };
    await route.fulfill({ json: kind === 'confirm' ? { handoverId, userId: recipientId, status: 'CONFIRMED', confirmedAt: '2030-01-01T00:00:00Z' } : data.value }); return true;
  } });
  await openHandover(page); await button(page, kind).click(); await expect.poll(() => calls.length).toBe(2); const states = view(page).locator('.handover-states');
  await expect(states.getByText(current.value.status, { exact: true })).toBeVisible(); expect(posts).toHaveLength(1);
  if (kind === 'confirm') { await expect(button(page, kind)).toHaveCount(0); await expect(states.getByText('READY', { exact: true })).toBeVisible(); current.value = { ...current.value, status: 'CONFIRMED', recipients: current.value.recipients.map(person => ({ ...person, confirmedAt: '2030-01-01T00:01:00Z' })) }; await view(page).getByRole('button', { name: 'Tải lại gói', exact: true }).click(); await expect(states.getByText('CONFIRMED', { exact: true })).toBeVisible(); expect(posts).toHaveLength(1); }
  if (kind === 'revoke') { await expect(states.getByText('REVOKED', { exact: true })).toBeVisible(); expect(current.value.recipients.every(person => person.confirmedAt === '2030-01-01T00:00:00Z')).toBe(true); await expect(view(page).getByRole('button', { name: 'Lấy link tải item ' + file.filename, exact: true })).toBeDisabled(); }
});

for (const role of ['EDITOR', 'VIEWER']) test(`C09.08C: ${role} cannot publish/revoke and unassigned actor cannot confirm`, async ({ page }) => {
  await setupHandover(page, { role }); await openHandover(page); for (const kind of Object.keys(labels)) await expect(button(page, kind)).toHaveCount(0);
});

for (const kind of ['publish', 'confirm', 'revoke']) for (const failure of [401, 403, 404, 409, 503, 'network', 'timeout']) test(`C09.08C: ${kind} ${failure} preserves failure, never blindly repeats mutation and permits explicit state refresh`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install(); let posts = 0;
  const { calls } = await setupHandover(page, { ...input(kind), extra: async route => {
    if (route.request().method() !== 'POST') return false; posts++; expect(new URL(route.request().url()).pathname).toBe(`/api/v1/handovers/${handoverId}/${kind}`); expect(route.request().postData()).toBeNull(); expect(route.request().headers()['x-csrf']).toBe('fixture');
    if (failure === 'timeout') await new Promise(() => {}); else if (failure === 'network') await route.abort('failed'); else await route.fulfill({ status: failure, json: { code: failure === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR', requestId: 'handover-action-fixture' } }); return true;
  } });
  await openHandover(page); await button(page, kind).click(); await expect.poll(() => posts).toBe(1); if (failure === 'timeout') await page.clock.fastForward(21000); await expect(page.getByRole('alert')).toBeVisible(); expect(posts).toBe(1);
  if ([401, 403, 404].includes(failure)) { await expect(view(page).locator('.handover-item')).toHaveCount(0); await expect(view(page).locator('.handover-actions button')).toHaveCount(0); }
  else {
    await expect(view(page).locator('.handover-item')).toHaveCount(1); if (failure === 'network' || failure === 'timeout') await expect(view(page)).toContainText('không tự gửi lại thao tác');
    await view(page).getByRole('button', { name: 'Tải lại gói', exact: true }).click(); await expect.poll(() => calls.length).toBe(2); await expect(view(page).getByRole('alert')).toHaveCount(0); expect(posts).toBe(1);
  }
});

test('C09.08C: expiry is checked at activation even before the one-second display clock updates', async ({ page }) => {
  const now = Date.parse('2030-01-01T00:00:00Z'); await page.clock.install({ time: now }); await page.clock.pauseAt(now + 1000); let posts = 0;
  await setupHandover(page, { value: manifest({ expiresAt: new Date(now + 5000).toISOString() }), extra: async route => { if (route.request().method() === 'POST') posts++; return false; } }); await openHandover(page); await expect(button(page, 'publish')).toBeEnabled(); await page.clock.setSystemTime(now + 6000); await button(page, 'publish').click();
  await expect(button(page, 'publish')).toHaveCount(0); await expect(view(page).locator('.handover-states')).toContainText('Expired — đã hết hạn'); expect(posts).toBe(0);
});

test('C09.08C: one pending mutation survives same-package navigation, blocks duplicates and reads server state on completion', async ({ page }) => {
  let release, posts = 0; const pending = new Promise(resolve => { release = resolve; });
  try {
    await setupHandover(page, { extra: async (route, current) => { if (route.request().method() !== 'POST') return false; posts++; await pending; current.value = { ...current.value, status: 'READY' }; await route.fulfill({ json: current.value }); return true; } });
    await openHandover(page); await button(page, 'publish').click(); await expect.poll(() => posts).toBe(1); await expect(view(page).getByRole('status')).toContainText('Đang phát hành gói'); await button(page, 'publish').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); expect(posts).toBe(1);
    await workspaceView(page, 'Dự án'); await workspaceView(page, 'Mở gói bàn giao'); await expect(button(page, 'publish')).toBeDisabled(); release(); await expect(view(page).locator('.handover-states').getByText('READY', { exact: true })).toBeVisible(); expect(posts).toBe(1);
  } finally { release(); }
});

for (const exit of ['package', 'logout']) test(`C09.08C: ${exit} switch aborts old mutation and ignores a late manifest`, async ({ page }) => {
  let release, returned, posts = 0; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { returned = resolve; }); const nextId = '80000000-0000-0000-0000-000000000008';
  try {
    await setupHandover(page, { extra: async (route, current) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/auth/logout')) { await route.fulfill({ status: 204 }); return true; }
      if (p.endsWith('/publish')) { posts++; await pending; await route.fulfill({ json: { ...current.value, title: 'Late package A', status: 'READY' } }); returned(); return true; }
      if (p.endsWith('/handovers/' + nextId)) { await route.fulfill({ json: manifest({ id: nextId, title: 'Package B', status: 'READY' }) }); return true; } return false;
    } });
    await openHandover(page); await button(page, 'publish').click(); await expect.poll(() => posts).toBe(1);
    if (exit === 'logout') await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); else { await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(nextId); await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click(); await expect(view(page).getByRole('heading', { name: 'Package B', exact: true })).toBeVisible(); }
    release(); await done; await expect(page.getByRole('heading', { name: 'Late package A', exact: true })).toHaveCount(0); if (exit === 'logout') { await expect(view(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible(); } else await expect(view(page).getByRole('heading', { name: 'Package B', exact: true })).toBeVisible();
    expect(posts).toBe(1); expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { release(); }
});
