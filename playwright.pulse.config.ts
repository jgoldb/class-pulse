import { defineConfig, devices } from '@playwright/test';
// Synthetic component tests with intercepted network; never load .env or reset a database.
export default defineConfig({
  testDir: './e2e', testMatch: ['pulsera-ui.spec.ts', 'teacher-workspace.spec.ts'], timeout: 30000, workers: 1,
  outputDir: 'e2e/results/pulsera', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5188', channel: 'msedge', screenshot: 'only-on-failure' },
  projects: [ { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } }, { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } }, { name: 'phone', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } } ],
  webServer: { command: `"${process.execPath}" node_modules/vite/bin/vite.js --config e2e/pulse-vite.config.ts`, url: 'http://127.0.0.1:5188/e2e/pulse-ui.html', reuseExistingServer: false },
});
