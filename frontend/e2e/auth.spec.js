import { test, expect } from '@playwright/test';
test('mock backend: login/logout UI and rotated CSRF', async ({ page }) => {
  let loggedIn = false, token = 'before';
  const user = { id: 'owner-fixture', displayName: 'Owner fixture', email: 'owner@example.test' };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/csrf')) return route.fulfill({ json: { headerName: 'X-Fixture-CSRF', token } });
    if (path.endsWith('/login')) {
      expect(request.headers()['x-fixture-csrf']).toBe('before');
      expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
      expect(new URLSearchParams(request.postData()).get('email')).toBe(user.email);
      loggedIn = true; token = 'after'; return route.fulfill({ json: user });
    }
    if (path.endsWith('/logout')) { expect(request.headers()['x-fixture-csrf']).toBe('after'); loggedIn = false; token = 'out'; return route.fulfill({ status: 204 }); }
    if (path.endsWith('/me')) return route.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? user : { code: 'UNAUTHENTICATED' } });
    return route.fulfill({ json: path.endsWith('/projects') ? { items: [], page: 0, size: 20 } : [] });
  });
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
});
test('mock backend: wrong password does not reveal protected UI', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(path.endsWith('/csrf') ? { json: { headerName: 'X-CSRF', token: 'fixture' } } : { status: 401, json: { code: path.endsWith('/login') ? 'INVALID_CREDENTIALS' : 'UNAUTHENTICATED' } });
  });
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-fixture');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng');
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toHaveCount(0);
});
