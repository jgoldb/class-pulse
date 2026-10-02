import { defineConfig, devices } from '@playwright/test';

// Build apps/web first. No database, real accounts, or model calls are used.
export default defineConfig({
  testDir: './e2e', testMatch: ['pwa.spec.ts', 'pwa-runtime.spec.ts'], timeout: 30000, workers: 1,
  outputDir: 'e2e/results/pwa', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5189', channel: 'msedge', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    { command: `"${process.execPath}" node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 5189 --strictPort`, url: 'http://127.0.0.1:5189', reuseExistingServer: false },
    { command: `"${process.execPath}" node_modules/vite/bin/vite.js --config e2e/pulse-vite.config.ts`, url: 'http://127.0.0.1:5188/e2e/pulse-ui.html', reuseExistingServer: false },
  ],
});
