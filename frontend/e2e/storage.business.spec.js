import { test, expect } from '@playwright/test';
import { workspaceView } from './fixtures.js';

async function login(page, email = 'dung@example.test') {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.LIVE_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  return (await (await page.request.get('/api/v1/auth/me')).json()).id;
}
async function mutate(page, path, data) {
  const csrf = await (await page.request.get('/api/v1/auth/csrf')).json();
  return page.request.post('/api/v1' + path, { headers: { [csrf.headerName]: csrf.token }, ...(data === undefined ? {} : { data }) });
}
async function project(page, name) {
  await workspaceView(page, 'Dự án');
  await page.getByText('Tạo dự án mới', { exact: true }).click();
  await page.getByLabel('Tên dự án', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
  await page.locator('#project-overview').getByText('Thông tin kỹ thuật dự án', { exact: true }).click(); await expect(page.locator('#project-overview').getByText('Project ID:', { exact: false })).toBeVisible();
  return (await (await page.request.get('/api/v1/projects')).json()).items.find(item => item.name === name).id;
}
async function upload(page, projectId, buffer, count, verifiedCount = count) {
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: 'fixture.bin', mimeType: 'application/octet-stream', buffer });
  await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' }).click();
  await expect(page.getByRole('button', { name: 'Upload & kiểm tra SHA-256' })).toBeDisabled();
  await expect(page.getByLabel('Chọn file', { exact: true })).toBeEnabled({ timeout: 30000 });
  const files = (await (await page.request.get(`/api/v1/projects/${projectId}/files`)).json()).items;
  expect(files).toHaveLength(count);
  expect(files.filter(file => file.integrityStatus === 'VERIFIED' && file.uploadStatus === 'AVAILABLE')).toHaveLength(verifiedCount);
  return files;
}
async function open(page, id) {
  await workspaceView(page, 'Mở gói bàn giao');
  await page.getByLabel('UUID gói bàn giao', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Mở gói bàn giao', exact: true }).click();
}
async function capture(page, label, testInfo, selector) {
  const original = page.viewportSize();
  try {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 1000 });
      await page.locator(selector).evaluate(target => { document.activeElement?.blur(); window.scrollTo(0, scrollY + target.getBoundingClientRect().top - document.querySelector('.app-header').getBoundingClientRect().height - 20); });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`real-backend-storage-${label}-${width}.png`) });
    }
  } finally { if (original) await page.setViewportSize(original); }
}

test('real backend + test HTTPS storage: v1 survives v2, two recipients confirm, download bytes and revoke', async ({ page, browser }, testInfo) => {
  const contexts = await Promise.all([browser.newContext({ baseURL: process.env.LIVE_BASE_URL, ignoreHTTPSErrors: true }),
    browser.newContext({ baseURL: process.env.LIVE_BASE_URL, ignoreHTTPSErrors: true })]);
  try {
    const first = await contexts[0].newPage(), second = await contexts[1].newPage();
    const firstId = await login(first, 'viewer@example.test'), secondId = await login(second, 'editor@example.test');
    await login(page); const id = await project(page, 'Business version handover');
    const original = Buffer.from([0, 255, 128, 13, 10, 42]);
    const [v1] = await upload(page, id, original, 1);
    await page.reload(); await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Business version handover · OWNER' }).click();
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm phiên bản fixture.bin' }).click();
    const files = await upload(page, id, Buffer.from('different-v2'), 2);
    const v2 = files.find(file => file.id !== v1.id);
    expect(v2.fileId).toBe(v1.fileId); expect(v2.versionId).not.toBe(v1.versionId);
    await page.getByLabel(`Chọn bàn giao fixture.bin · ${v1.id}`, { exact: true }).check();
    await page.getByLabel('Tiêu đề bàn giao', { exact: true }).fill('Pinned v1 package');
    await page.getByLabel('UUID người nhận', { exact: true }).fill(`${firstId}, ${secondId}`);
    await page.getByLabel('Hạn bàn giao (giờ trên máy bạn)', { exact: true }).fill('2099-01-01T12:00');
    await capture(page, 'owner-draft', testInfo, '.draft-panel');
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/projects/${id}/handovers`));
    await page.getByRole('button', { name: 'Tạo DRAFT', exact: true }).click();
    const created = await createdResponse; expect(created.status()).toBe(201); const handover = await created.json();
    expect(handover.items.map(item => item.fileVersionId)).toEqual([v1.id]);
    await page.getByRole('button', { name: 'Phát hành gói' }).click();
    await expect(page.getByText('READY', { exact: true })).toBeVisible();
    await capture(page, 'owner-manifest', testInfo, '.handover');
    await open(first, handover.id);
    await first.getByRole('button', { name: 'Xác nhận nhận bàn giao' }).click();
    await expect(first.getByText('READY', { exact: true })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Xác nhận nhận bàn giao' })).toHaveCount(0);
    await capture(first, 'external-recipient', testInfo, '.handover');
    await open(second, handover.id);
    await second.getByRole('button', { name: 'Xác nhận nhận bàn giao' }).click();
    await expect(second.getByText('CONFIRMED', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Lấy link tải item fixture.bin' }).click();
    const link = second.getByRole('link', { name: 'Tải item đúng phiên bản' });
    await expect(link).toBeVisible();
    const downloaded = await second.evaluate(async url => {
      const response = await fetch(url, { credentials: 'omit' });
      return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    }, await link.getAttribute('href'));
    expect(downloaded.status).toBe(200); expect(downloaded.bytes).toEqual([...original]);
    await page.getByRole('button', { name: 'Thu hồi gói' }).click();
    await expect(page.getByText('REVOKED', { exact: true })).toBeVisible();
    const blocked = await second.request.get(`/api/v1/handovers/${handover.id}/items/${v1.id}/download`);
    expect(blocked.status()).toBe(409); expect((await blocked.json()).code).toBe('HANDOVER_REVOKED');
    const preserved = await (await page.request.get(`/api/v1/handovers/${handover.id}`)).json();
    expect(preserved.status).toBe('CONFIRMED'); expect(preserved.recipients.every(person => person.confirmedAt)).toBe(true);

    // Acceptance flows B/C: separate membership project; the original recipients remain external to the handover project.
    const roleProject = await project(page, 'Acceptance Editor Viewer');
    const ownerCsrf = await (await page.request.get('/api/v1/auth/csrf')).json();
    for (const [userId, role] of [[secondId, 'EDITOR'], [firstId, 'VIEWER']]) {
      const granted = await page.request.put(`/api/v1/projects/${roleProject}/members/${userId}`, { headers: { [ownerCsrf.headerName]: ownerCsrf.token }, data: { role } }); expect(granted.status()).toBe(200);
    }
    for (const [actorPage, role] of [[second, 'EDITOR'], [first, 'VIEWER']]) {
      await workspaceView(actorPage, 'Dự án'); await actorPage.getByRole('button', { name: 'Tải lại dự án', exact: true }).click();
      await actorPage.getByRole('button', { name: `Acceptance Editor Viewer · ${role}`, exact: true }).click(); await workspaceView(actorPage, 'Tài liệu');
      await expect(actorPage.getByRole('button', { name: 'Lưu thành viên', exact: true })).toHaveCount(0); await expect(actorPage.getByRole('button', { name: 'Tạo DRAFT', exact: true })).toHaveCount(0);
    }
    const editorBytes = Buffer.from([0, 17, 255, 128, 13, 10]);
    const [editorV1] = await upload(second, roleProject, editorBytes, 1);
    await second.getByRole('button', { name: 'Thêm phiên bản fixture.bin', exact: true }).click(); const editorFiles = await upload(second, roleProject, Buffer.from('editor-v2'), 2);
    const editorV2 = editorFiles.find(item => item.id !== editorV1.id); expect(editorV2.fileId).toBe(editorV1.fileId); expect(editorV2.versionId).not.toBe(editorV1.versionId);
    for (const actorPage of [second, first]) {
      await actorPage.getByRole('button', { name: 'Tải lại danh sách file', exact: true }).click();
      const row = actorPage.locator(`[data-file-version-id="${editorV1.id}"]`); await expect(row.getByText('VERIFIED', { exact: true })).toBeVisible(); await row.getByRole('button', { name: 'Lấy link tải fixture.bin', exact: true }).click();
      const versionLink = row.getByRole('link', { name: 'Tải phiên bản đã chọn', exact: true }); await expect(versionLink).toBeVisible();
      const result = await actorPage.evaluate(async url => { const response = await fetch(url, { credentials: 'omit' }); return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] }; }, await versionLink.getAttribute('href'));
      expect(result.status).toBe(200); expect(result.bytes).toEqual([...editorBytes]);
    }
    await expect(first.getByLabel('Chọn file', { exact: true })).toHaveCount(0); await expect(first.getByRole('button', { name: /^Thêm phiên bản / })).toHaveCount(0);
    const ownerDraft = await mutate(page, `/projects/${roleProject}/handovers`, { title: 'Role boundary', fileVersionIds: [editorV1.id], recipientUserIds: [firstId], expiresAt: '2099-01-01T12:00:00Z' }); expect(ownerDraft.status()).toBe(201); const roleHandover = await ownerDraft.json();
    expect((await mutate(second, `/handovers/${roleHandover.id}/publish`)).status()).toBe(403);
    expect((await mutate(first, `/projects/${roleProject}/files/uploads`, { filename: 'forbidden.txt', contentType: 'text/plain', size: 1, expectedSha256: 'a'.repeat(64) })).status()).toBe(403);
    expect((await mutate(first, `/projects/${roleProject}/handovers`, { title: 'Forbidden', fileVersionIds: [editorV1.id], recipientUserIds: [firstId], expiresAt: '2099-01-01T12:00:00Z' })).status()).toBe(403);
    for (const actorPage of [second, first]) {
      const csrf = await (await actorPage.request.get('/api/v1/auth/csrf')).json(); const denied = await actorPage.request.put(`/api/v1/projects/${roleProject}/members/${firstId}`, { headers: { [csrf.headerName]: csrf.token }, data: { role: 'EDITOR' } }); expect(denied.status()).toBe(403);
    }
    await capture(second, 'editor-files', testInfo, '.files-section'); await capture(first, 'viewer-files', testInfo, '.files-section');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('real backend + test HTTPS storage: mismatched hash cannot enter DRAFT; expiry blocks new links', async ({ page }) => {
  const actor = await login(page), id = await project(page, 'Business mismatch expiry');
  const initialized = await mutate(page, `/projects/${id}/files/uploads`, { filename: 'bad.bin', contentType: 'application/octet-stream', size: 3, expectedSha256: '0'.repeat(64) });
  expect(initialized.status()).toBe(201); const init = await initialized.json();
  const put = await page.evaluate(async signed => {
    const response = await fetch(signed.url, { method: 'PUT', credentials: 'omit', headers: signed.headers, body: new Uint8Array([97, 98, 99]) });
    return { status: response.status, version: response.headers.get('x-amz-version-id') };
  }, init.presignedUpload);
  expect(put.status).toBe(200);
  expect((await mutate(page, `/projects/${id}/files/uploads/${init.uploadId}/complete`, { versionId: put.version })).status()).toBe(200);
  await page.reload(); await workspaceView(page, 'Dự án'); await page.getByRole('button', { name: 'Business mismatch expiry · OWNER' }).click();
  await expect(page.getByText('MISMATCH', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel(`Chọn bàn giao bad.bin · ${init.fileVersionId}`, { exact: true })).toBeDisabled();
  const invalid = await mutate(page, `/projects/${id}/handovers`, { title: 'Blocked', fileVersionIds: [init.fileVersionId], recipientUserIds: [actor], expiresAt: '2099-01-01T12:00:00Z' });
  expect(invalid.status()).toBe(409); expect((await invalid.json()).code).toBe('FILE_NOT_VERIFIED');
  const all = await upload(page, id, Buffer.from('valid-for-expiry'), 2, 1);
  const valid = all.find(file => file.filename === 'fixture.bin');
  const expiring = await mutate(page, `/projects/${id}/handovers`, { title: 'Short expiry', fileVersionIds: [valid.id], recipientUserIds: [actor], expiresAt: new Date(Date.now() + 2500).toISOString() });
  expect(expiring.status()).toBe(201); const handover = await expiring.json();
  expect((await mutate(page, `/handovers/${handover.id}/publish`)).status()).toBe(200);
  await expect.poll(async () => (await page.request.get(`/api/v1/handovers/${handover.id}/items/${valid.id}/download`)).status()).toBe(409);
  const expired = await page.request.get(`/api/v1/handovers/${handover.id}/items/${valid.id}/download`);
  expect((await expired.json()).code).toBe('HANDOVER_EXPIRED');
});
