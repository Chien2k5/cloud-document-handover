import { test, expect } from '@playwright/test';
const id = '10000000-0000-0000-0000-000000000001';
import { mockProject } from './fixtures.js';
test('mock backend: Owner selects project and updates a membership with exact payload', async ({ page }) => {
  let saved = false;
  await mockProject(page, 'OWNER', async route => {
    if (route.request().method() !== 'PUT') return false;
    expect(route.request().postDataJSON()).toEqual({ role: 'EDITOR' });
    expect(route.request().headers()['x-csrf']).toBe('fixture');
    saved = true; await route.fulfill({ json: { userId: id, displayName: 'Editor', role: 'EDITOR' } }); return true;
  });
  await page.getByLabel('UUID thành viên', { exact: true }).fill('20000000-0000-0000-0000-000000000002');
  await page.getByLabel('Vai trò thành viên', { exact: true }).selectOption('EDITOR');
  await page.getByRole('button', { name: 'Lưu thành viên' }).click();
  await expect(page.getByLabel('UUID thành viên', { exact: true })).toHaveValue(''); expect(saved).toBe(true);
});
test('mock backend: Viewer cannot edit members; lost membership clears protected project detail', async ({ page }) => {
  let lost = false;
  await mockProject(page, 'VIEWER', async route => {
    if (!lost || !new URL(route.request().url()).pathname.includes(`/projects/${id}`)) return false;
    await route.fulfill({ status: 404, json: { code: 'PROJECT_NOT_FOUND' } }); return true;
  });
  await expect(page.getByRole('button', { name: 'Lưu thành viên' })).toHaveCount(0);
  lost = true; await page.getByRole('button', { name: 'Kiểm tra lại quyền dự án' }).click();
  await expect(page.getByRole('alert')).toContainText('không còn quyền');
  await expect(page.getByText('Project ID:', { exact: false })).toHaveCount(0);
});
