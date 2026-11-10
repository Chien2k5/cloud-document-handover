import { test, expect } from '@playwright/test';
import { workspaceView } from './fixtures.js';
import { file, recipientId, handoverId, projectId, setupHandover, fillDraft } from './handover-fixture.js';
test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });
const draft = page => page.locator('.draft-panel'), submit = page => page.getByRole('button', { name: 'Tạo DRAFT', exact: true });
const select = page => page.getByLabel(`Chọn bàn giao ${file.filename} · ${file.id}`, { exact: true }).check();

test('C09.08A: review selected exact version, deduplicate recipient UUIDs, convert local deadline to UTC and create DRAFT without publishing', async ({ page }) => {
  const requests = [];
  await setupHandover(page, { extra: async (route, current) => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') { requests.push({ method: 'POST', path: p, body: route.request().postDataJSON() }); expect(route.request().headers()['x-csrf']).toBe('fixture'); await route.fulfill({ status: 201, json: current.value }); return true; } return false;
  } });
  await select(page); await expect(draft(page).getByLabel('Phiên bản đã chọn', { exact: true })).toContainText(file.filename); await draft(page).getByLabel('Định danh phiên bản đã chọn ' + file.id, { exact: true }).click(); await expect(draft(page).getByText(file.versionId, { exact: true })).toBeVisible();
  await fillDraft(page, { title: '  Gói duyệt  ', recipients: `${recipientId}, ${recipientId}` }); await submit(page).click(); await expect(page.getByRole('button', { name: 'Phát hành gói', exact: true })).toBeVisible();
  expect(requests).toEqual([{ method: 'POST', path: `/api/v1/projects/${projectId}/handovers`, body: { title: 'Gói duyệt', recipientUserIds: [recipientId], fileVersionIds: [file.id], expiresAt: '2099-01-01T05:00:00.000Z' } }]);
  await workspaceView(page, 'Tài liệu'); await expect(draft(page).getByRole('status')).toContainText(handoverId); await expect(page.getByLabel(`Chọn bàn giao ${file.filename} · ${file.id}`, { exact: true })).toBeChecked();
});

for (const role of ['EDITOR', 'VIEWER']) test(`C09.08A: ${role} cannot create DRAFT`, async ({ page }) => { await setupHandover(page, { role }); await expect(draft(page)).toHaveCount(0); });
for (const status of ['VERIFIED', 'MISMATCH', 'INTEGRITY_PENDING', 'FAILED']) test(`C09.08A: ${status} selection gating and empty DRAFT validation`, async ({ page }) => {
  let writes = 0; await setupHandover(page, { items: [{ ...file, integrityStatus: status }], extra: async route => {
    const p = new URL(route.request().url()).pathname; if (p.includes('/uploads/')) { await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: { ...file, integrityStatus: status } } }); return true; } if (route.request().method() === 'POST') writes++; return false;
  } });
  await expect(submit(page)).toBeDisabled(); if (status === 'VERIFIED') { await select(page); await expect(submit(page)).toBeEnabled(); } else await expect(page.getByRole('checkbox')).toBeDisabled();
  if (status !== 'VERIFIED') { await fillDraft(page); await draft(page).locator('form').evaluate(form => form.requestSubmit()); await expect(draft(page).getByRole('alert')).toContainText('Dữ liệu không hợp lệ'); expect(writes).toBe(0); }
});

for (const change of [{ title: '   ' }, { recipients: 'bad-uuid' }, { deadline: '2000-01-01T12:00' }]) test(`C09.08A: invalid ${JSON.stringify(change)} sends no mutation`, async ({ page }) => {
  let writes = 0; await setupHandover(page, { extra: async route => { if (route.request().method() === 'POST') writes++; return false; } }); await select(page); await fillDraft(page, change); await submit(page).click(); await expect(draft(page).getByRole('alert')).toContainText('Dữ liệu không hợp lệ'); expect(writes).toBe(0);
});

test('C09.08A: existing-member picker does not append duplicate UUIDs', async ({ page }) => {
  await setupHandover(page); await select(page); await draft(page).getByText('Thành viên có thể chọn làm người nhận', { exact: true }).click(); const add = page.getByRole('button', { name: 'Thêm người nhận Owner fixture', exact: true }); await add.click(); await add.click(); await expect(page.getByLabel('UUID người nhận', { exact: true })).toHaveValue(projectId);
});

for (const failure of [401, 403, 404, 409, 503, 'network', 'timeout', 'invalid-response']) test(`C09.08A: create ${failure} never retries or publishes and preserves failure semantics`, async ({ page }) => {
  if (failure === 'timeout') await page.clock.install(); let posts = 0;
  await setupHandover(page, { extra: async route => {
    if (route.request().method() !== 'POST') return false; posts++; if (failure === 'timeout') await new Promise(() => {}); else if (failure === 'network') await route.abort('failed'); else await route.fulfill(failure === 'invalid-response' ? { json: { id: 'bad-id' } } : { status: failure, json: { code: failure === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR', requestId: 'draft-failure-fixture' } }); return true;
  } });
  await select(page); await fillDraft(page); await submit(page).click(); await expect.poll(() => posts).toBe(1); if (failure === 'timeout') await page.clock.fastForward(21000); await expect(page.getByRole('alert')).toBeVisible(); expect(posts).toBe(1);
  if ([401, 403, 404].includes(failure)) await expect(page.locator('#project-files')).toHaveCount(0); else { await expect(page.getByLabel('Tiêu đề bàn giao', { exact: true })).toHaveValue('Gói kiểm thử'); await expect(draft(page).locator('.draft-created')).toHaveCount(0); }
});

test('C09.08A: pending DRAFT submit is single-flight, survives same-project navigation, and never auto-publishes', async ({ page }) => {
  let release, posts = 0; const pending = new Promise(resolve => { release = resolve; });
  try {
    await setupHandover(page, { extra: async (route, current) => { if (route.request().method() !== 'POST') return false; posts++; await pending; await route.fulfill({ status: 201, json: current.value }); return true; } });
    await select(page); await fillDraft(page); await submit(page).click(); await expect.poll(() => posts).toBe(1); await draft(page).locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); }); expect(posts).toBe(1); await workspaceView(page, 'Dự án'); await workspaceView(page, 'Tài liệu'); await expect(submit(page)).toBeDisabled();
    release(); await expect(page.getByRole('button', { name: 'Phát hành gói', exact: true })).toBeVisible(); expect(posts).toBe(1);
  } finally { release(); }
});

for (const width of [375, 768, 1440]) test(`C09.08A: selected version review and draft form fit ${width}px with keyboard labels`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 }); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await setupHandover(page, { items: [{ ...file, filename: 'x'.repeat(229) + '.txt' }] }); await page.getByRole('checkbox').check(); await fillDraft(page); await page.getByLabel('Tiêu đề bàn giao', { exact: true }).focus(); await expect(page.getByLabel('Tiêu đề bàn giao', { exact: true })).toBeFocused(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`fixture-draft-${width}.png`) }); expect(errors).toEqual([]);
});
