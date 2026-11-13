import { defineConfig } from '@playwright/test';
const port = Number(process.env.PW_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PW_PORT must be a valid local test port');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', testIgnore: ['**/*.live.spec.js', '**/*.business.spec.js'], fullyParallel: false, workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL, channel: process.env.PW_CHANNEL || 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, timeout: 30000 },
});
