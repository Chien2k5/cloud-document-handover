import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';

const filename = 'Tai lieu ' + 'a'.repeat(220) + '.pdf';
const file = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001',
  uploadId: '40000000-0000-0000-0000-000000000001', versionId: 'opaque-v1', filename, size: 3,
  expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };

for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`C09.01: long content, controls and focus at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await mockProject(page, 'OWNER', async route => {
      if (!new URL(route.request().url()).pathname.endsWith('/files')) return false;
      await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true;
    });
    await expect(page.getByRole('heading', { name: filename + ' · 3 byte', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const upload = page.getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true });
    await expect(upload).toBeDisabled();
    await expect(page.getByLabel('Chọn file', { exact: true })).toBeVisible();
    const check = page.getByRole('button', { name: 'Kiểm tra lại ' + filename, exact: true });
    await check.focus(); await page.keyboard.press('Tab');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
    await page.screenshot({ path: testInfo.outputPath(`fixture-foundation-${viewport.width}.png`), fullPage: true });
    expect(errors.filter(error => !error.startsWith('Pattern attribute value [0-9a-fA-F-]{36} is not a valid regular expression:'))).toEqual([]);
  });
}

test('C09.01: guest form remains usable by keyboard without exposing workspace', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dự án của bạn', exact: true })).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only');
  await page.getByLabel('Email', { exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  expect(await page.getByLabel('Mật khẩu', { exact: true }).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
