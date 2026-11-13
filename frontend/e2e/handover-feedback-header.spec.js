import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
import { handoverId, recipientId, manifest, setupHandover, openHandover } from './handover-fixture.js';

test('recipient sees why a draft is blocked, then can open and confirm after publication', async ({ page }) => {
  let published = false, confirmations = 0;
  await setupHandover(page, {
    role: 'EDITOR', userId: recipientId,
    extra: async (route, current) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/handovers/' + handoverId) && !published) {
        await route.fulfill({ status: 409, json: { code: 'HANDOVER_NOT_READY', requestId: 'draft-not-published' } });
        return true;
      }
      if (path.endsWith('/confirm')) {
        confirmations++;
        current.value = manifest({ status: 'CONFIRMED', recipients: [{ userId: recipientId, accessStatus: 'ACTIVE', confirmedAt: '2030-01-01T00:00:00Z' }] });
        await route.fulfill({ json: { handoverId, userId: recipientId, confirmedAt: '2030-01-01T00:00:00Z', status: 'CONFIRMED' } });
        return true;
      }
      if (published && confirmations === 0) current.value = manifest({ status: 'READY' });
      return false;
    },
  });
  await openHandover(page);
  await expect(page.getByRole('alert')).toContainText('Gói bàn giao chưa được phát hành');
  await expect(page.getByRole('alert')).toContainText('draft-not-published');
  await expect(page.getByRole('alert')).not.toContainText('Trạng thái đã thay đổi');
  await expect(page.locator('.handover-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xác nhận nhận bàn giao', exact: true })).toHaveCount(0);
  expect(confirmations).toBe(0);
  published = true;
  await page.getByRole('button', { name: 'Tải lại gói', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xác nhận nhận bàn giao', exact: true }).click();
  await expect(page.locator('.handover-states [data-state="CONFIRMED"]')).toBeVisible();
  expect(confirmations).toBe(1);
});

test('expired draft tells Owner to create a new package and offers no publish action', async ({ page }) => {
  await setupHandover(page, { value: manifest({ expiresAt: '2000-01-01T00:00:00Z' }) });
  await openHandover(page);
  await expect(page.locator('.handover .handover-policy').filter({ hasText: 'Owner cần tạo gói mới' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phát hành gói', exact: true })).toHaveCount(0);
});

test('active draft points Owner to the publish action', async ({ page }) => {
  await setupHandover(page);
  await openHandover(page);
  await expect(page.locator('.handover .handover-policy').filter({ hasText: 'Gói đang là bản nháp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phát hành gói', exact: true })).toBeEnabled();
});

test('account actions stay on one desktop row and remain reachable on small screens', async ({ page }, info) => {
  const { user } = await mockProject(page);
  for (const longIdentity of [false, true]) {
    if (longIdentity) {
      user.displayName = 'Tên tài khoản rất dài '.repeat(4);
      user.email = 'long-account-name-for-profile-layout@example.test';
      await page.reload();
    }
    for (const width of [1920, 1440, 1024, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1080 });
      const profile = page.getByRole('button', { name: 'Thông tin tài khoản', exact: true });
      const logout = page.getByRole('button', { name: 'Đăng xuất', exact: true });
      await expect(profile).toBeInViewport();
      await expect(logout).toBeInViewport();
      await expect.poll(() => page.locator('.account-area').evaluate(area => {
        const profile = area.querySelector('.account-profile button').getBoundingClientRect();
        const logout = area.querySelector(':scope > button').getBoundingClientRect();
        return {
          aligned: Math.abs((profile.y + profile.height / 2) - (logout.y + logout.height / 2)) <= 1,
          separate: profile.right <= logout.left,
          fits: document.documentElement.scrollWidth <= innerWidth,
        };
      })).toEqual({ aligned: true, separate: true, fits: true });
      if (!longIdentity && width === 1920) await page.screenshot({ path: info.outputPath('header-desktop.png') });
    }
  }
});
