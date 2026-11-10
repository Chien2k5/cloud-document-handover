import { expect } from '@playwright/test';
const id = '10000000-0000-0000-0000-000000000001';
export async function mockProject(page, role = 'OWNER', overrides = async () => false) {
  const user = { id, email: 'owner@example.test', displayName: 'Owner fixture' };
  const project = { id, name: 'Project fixture', description: 'MVP', role, quotaBytes: 1000000, usedBytes: 0, reservedBytes: 0 };
  await page.route('**/api/v1/**', async route => {
    if (await overrides(route, project, user)) return;
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path.endsWith('/auth/me')) data = user;
    else if (path.endsWith('/auth/csrf')) data = { headerName: 'X-CSRF', token: 'fixture' };
    else if (path.endsWith('/members')) data = [{ userId: id, displayName: 'Owner fixture', role: 'OWNER' }];
    else if (path === `/api/v1/projects/${id}`) data = project;
    else if (path.endsWith('/projects')) data = route.request().method() === 'POST' ? project : { items: [project], page: 0, size: 20 };
    else if (path.endsWith('/files') && route.request().method() === 'GET') data = { items: [], page: 0, size: 20 };
    else throw new Error(`Unexpected fixture request: ${route.request().method()} ${path}`);
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(page.locator('#workspace-projects .project-tile').first()).toBeVisible();
  await page.getByRole('button', { name: project.name + ' · ' + role, exact: true }).click();
  await page.getByText('Thông tin kỹ thuật dự án', { exact: true }).click(); await expect(page.getByText('Project ID:', { exact: false })).toBeVisible();
  return { user, project };
}
