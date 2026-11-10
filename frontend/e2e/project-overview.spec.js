import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const id = '10000000-0000-0000-0000-000000000001';
const summary = page => page.locator('.project-summary');
async function overview(page, values = {}, role = 'OWNER') {
  return mockProject(page, role, async (route, project, user) => {
    Object.assign(project, values); user.displayName = 'MOCK DATA · Quota preview';
    return false;
  });
}
for (const role of ['OWNER', 'EDITOR', 'VIEWER']) test(`C09.04: ${role} overview, real role guards and accessible technical disclosure`, async ({ page }) => {
  await overview(page, { description: '' }, role);
  await expect(summary(page).getByRole('heading', { name: 'Project fixture', exact: true })).toBeVisible();
  await expect(summary(page).getByText('Chưa có mô tả.', { exact: true })).toBeVisible();
  await expect(summary(page).locator('.project-role')).toHaveText('Vai trò: ' + role);
  const details = summary(page).locator('details'), toggle = details.locator('summary');
  await toggle.focus(); await page.keyboard.press('Enter'); await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByText('Project ID:', { exact: false })).toBeHidden();
  await page.keyboard.press('Enter'); await expect(page.getByText('Project ID:', { exact: false })).toBeVisible();
  await expect(page.getByText('Project ID:', { exact: false })).toContainText(id);
  await expect(page.getByRole('button', { name: 'Lưu thành viên', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
  await expect(page.getByLabel('Chọn file', { exact: true })).toHaveCount(role === 'VIEWER' ? 0 : 1);
  await summary(page).getByRole('link', { name: 'Mở tài liệu', exact: false }).click();
  await expect(page).toHaveURL(new RegExp(id + '/files$')); await expect(page.locator('#project-files')).toBeFocused();
  await summary(page).getByRole('link', { name: 'Xem thành viên', exact: false }).click(); await expect(page.locator('#project-members')).toBeFocused();
  await summary(page).getByRole('link', { name: 'Mở gói bàn giao', exact: false }).click(); await expect(page.locator('#workspace-handovers')).toBeFocused();
});

for (const [used, reserved, quota] of [[0, 0, 1000], [900, 99, 1000], [900, 100, 1000], [0, 1000, 1000]]) test(`C09.04: exact quota ${used}+${reserved}/${quota} does not equate reserved with completed`, async ({ page }) => {
  await overview(page, { usedBytes: used, reservedBytes: reserved, quotaBytes: quota });
  await expect(summary(page).locator('.quota-metric--used strong')).toHaveText(`${used} byte`);
  await expect(summary(page).locator('.quota-metric--reserved strong')).toHaveText(`${reserved} byte`);
  await expect(summary(page).locator('.quota-metric--limit strong')).toHaveText(`${quota} byte`);
  await expect(summary(page).getByRole('img')).toHaveAccessibleName(`Phân bổ dung lượng: ${used} byte đã dùng; ${reserved} byte đang giữ chỗ; giới hạn ${quota} byte.`);
  await expect(summary(page).getByText('chưa phải upload hoàn tất', { exact: false })).toBeVisible();
  expect(await summary(page).locator('.quota-track__used').evaluate(element => parseFloat(element.style.width))).toBe(used / quota * 100);
  expect(await summary(page).locator('.quota-track__reserved').evaluate(element => parseFloat(element.style.width))).toBe(reserved / quota * 100);
});

for (const values of [{ quotaBytes: 0 }, { usedBytes: -1 }, { reservedBytes: '100' }, { quotaBytes: 100, usedBytes: 90, reservedBytes: 11 }, { usedBytes: null }]) test(`C09.04: invalid API quota ${JSON.stringify(values)} is explicit and never clamped`, async ({ page }) => {
  await overview(page, values);
  await expect(summary(page).getByRole('status')).toContainText('Dữ liệu dung lượng thiếu hoặc không hợp lệ');
  await expect(summary(page).getByRole('img')).toHaveCount(0);
  await expect(summary(page).locator('.quota-metrics')).toHaveCount(0);
  expect(await summary(page).innerText()).not.toMatch(/NaN|Infinity/);
});

for (const status of [401, 403, 404]) test(`C09.04: ${status} on revalidation clears protected summary/members/files`, async ({ page }) => {
  let denied = false;
  await mockProject(page, 'OWNER', async route => {
    if (!denied || new URL(route.request().url()).pathname !== '/api/v1/projects/' + id) return false;
    await route.fulfill({ status, json: { code: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND' } }); return true;
  });
  denied = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); await expect(summary(page)).toHaveCount(0);
  await expect(page.locator('#project-files')).toHaveCount(0); await expect(page.locator('#project-members')).toHaveCount(0);
  if (status === 401) await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
});

test('C09.04: pending revalidation hides quota and protected detail until a response arrives', async ({ page }) => {
  let hold = false, release; const pending = new Promise(resolve => { release = resolve; });
  await mockProject(page, 'VIEWER', async route => { if (hold && new URL(route.request().url()).pathname === '/api/v1/projects/' + id) await pending; return false; });
  try {
    hold = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
    await expect(page.locator('#project-overview').getByRole('status')).toHaveText('Đang tải quyền và thành viên…');
    await expect(summary(page)).toHaveCount(0); await expect(page.locator('#project-files')).toHaveCount(0);
    release(); await expect(summary(page)).toBeVisible();
  } finally { release(); }
});

for (const width of [375, 768, 1440]) test(`C09.04: overview, quota and UUID fit ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await overview(page, { name: 'MOCK DATA · Bàn giao nhóm 5', description: 'Bản xem trước bằng fixture. Các số liệu dung lượng bên dưới lấy từ response fixture, không phải AWS thật.', usedBytes: 2097152, reservedBytes: 1048576, quotaBytes: 10485760 }, 'VIEWER');
  await page.evaluate(() => document.activeElement?.blur()); await page.locator('#project-overview').evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fixture-overview-${width}.png`) });
  await summary(page).screenshot({ path: testInfo.outputPath(`fixture-quota-${width}.png`) });
  expect(errors).toEqual([]);
});

test('C09.04: long description, name and UUID wrap at 375px without hiding content', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const description = 'd'.repeat(2000), name = 'n'.repeat(150);
  await overview(page, { description, name }, 'VIEWER');
  await expect(summary(page).getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(summary(page).locator('.project-description')).toHaveText(description);
  await expect(page.getByText('Project ID:', { exact: false })).toContainText(id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
