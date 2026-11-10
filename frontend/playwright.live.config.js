import { defineConfig } from '@playwright/test';
if (!process.env.LIVE_BASE_URL || !process.env.LIVE_DEMO_PASSWORD || !process.env.API_PROXY_TARGET) {
  throw new Error('Use python tools/run_live_check.py to create isolated backend/DB and supply live test environment.');
}
const port = new URL(process.env.LIVE_BASE_URL).port;
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.live.spec.js', workers: 1, retries: 0, timeout: 60000,
  reporter: [['list']], outputDir: 'test-results/live',
  use: { baseURL: process.env.LIVE_BASE_URL, channel: process.env.PW_CHANNEL || 'chrome', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: `npm run dev -- --port ${port}`, url: process.env.LIVE_BASE_URL, reuseExistingServer: false, timeout: 30000 },
});
