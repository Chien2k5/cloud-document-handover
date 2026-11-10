import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const id = '10000000-0000-0000-0000-000000000001';
const file = { id: '20000000-0000-0000-0000-000000000001', fileId: '30000000-0000-0000-0000-000000000001', uploadId: '40000000-0000-0000-0000-000000000001', versionId: 'opaque-v1', filename: 'preserved.txt', size: 3, expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64), uploadStatus: 'AVAILABLE', integrityStatus: 'VERIFIED' };

for (const width of [375, 768, 1440]) test(`C09 UI review: exclusive screens, hidden focus and Back/Forward at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mockProject(page, 'VIEWER');
  await workspaceView(page, 'Dự án'); await expect(page.getByRole('heading', { name: 'Dự án của bạn', exact: true })).toBeVisible();
  await expect(page.locator('#project-overview')).toBeHidden(); await expect(page.locator('#workspace-handovers')).toBeHidden();
  await workspaceView(page, 'Mở gói bàn giao');
  await expect(page.getByRole('heading', { name: 'Dự án của bạn', exact: true })).toHaveCount(0);
  await expect(page.locator('#workspace-projects')).toBeHidden(); await expect(page.locator('#project-overview')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Gói bàn giao', exact: true })).toBeVisible();
  const hiddenProjectButton = page.locator('#workspace-projects .project-tile').first();
  await hiddenProjectButton.evaluate(element => element.focus()); await expect(hiddenProjectButton).not.toBeFocused();
  await page.getByLabel('UUID gói bàn giao', { exact: true }).focus();
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[hidden],[inert]'))).toBe(false); }
  await page.goBack(); await expect(page).toHaveURL(/#\/projects$/); await expect(page.locator('#workspace-projects')).toBeVisible(); await expect(page.locator('#workspace-handovers')).toBeHidden();
  await page.goForward(); await expect(page).toHaveURL(/#\/handovers$/); await expect(page.locator('#workspace-handovers')).toBeVisible(); await expect(page.locator('#workspace-projects')).toBeHidden();
  await page.reload(); await expect(page.locator('#workspace-handovers')).toBeVisible(); await expect(page.locator('#workspace-projects')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath(`fixture-review-handovers-${width}.png`) }); expect(errors).toEqual([]);
});

test('C09 UI review: hiding a project preserves its mounted FileVersion selection and typed DRAFT', async ({ page }) => {
  let fileReads = 0;
  await mockProject(page, 'OWNER', async route => { if (!new URL(route.request().url()).pathname.endsWith('/files')) return false; fileReads++; await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true; });
  const selected = page.getByLabel(`Chọn bàn giao ${file.filename} · ${file.id}`, { exact: true }); await selected.check();
  const originalNode = await selected.elementHandle();
  await page.getByLabel('Tiêu đề bàn giao', { exact: true }).fill('Keep DRAFT input');
  await workspaceView(page, 'Mở gói bàn giao'); await expect(page.locator('#project-overview')).toBeHidden();
  await workspaceView(page, 'Dự án'); await expect(page.locator('#project-overview')).toBeHidden();
  await workspaceView(page, 'Tài liệu'); await expect(selected).toBeVisible(); await expect(selected).toBeChecked();
  expect(await selected.evaluate((element, original) => element === original, originalNode)).toBe(true);
  await expect(page.getByLabel('Tiêu đề bàn giao', { exact: true })).toHaveValue('Keep DRAFT input'); expect(fileReads).toBe(1);
});

test('C09 UI review: polling result can finish while hidden, without a new file request on return', async ({ page }) => {
  let release, fileReads = 0, pollReads = 0; const pending = new Promise(resolve => { release = resolve; });
  try {
    await mockProject(page, 'VIEWER', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/files')) { fileReads++; await route.fulfill({ json: { items: [{ ...file, integrityStatus: 'INTEGRITY_PENDING', actualSha256: null }], page: 0, size: 20 } }); return true; }
      if (path.endsWith('/uploads/' + file.uploadId)) { pollReads++; await pending; await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: file } }); return true; } return false;
    });
    await expect.poll(() => pollReads).toBe(1); await workspaceView(page, 'Mở gói bàn giao'); release();
    await expect(page.locator('#project-files').getByText('VERIFIED', { exact: true })).toHaveText('VERIFIED');
    await workspaceView(page, 'Tài liệu'); await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible(); expect(fileReads).toBe(1); expect(pollReads).toBe(1);
  } finally { release(); }
});

test('C09 UI review: loaded handover remains mounted and UUID is retained across global screens', async ({ page }) => {
  let reads = 0;
  await mockProject(page, 'VIEWER', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/handovers/' + id)) return false;
    reads++; await route.fulfill({ json: { id, projectId: id, title: 'Preserved package', status: 'READY', accessStatus: 'ACTIVE', expiresAt: '2099-01-01T00:00:00Z', items: [], recipients: [{ userId: id, accessStatus: 'ACTIVE', confirmedAt: null }] } }); return true;
  });
  await workspaceView(page, 'Mở gói bàn giao'); await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(id); await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preserved package', exact: true })).toBeVisible();
  await workspaceView(page, 'Dự án'); await expect(page.locator('#workspace-handovers')).toBeHidden();
  await workspaceView(page, 'Mở gói bàn giao'); await expect(page.getByLabel('UUID gói bàn giao', { exact: true })).toHaveValue(id);
  await expect(page.getByRole('heading', { name: 'Preserved package', exact: true })).toBeVisible(); expect(reads).toBe(1);
});

test('C09 UI review: logout and another account never inherit selected versions or project detail', async ({ page }) => {
  let second = false;
  await mockProject(page, 'OWNER', async (route, _project, user) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/logout')) { await route.fulfill({ status: 204 }); return true; }
    if (path.endsWith('/login')) { second = true; await route.fulfill({ json: {} }); return true; }
    if (second) {
      user.id = '90000000-0000-0000-0000-000000000001'; user.displayName = 'Account B';
      if (path.endsWith('/projects')) { await route.fulfill({ json: { items: [], page: 0, size: 20 } }); return true; }
      if (path.includes('/projects/' + id)) { await route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } }); return true; }
    }
    if (path.endsWith('/files')) { await route.fulfill({ json: { items: [file], page: 0, size: 20 } }); return true; } return false;
  });
  await page.getByLabel(`Chọn bàn giao ${file.filename} · ${file.id}`, { exact: true }).check();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('account-b@example.test'); await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('Account B', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.project-summary')).toHaveCount(0); await expect(page.locator('#project-files')).toHaveCount(0);
  await expect(page.getByLabel(`Chọn bàn giao ${file.filename} · ${file.id}`, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('C09 UI review: navigation helper waits for the real workspace after delayed auth on reload', async ({ page }) => {
  let hold = false, release; const pending = new Promise(resolve => { release = resolve; });
  await mockProject(page, 'VIEWER', async route => { if (hold && new URL(route.request().url()).pathname.endsWith('/auth/me')) await pending; return false; });
  try {
    hold = true; await page.reload();
    await expect(page.getByRole('status')).toHaveText('Đang kiểm tra phiên đăng nhập…');
    const opening = workspaceView(page, 'Dự án'); release(); await opening;
    await expect(page.getByRole('heading', { name: 'Dự án của bạn', exact: true })).toBeVisible();
    await expect(page.locator('#project-overview')).toBeHidden();
  } finally { release(); }
});
