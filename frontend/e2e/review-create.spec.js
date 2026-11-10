import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';

for (const width of [375, 768, 1440]) test(`C09 UI review: create dialog keyboard, size and unchanged list layout at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mockProject(page, 'VIEWER'); await workspaceView(page, 'Dự án');
  const tile = page.locator('.project-tile').first(), list = page.locator('#workspace-projects');
  if (width === 1440) expect((await tile.boundingBox()).width).toBeGreaterThan(500);
  expect((await tile.boundingBox()).height).toBeGreaterThanOrEqual(264);
  const before = await list.boundingBox(), trigger = page.getByRole('button', { name: 'Tạo dự án mới', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Tạo dự án', exact: true }); await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Tên dự án', { exact: true })).toBeFocused();
  expect((await list.boundingBox()).height).toBeCloseTo(before.height, 0);
  await tile.evaluate(element => element.focus()); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 8; i++) { await page.keyboard.press(key); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true); }
  await page.getByLabel('Tên dự án', { exact: true }).fill('MOCK DATA · Dự án nhóm 5');
  await page.getByLabel('Mô tả', { exact: true }).fill('Bản xem trước bằng fixture, không phải dữ liệu backend thật.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dialog.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: testInfo.outputPath(`fixture-review-create-${width}.png`) });
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(page.getByLabel('Tên dự án', { exact: true })).toHaveValue('MOCK DATA · Dự án nhóm 5');
  await page.getByRole('button', { name: 'Đóng form tạo dự án', exact: true }).click(); await expect(trigger).toBeFocused(); expect(errors).toEqual([]);
});

test('C09 UI review: Escape while POST is pending preserves request/lock and never retries on reopen', async ({ page }) => {
  let release, writes = 0; const pending = new Promise(resolve => { release = resolve; });
  try {
    await mockProject(page, 'VIEWER', async route => {
      if (route.request().method() !== 'POST' || !new URL(route.request().url()).pathname.endsWith('/projects')) return false;
      writes++; expect(route.request().postDataJSON()).toEqual({ name: 'Pending project', description: '' });
      await pending; await route.fulfill({ status: 503, json: { code: 'HTTP_ERROR', requestId: 'pending-fixture' } }); return true;
    });
    await workspaceView(page, 'Dự án'); const trigger = page.getByRole('button', { name: 'Tạo dự án mới', exact: true }); await trigger.click();
    await page.getByLabel('Tên dự án', { exact: true }).fill('Pending project'); await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click(); await expect.poll(() => writes).toBe(1);
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await trigger.click();
    const button = page.getByRole('button', { name: 'Đang tạo dự án…', exact: true }); await expect(button).toBeDisabled();
    await button.evaluate(element => element.form.requestSubmit()); expect(writes).toBe(1); release();
    await expect(page.getByRole('alert')).toContainText('pending-fixture'); await expect(page.getByLabel('Tên dự án', { exact: true })).toHaveValue('Pending project'); expect(writes).toBe(1);
  } finally { release(); }
});

test('C09 UI review: hash Back closes dialog and keeps project navigation usable', async ({ page }) => {
  await mockProject(page, 'VIEWER'); await workspaceView(page, 'Dự án');
  await page.getByRole('button', { name: 'Tạo dự án mới', exact: true }).click(); await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.project-summary')).toBeVisible();
  await workspaceView(page, 'Mở gói bàn giao'); await expect(page.getByRole('heading', { name: 'Gói bàn giao', exact: true })).toBeVisible();
});
