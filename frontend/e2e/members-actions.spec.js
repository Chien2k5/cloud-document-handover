import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const owner = '10000000-0000-0000-0000-000000000001', editor = '20000000-0000-0000-0000-000000000002', viewer = '30000000-0000-0000-0000-000000000003';
const fresh = 'abcdefab-cdef-abcd-abcd-abcdefabcdef';
const initial = [{ userId: owner, displayName: 'Owner fixture', role: 'OWNER' }, { userId: editor, displayName: 'Editor fixture', role: 'EDITOR' }, { userId: viewer, displayName: 'Viewer fixture', role: 'VIEWER' }];
const section = page => page.locator('#project-members');
const input = page => page.getByLabel('UUID thành viên', { exact: true });
async function setup(page, { role = 'OWNER', mutation, extra } = {}) {
  let people = structuredClone(initial), reads = 0; const writes = [];
  await mockProject(page, role, async (route, project, user) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (extra && await extra(route, project, user)) return true;
    if (path.includes('/members/') && request.method() !== 'GET') {
      expect(['PUT', 'DELETE']).toContain(request.method()); expect(request.headers()['x-csrf']).toBe('fixture');
      const target = decodeURIComponent(path.split('/').at(-1));
      const body = request.postDataJSON(); writes.push({ method: request.method(), path, body });
      if (request.method() === 'PUT') expect(Object.keys(body)).toEqual(['role']); else expect(request.postData()).toBeNull();
      if (mutation) { await mutation(route); return true; }
      if (request.method() === 'DELETE') { people = people.filter(person => person.userId.toLowerCase() !== target.toLowerCase()); await route.fulfill({ status: 204 }); }
      else {
        const member = people.find(person => person.userId.toLowerCase() === target.toLowerCase());
        if (member) member.role = body.role; else people.push({ userId: target.toLowerCase(), displayName: 'New member fixture', role: body.role });
        await route.fulfill({ json: people.find(person => person.userId.toLowerCase() === target.toLowerCase()) });
      }
      return true;
    }
    if (path.endsWith('/members')) { reads++; await route.fulfill({ json: people }); return true; } return false;
  });
  await workspaceView(page, 'Thành viên'); return { writes, reads: () => reads };
}

for (const [value, role] of [[fresh, 'VIEWER'], [fresh.toUpperCase(), 'EDITOR'], ['  ' + fresh + '  ', 'EDITOR']]) test(`C09.05: valid UUID ${JSON.stringify(value)} adds ${role} with exact PUT and CSRF`, async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const { writes, reads } = await setup(page); await input(page).fill(value); expect(await input(page).evaluate(element => element.checkValidity())).toBe(true);
  await page.getByLabel('Vai trò thành viên', { exact: true }).selectOption(role); await page.getByRole('button', { name: 'Lưu thành viên', exact: true }).click();
  await expect(input(page)).toHaveValue(''); await expect(section(page).getByText('New member fixture', { exact: true })).toBeVisible();
  expect(writes).toEqual([{ method: 'PUT', path: `/api/v1/projects/${owner}/members/${value.trim()}`, body: { role } }]); expect(reads()).toBe(2); expect(errors).toEqual([]);
});

for (const value of ['', '   ', 'not-a-uuid', fresh.slice(0, -1), 'z' + fresh.slice(1), fresh.replace('-', ''), fresh.replace('-', '--')]) test(`C09.05: malformed UUID ${JSON.stringify(value)} never sends a request or regex console error`, async ({ page }) => {
  const errors = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const { writes } = await setup(page); await input(page).fill(value);
  await expect(page.getByRole('button', { name: 'Lưu thành viên', exact: true })).toBeDisabled(); expect(await input(page).evaluate(element => element.checkValidity())).toBe(false);
  await page.locator('.member-form-panel form').evaluate(form => form.requestSubmit()); expect(writes).toHaveLength(0); expect(errors).toEqual([]);
});

for (const [name, target, role] of [['Viewer fixture', viewer, 'EDITOR'], ['Editor fixture', editor, 'VIEWER']]) test(`C09.05: existing ${name} updates to ${role} and reloads authoritative membership`, async ({ page }) => {
  const { writes, reads } = await setup(page); await page.getByRole('button', { name: 'Đổi vai trò ' + name, exact: true }).click(); await expect(input(page)).toBeFocused(); await expect(input(page)).toHaveValue(target);
  await page.getByLabel('Vai trò thành viên', { exact: true }).selectOption(role); await page.getByRole('button', { name: 'Lưu thành viên', exact: true }).click();
  await expect(input(page)).toHaveValue(''); await expect(section(page).locator('.member-row').filter({ has: page.getByText(name, { exact: true }) }).locator('.status-badge')).toHaveText(role);
  await expect(section(page).locator('.member-row')).toHaveCount(3); expect(reads()).toBe(2); expect(writes).toEqual([{ method: 'PUT', path: `/api/v1/projects/${owner}/members/${target}`, body: { role } }]);
});

test('C09.05: removal requires explicit confirmation; cancel restores focus and DELETE has no body', async ({ page }) => {
  const { writes } = await setup(page); const remove = page.getByRole('button', { name: 'Gỡ Viewer fixture', exact: true }); await remove.click(); expect(writes).toHaveLength(0);
  const cancel = page.getByRole('button', { name: 'Hủy gỡ thành viên', exact: true }); await expect(cancel).toBeFocused(); await cancel.click(); await expect(remove).toBeFocused(); expect(writes).toHaveLength(0);
  await remove.click(); await page.getByRole('button', { name: 'Xác nhận gỡ Viewer fixture', exact: true }).click();
  await expect(section(page).getByText('Viewer fixture', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ method: 'DELETE', path: `/api/v1/projects/${owner}/members/${viewer}`, body: null }]);
});

test('C09.05: Owner mutation is blocked in rows and UUID form; dropdown never offers OWNER', async ({ page }) => {
  const { writes } = await setup(page); await expect(page.getByRole('button', { name: 'Gỡ Owner fixture', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Đổi vai trò Owner fixture', exact: true })).toHaveCount(0);
  expect(await page.getByLabel('Vai trò thành viên', { exact: true }).locator('option').allTextContents()).toEqual(['VIEWER', 'EDITOR']);
  await input(page).fill('  ' + owner + '  '); await expect(section(page).getByRole('alert')).toContainText('Không thể thay đổi OWNER'); await expect(page.getByRole('button', { name: 'Lưu thành viên', exact: true })).toBeDisabled();
  await page.locator('.member-form-panel form').evaluate(form => form.requestSubmit()); expect(writes).toHaveLength(0);
});

for (const role of ['EDITOR', 'VIEWER']) test(`C09.05: ${role} has no mutation controls`, async ({ page }) => {
  await setup(page, { role }); await expect(section(page).getByRole('button')).toHaveCount(0); await expect(page.locator('.member-form-panel')).toHaveCount(0);
});

for (const method of ['PUT', 'DELETE']) test(`C09.05: ${method} single-flight guard prevents repeated submit while request is pending`, async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const { writes } = await setup(page, { mutation: async route => { await pending; await route.fulfill({ status: 503, json: { code: 'HTTP_ERROR' } }); } });
    if (method === 'PUT') { await input(page).fill(fresh); await page.getByRole('button', { name: 'Lưu thành viên', exact: true }).click(); }
    else { await page.getByRole('button', { name: 'Gỡ Viewer fixture', exact: true }).click(); await page.getByRole('button', { name: 'Xác nhận gỡ Viewer fixture', exact: true }).click(); }
    await expect.poll(() => writes.length).toBe(1); await expect(page.getByRole('button', { name: 'Lưu thành viên', exact: true })).toBeDisabled();
    await page.locator('.member-form-panel form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); }); expect(writes).toHaveLength(1); release(); await expect(page.getByRole('alert')).toBeVisible(); expect(writes).toHaveLength(1);
  } finally { release(); }
});

for (const failure of [400, 401, 403, 404, 409, 503, 'network', 'timeout', 'disabled-target']) test(`C09.05: mutation ${failure} preserves backend error, never retries and clears protected view on access loss`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install();
  const status = failure === 'disabled-target' ? 404 : failure;
  const { writes } = await setup(page, { mutation: route => failure === 'timeout' ? new Promise(() => {}) : failure === 'network' ? route.abort('failed') : route.fulfill({ status, json: { code: status === 401 ? 'UNAUTHENTICATED' : status === 404 ? 'USER_NOT_FOUND' : status === 409 ? 'OWNER_IMMUTABLE' : 'HTTP_ERROR', requestId: 'membership-failure-fixture' } }) });
  await input(page).fill(fresh); await page.getByRole('button', { name: 'Lưu thành viên', exact: true }).click(); await expect.poll(() => writes.length).toBe(1);
  if (failure === 'timeout') await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toBeVisible();
  if ([401, 403, 404].includes(status)) { await expect(section(page)).toHaveCount(0); await expect(page.locator('#project-files')).toHaveCount(0); }
  else { await expect(input(page)).toHaveValue(fresh); await expect(section(page).locator('.member-row')).toHaveCount(3); }
  if (status === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  else if (typeof status === 'number') await expect(page.getByRole('alert')).toContainText('membership-failure-fixture');
  if (status === 403) { await page.getByRole('button', { name: 'Làm mới CSRF', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Đã lấy token mới'); }
  if (failure === 'timeout') await expect(page.getByRole('alert')).toContainText('có thể đã được máy chủ nhận'); expect(writes).toHaveLength(1);
});

test('C09.05: project A mutation completing after a switch never changes B members or role', async ({ page }) => {
  let release, finished; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { finished = resolve; });
  const other = { id: '90000000-0000-0000-0000-000000000009', name: 'Beta member view', role: 'VIEWER', quotaBytes: 1000, usedBytes: 0, reservedBytes: 0 };
  try {
    const { writes } = await setup(page, { mutation: async route => { await pending; await route.fulfill({ json: { userId: fresh, displayName: 'Late A member', role: 'EDITOR' } }); finished(); }, extra: async (route, project) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/projects')) { await route.fulfill({ json: { items: [project, other], page: 0, size: 20 } }); return true; }
      if (path.includes('/' + other.id)) { await route.fulfill({ json: path.endsWith('/members') ? [] : path.endsWith('/files') ? { items: [], page: 0, size: 20 } : other }); return true; } return false;
    } });
    await input(page).fill(fresh); await page.getByRole('button', { name: 'Lưu thành viên', exact: true }).click(); await expect.poll(() => writes.length).toBe(1);
    await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Beta member view · VIEWER', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Beta member view', exact: true })).toBeVisible();
    release(); await done; await expect(section(page).locator('.member-row')).toHaveCount(0); await expect(page.getByText('Late A member', { exact: true })).toHaveCount(0); await expect(page.locator('.member-form-panel')).toHaveCount(0); expect(writes).toHaveLength(1);
  } finally { release(); }
});
