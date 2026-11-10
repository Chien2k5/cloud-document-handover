import { test, expect } from '@playwright/test';
import { mockProject } from './fixtures.js';
const file = { id: '20000000-0000-0000-0000-000000000002', fileId: '30000000-0000-0000-0000-000000000003', uploadId: '40000000-0000-0000-0000-000000000004', filename: 'poll.txt', size: 3, versionId: 'exact-v1', uploadStatus: 'AVAILABLE', integrityStatus: 'INTEGRITY_PENDING' };
const panel = page => page.locator('.upload-panel');
async function observeTimers(page) {
  await page.addInitScript(() => { const original = window.setTimeout; window.pollWaits = 0; window.recoveryTimeouts = 0; window.setTimeout = function (callback, delay, ...args) { if (delay === 2000) window.pollWaits++; if (delay === 60000) window.recoveryTimeouts++; return original(callback, delay, ...args); }; });
}
async function upload(page, respond) {
  let reads = 0;
  await page.route('https://s3.example.test/**', route => route.fulfill({ status: 200, headers: { 'x-amz-version-id': file.versionId, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-version-id' } }));
  await mockProject(page, 'OWNER', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/files/uploads')) { await route.fulfill({ json: { uploadId: file.uploadId, fileId: file.fileId, fileVersionId: file.id, presignedUpload: { method: 'PUT', url: 'https://s3.example.test/poll', headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' } } } }); return true; }
    if (p.endsWith('/complete')) { await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: file } }); return true; }
    if (p.endsWith('/uploads/' + file.uploadId)) { reads++; await respond(route, reads); return true; } return false;
  });
  await page.getByLabel('Chọn file', { exact: true }).setInputFiles({ name: file.filename, mimeType: 'text/plain', buffer: Buffer.from('abc') }); await page.getByRole('button', { name: 'Upload & kiểm tra SHA-256', exact: true }).click(); return () => reads;
}

test('C09.07D: default upload poll performs exactly 15 reads, waits 2 seconds and stops without automatic restart', async ({ page }) => {
  await page.clock.install(); await observeTimers(page);
  const reads = await upload(page, route => route.fulfill({ json: { uploadId: file.uploadId, fileVersion: file } }));
  await expect.poll(reads).toBe(1);
  for (let index = 0; index < 14; index++) { await expect.poll(() => page.evaluate(() => window.pollWaits)).toBe(index + 1); await page.clock.fastForward(2000); await expect.poll(reads).toBe(index + 2); }
  await expect(panel(page).getByRole('status')).toContainText('Đã dừng tự kiểm tra sau 15 lần'); await page.clock.fastForward(120000); expect(reads()).toBe(15); await expect(panel(page).getByText('VERIFIED', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Kiểm tra lại upload', exact: true })).toBeEnabled();
});

test('C09.07D: FAILED stops automatic polling; explicit status check accepts a later valid result', async ({ page }) => {
  const reads = await upload(page, (route, read) => route.fulfill({ json: { uploadId: file.uploadId, fileVersion: { ...file, integrityStatus: read === 1 ? 'FAILED' : 'VERIFIED' } } }));
  await expect(panel(page).getByText('FAILED', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Kiểm tra lại upload', exact: true })).toBeEnabled(); expect(reads()).toBe(1);
  await page.getByRole('button', { name: 'Kiểm tra lại upload', exact: true }).click(); await expect(panel(page).getByText('VERIFIED', { exact: true })).toBeVisible(); expect(reads()).toBe(2);
});

test('C09.07D: cancel during a poll ignores a late VERIFIED response and retains the last observed pending state', async ({ page }) => {
  let release, returned; const pending = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { returned = resolve; });
  try {
    const reads = await upload(page, async route => { await pending; await route.fulfill({ json: { uploadId: file.uploadId, fileVersion: { ...file, integrityStatus: 'VERIFIED' } } }); returned(); });
    await expect.poll(reads).toBe(1); await page.getByRole('button', { name: 'Dừng chờ', exact: true }).click(); await expect(panel(page).getByRole('status')).toContainText('Đã dừng chờ'); release(); await done;
    await expect(panel(page).getByText('INTEGRITY_PENDING', { exact: true })).toBeVisible(); await expect(panel(page).getByText('VERIFIED', { exact: true })).toHaveCount(0); expect(reads()).toBe(1);
  } finally { release(); }
});

function versions(count) { return Array.from({ length: count }, (_, i) => ({ ...file, id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, uploadId: `40000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, filename: `recovery-${i + 1}.txt` })); }
test('C09.07D: list recovery has at most three version reads in flight and starts the fourth only after one finishes', async ({ page }) => {
  const items = versions(4), releases = [], gates = items.map((_file, i) => new Promise(resolve => { releases[i] = resolve; })); let active = 0, peak = 0; const reads = [];
  try {
    await mockProject(page, 'VIEWER', async route => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/files')) { await route.fulfill({ json: { items, page: 0, size: 20 } }); return true; }
      const index = items.findIndex(item => p.endsWith('/uploads/' + item.uploadId)); if (index < 0) return false;
      reads.push(items[index].uploadId); active++; peak = Math.max(peak, active); await gates[index]; active--; await route.fulfill({ json: { uploadId: items[index].uploadId, fileVersion: { ...items[index], integrityStatus: 'VERIFIED' } } }); return true;
    });
    await expect.poll(() => reads.length).toBe(3); expect(peak).toBe(3); releases[0](); await expect.poll(() => reads.length).toBe(4); expect(peak).toBe(3); releases.forEach(release => release()); await expect(page.locator('.files-section [data-stage="integrity"][data-state="VERIFIED"]')).toHaveCount(4); expect(new Set(reads).size).toBe(4);
  } finally { releases.forEach(release => release()); }
});

test('C09.07D: multi-batch list recovery stops at the original 60-second bound, never polling forever', async ({ page }) => {
  // Freeze wall-clock drift between assertions so the exact 60s boundary is deterministic.
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') }); await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
  await observeTimers(page); const items = versions(7); let reads = 0;
  await mockProject(page, 'VIEWER', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/files')) { await route.fulfill({ json: { items, page: 0, size: 20 } }); return true; }
    const item = items.find(value => p.endsWith('/uploads/' + value.uploadId)); if (!item) return false;
    reads++; await route.fulfill({ json: { uploadId: item.uploadId, fileVersion: item } }); return true;
  });
  await expect.poll(() => reads).toBe(3); await expect.poll(() => page.evaluate(() => window.recoveryTimeouts)).toBe(1);
  for (let batch = 0; batch < 2; batch++) for (let tick = 0; tick < 14; tick++) {
    await expect.poll(() => page.evaluate(() => window.pollWaits)).toBeGreaterThanOrEqual(batch * 42 + (tick + 1) * 3);
    await page.clock.fastForward(2000); const expected = tick < 13 ? batch * 45 + (tick + 2) * 3 : batch === 0 ? 48 : 91; await expect.poll(() => reads).toBe(expected);
  }
  await expect.poll(() => page.evaluate(() => window.pollWaits)).toBe(85); await page.clock.fastForward(2000); await expect.poll(() => reads).toBe(92); await expect.poll(() => page.evaluate(() => window.pollWaits)).toBe(86); await page.clock.fastForward(2000);
  await expect(page.locator('.file-polling')).toHaveCount(0); const stopped = reads; await page.clock.fastForward(120000); expect(reads).toBe(stopped); expect(stopped).toBe(92); await expect(page.locator('.files-section [data-state="VERIFIED"]')).toHaveCount(0);
});
