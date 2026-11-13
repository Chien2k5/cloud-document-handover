import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';

test('C09.01: loading and semantic submit button retain login encoding and prevent disabled clicks', async ({ page }) => {
  let releaseMe, releaseLogin, writes = 0, loggedIn = false;
  const meGate = new Promise(resolve => { releaseMe = resolve; }), loginGate = new Promise(resolve => { releaseLogin = resolve; });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/csrf')) return route.fulfill({ json: { headerName: 'X-CSRF', token: loggedIn ? 'after' : 'before' } });
    if (path.endsWith('/login')) {
      writes++; expect(route.request().headers()['content-type']).toContain('application/x-www-form-urlencoded');
      expect(new URLSearchParams(route.request().postData()).get('email')).toBe('fixture@example.test');
      expect(route.request().headers()['x-csrf']).toBe('before');
      await loginGate; loggedIn = true; return route.fulfill({ json: { id: 'account', displayName: 'Fixture', email: 'fixture@example.test' } });
    }
    if (path.endsWith('/me')) { if (!loggedIn) { await meGate; return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }); } return route.fulfill({ json: { id: 'account', displayName: 'Fixture', email: 'fixture@example.test' } }); }
    return route.fulfill({ json: { items: [], page: 0, size: 20 } });
  });
  try {
    await page.goto('/'); await expect(page.getByRole('status')).toHaveText('Đang kiểm tra phiên đăng nhập…');
    releaseMe();
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-only');
    const submit = page.getByRole('button', { name: 'Đăng nhập', exact: true });
    await expect(submit).toHaveAttribute('type', 'submit'); await submit.click();
    const pending = page.getByRole('button', { name: 'Đang đăng nhập…', exact: true }); await expect(pending).toBeDisabled();
    await expect.poll(() => writes).toBe(1);
    await pending.evaluate(element => element.click()); expect(writes).toBe(1);
    releaseLogin(); await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible(); expect(writes).toBe(1);
  } finally { releaseMe(); releaseLogin(); }
});

test('C09.01: shared pagination buttons use non-submit semantics', async ({ page }) => {
  await mockProject(page);
  const buttons = page.getByRole('navigation', { name: 'Phân trang', exact: true }).getByRole('button');
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) await expect(button).toHaveAttribute('type', 'button');
});
