import { defineConfig } from '@playwright/test';
if (!process.env.RUN_BUSINESS_E2E_TEST_HARNESS || !process.env.LIVE_BASE_URL || !process.env.LIVE_DEMO_PASSWORD || !process.env.API_PROXY_TARGET) {
  throw new Error('Use python tools/run_live_check.py --business with a disposable database.');
}
const port = new URL(process.env.LIVE_BASE_URL).port;
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.business.spec.js', workers: 1, retries: 0, timeout: 120000,
  reporter: [['list']], outputDir: 'test-results/business',
  use: { baseURL: process.env.LIVE_BASE_URL, channel: process.env.PW_CHANNEL || 'chrome',
    ignoreHTTPSErrors: true, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: `npm run dev -- --port ${port}`, url: process.env.LIVE_BASE_URL, reuseExistingServer: false, timeout: 30000 },
});
