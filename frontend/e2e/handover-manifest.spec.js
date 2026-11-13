import { test, expect } from '@playwright/test';
import { workspaceView } from './fixtures.js';
import { file, handoverId, projectId, recipientId, manifest, setupHandover, openHandover } from './handover-fixture.js';
const view = page => page.locator('.handover');
for (const [status, accessStatus, expiresAt] of [['DRAFT', 'ACTIVE', '2099-01-01T00:00:00Z'], ['READY', 'ACTIVE', '2099-01-01T00:00:00Z'], ['CONFIRMED', 'REVOKED', '2099-01-01T00:00:00Z'], ['READY', 'ACTIVE', '2000-01-01T00:00:00Z']]) test(`C09.08B: ${status}/${accessStatus}/${expiresAt} remain independent server states`, async ({ page }) => {
  await setupHandover(page, { value: manifest({ status, accessStatus, expiresAt }) }); await openHandover(page);
  const states = view(page).locator('.handover-states'); await expect(states.getByText(status, { exact: true })).toBeVisible(); await expect(states.getByText(accessStatus, { exact: true })).toBeVisible(); await expect(states.getByText(expiresAt.startsWith('2000') ? 'Expired — đã hết hạn' : 'Chưa hết hạn', { exact: true })).toBeVisible();
  await expect(view(page).getByRole('heading', { name: 'Phiên bản trong gói', exact: true })).toBeVisible(); await expect(view(page).getByText(file.id, { exact: true })).toBeVisible(); await expect(view(page).getByText(file.versionId, { exact: true })).toBeHidden();
  await view(page).getByLabel('Thông tin kỹ thuật item ' + file.id, { exact: true }).focus(); await page.keyboard.press('Enter'); await expect(view(page).getByText(file.versionId, { exact: true })).toBeVisible(); await expect(view(page).getByText(file.expectedSha256, { exact: true })).toBeVisible();
});

test('C09.08B: recipient confirmation is per recipient; READY is never inferred as CONFIRMED from one acknowledgement', async ({ page }) => {
  await setupHandover(page, { value: manifest({ status: 'READY', recipients: [{ userId: projectId, accessStatus: 'ACTIVE', confirmedAt: '2030-01-01T00:00:00Z' }, { userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: null }] }) }); await openHandover(page);
  const people = view(page).locator('.handover-recipients'); await expect(people.locator(`[data-recipient-id="${projectId}"]`)).toContainText('Bạn'); await expect(people.locator(`[data-recipient-id="${projectId}"]`)).toContainText('Đã xác nhận'); await expect(people.locator(`[data-recipient-id="${recipientId}"]`)).toContainText('Chưa xác nhận'); await expect(view(page).locator('.handover-states').getByText('READY', { exact: true })).toBeVisible();
});

test('C09.08B: named external recipient opens package directly without project membership', async ({ page }) => {
  const value = manifest({ status: 'READY' }), reads = [];
  await page.route('**/api/v1/**', async route => {
    const p = new URL(route.request().url()).pathname; reads.push(p);
    if (p.endsWith('/auth/me')) return route.fulfill({ json: { id: recipientId, email: 'recipient@example.test', displayName: 'External recipient fixture' } });
    if (p.endsWith('/projects')) return route.fulfill({ json: { items: [], page: 0, size: 20 } });
    if (p.endsWith('/handovers/' + handoverId)) return route.fulfill({ json: value });
    if (p.endsWith('/projects/' + projectId)) return route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND' } }); throw Error('Unexpected external fixture ' + p);
  });
  await page.goto('/#/handovers/' + handoverId); await expect(view(page).getByRole('heading', { name: value.title, exact: true })).toBeVisible(); await expect(view(page).getByRole('button', { name: 'Xác nhận nhận bàn giao', exact: true })).toBeEnabled(); await expect(view(page).getByRole('button', { name: 'Phát hành gói', exact: true })).toHaveCount(0); await expect(view(page).getByRole('button', { name: 'Thu hồi gói', exact: true })).toHaveCount(0); expect(reads).toContain('/api/v1/projects/' + projectId);
});

test('C09.08B: invalid UUID never fetches a package and missing package has no manifest/actions', async ({ page }) => {
  let reads = 0;
  await setupHandover(page, { extra: async route => { if (!new URL(route.request().url()).pathname.includes('/handovers/')) return false; reads++; await route.fulfill({ status: 404, json: { code: 'HANDOVER_NOT_FOUND' } }); return true; } });
  await workspaceView(page, 'Mở gói bàn giao'); await page.getByLabel('UUID gói bàn giao', { exact: true }).fill('not-a-uuid'); await expect(page.getByRole('button', { name: 'Mở gói bàn giao', exact: true })).toBeDisabled(); expect(reads).toBe(0);
  await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(handoverId); await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click(); await expect(view(page).getByRole('alert')).toContainText('không phải người được cấp quyền'); await expect(view(page).locator('.handover-item')).toHaveCount(0); await expect(view(page).locator('.handover-actions button')).toHaveCount(0); expect(reads).toBe(1);
});

for (const width of [375, 768, 1440]) test(`C09.08B: long manifest filename/hash/UUID and recipient cards fit ${width}px with keyboard disclosure`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 }); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await setupHandover(page, { value: manifest({ status: 'READY', title: 'Gói tài liệu '.repeat(12), items: [{ fileVersionId: file.id, filename: 'x'.repeat(229) + '.txt', versionId: 'opaque-'.repeat(20), expectedSha256: 'a'.repeat(64) }] }) }); await openHandover(page);
  const summary = view(page).getByLabel('Thông tin kỹ thuật item ' + file.id, { exact: true }); await summary.focus(); await page.keyboard.press('Enter'); await expect(view(page).getByText('a'.repeat(64), { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`fixture-handover-manifest-${width}.png`) }); expect(errors).toEqual([]);
});
