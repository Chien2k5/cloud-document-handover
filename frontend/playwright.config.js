import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testIgnore: ['**/*.live.spec.js', '**/*.business.spec.js'], fullyParallel: false, workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173', channel: process.env.PW_CHANNEL || 'chrome', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 30000 },
});
