import { test, expect } from '@playwright/test';
import { mockProject, workspaceView } from './fixtures.js';
const owner = '10000000-0000-0000-0000-000000000001', editor = '20000000-0000-0000-0000-000000000002', viewer = '30000000-0000-0000-0000-000000000003';
const members = [{ userId: owner, displayName: 'Owner thật từ fixture', role: 'OWNER' }, { userId: editor, displayName: 'Editor thật từ fixture', role: 'EDITOR' }, { userId: viewer, displayName: 'Viewer thật từ fixture', role: 'VIEWER' }];
const section = page => page.locator('#project-members');
async function roster(page, role, people = members) {
  return mockProject(page, role, async (route, _project, user) => {
    user.id = role === 'OWNER' ? owner : role === 'EDITOR' ? editor : viewer; user.displayName = 'MOCK DATA · Members';
    if (!new URL(route.request().url()).pathname.endsWith('/members')) return false;
    await route.fulfill({ json: people }); return true;
  });
}
for (const role of ['OWNER', 'EDITOR', 'VIEWER']) test(`C09.05A: ${role} reads actual names/roles and self identity, Owner is immutable`, async ({ page }) => {
  await roster(page, role); await workspaceView(page, 'Thành viên');
  await expect(section(page).locator('.member-row')).toHaveCount(3);
  for (const member of members) await expect(section(page).locator('.member-row').filter({ has: page.locator('strong').filter({ hasText: member.displayName }) }).locator('.status-badge')).toHaveText(member.role);
  await expect(section(page).locator('.self-badge')).toHaveCount(1);
  await expect(section(page).locator('.member-row').filter({ has: page.locator('.self-badge') }).locator('.status-badge')).toHaveText(role);
  await expect(section(page).getByRole('button', { name: /^Gỡ / })).toHaveCount(role === 'OWNER' ? 2 : 0);
  await expect(section(page).getByRole('button', { name: 'Gỡ Owner thật từ fixture', exact: true })).toHaveCount(0);
  await expect(section(page).getByText(owner, { exact: true })).toBeHidden();
  await section(page).getByLabel('Thông tin kỹ thuật thành viên Owner thật từ fixture', { exact: true }).click();
  await expect(section(page).getByText(owner, { exact: true })).toBeVisible();
});

test('C09.05A: empty API list never invents a member', async ({ page }) => {
  await roster(page, 'VIEWER', []); await workspaceView(page, 'Thành viên');
  await expect(section(page).getByRole('heading', { name: 'Chưa có thành viên trong phản hồi', exact: true })).toBeVisible();
  await expect(section(page).locator('.member-row')).toHaveCount(0);
});

test('C09.05A: pending members request stays loading until the actual response arrives', async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  try {
    const opened = mockProject(page, 'VIEWER', async route => { if (!new URL(route.request().url()).pathname.endsWith('/members')) return false; await pending; await route.fulfill({ json: members }); return true; });
    await expect(page.getByRole('status')).toHaveText('Đang tải quyền và thành viên…'); await expect(section(page)).toHaveCount(0);
    release(); await opened; await expect(section(page).locator('.member-row')).toHaveCount(3);
  } finally { release(); }
});

test('C09.05A: failed members response clears protected rows and exposes backend error', async ({ page }) => {
  let denied = false;
  await mockProject(page, 'VIEWER', async route => { if (!new URL(route.request().url()).pathname.endsWith('/members') || !denied) return false; await route.fulfill({ status: 503, json: { code: 'HTTP_ERROR', requestId: 'members-error-fixture' } }); return true; });
  denied = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('members-error-fixture'); await expect(section(page)).toHaveCount(0); await expect(page.locator('#project-files')).toHaveCount(0);
});

for (const width of [375, 768, 1440]) test(`C09.05A: long member display names and UUIDs fit ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const long = 'Thành_viên_'.repeat(12);
  await roster(page, 'VIEWER', [{ ...members[1], displayName: long }, members[2]]); await workspaceView(page, 'Thành viên');
  await section(page).getByLabel('Thông tin kỹ thuật thành viên ' + long, { exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(section(page).getByText(editor, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fixture-members-list-${width}.png`) }); expect(errors).toEqual([]);
});
