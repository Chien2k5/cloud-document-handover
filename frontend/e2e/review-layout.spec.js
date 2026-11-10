import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
for (const width of [375, 768, 1440]) test(`C09 UI review: centered larger login at ${width}px`, async ({ page }, testInfo) => {
  const height = width === 375 ? 812 : width === 768 ? 1024 : 900;
  await page.setViewportSize({ width, height });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  const panel = await page.locator('.guest-panel').boundingBox();
  expect(Math.abs(panel.x + panel.width / 2 - width / 2)).toBeLessThan(2);
  expect(Math.abs(panel.y + panel.height / 2 - height / 2)).toBeLessThan(2);
  if (width === 1440) expect(panel.width).toBeGreaterThanOrEqual(640);
  expect((await page.getByLabel('Email', { exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(54);
  await page.getByLabel('Email', { exact: true }).focus(); await page.keyboard.press('Tab'); await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fixture-review-login-${width}.png`) }); expect(errors).toEqual([]);
});
for (const width of [375, 768, 1440, 1920]) test(`C09 UI review: workspace uses available width and centers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1024 }); await mockProject(page, 'VIEWER');
  const main = await page.locator('.workspace-content').boundingBox();
  const sidebarWidth = width > 900 ? (await page.locator('.app-sidebar').boundingBox()).width : 0;
  expect(main.width).toBeCloseTo(Math.min(1280, width - sidebarWidth), 0);
  expect(Math.abs((main.x - sidebarWidth) - (width - main.x - main.width))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [375, 768, 1440]) test(`C09 UI review: readable typography at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1024 }); await mockProject(page, 'VIEWER');
  const size = locator => locator.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(await size(page.locator('body'))).toBeGreaterThanOrEqual(17);
  expect(await size(page.locator('#project-overview .page-header h2'))).toBeGreaterThanOrEqual(28);
  expect(await size(page.locator('.quota-metric dt').first())).toBeGreaterThanOrEqual(15);
  expect(await size(page.locator('.quota-metric dd strong').first())).toBeGreaterThanOrEqual(24);
  const sidebarLink = page.locator('.sidebar-link').first();
  expect(await size(sidebarLink)).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
