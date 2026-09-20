import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Browser harness: drives the real app (Vite + Fastify + Neon e2e branch + Clerk dev instance +
 * OpenAI) end to end. The API and web servers run on their own ports so a developer's dev
 * servers on 3001/5173 are untouched.
 */
const API_PORT = 3011;
const WEB_PORT = 5174;
export const E2E_BASE = `http://localhost:${WEB_PORT}`;

if (!process.env.DATABASE_URL_E2E) throw new Error('DATABASE_URL_E2E is required for the e2e harness (a dedicated Neon branch that gets wiped).');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  outputDir: 'e2e/results',
  use: {
    baseURL: E2E_BASE,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(screens|quick-entry)\.spec\.ts/ },
  ],
  webServer: [
    {
      // Seeds the e2e branch (unless E2E_SKIP_SEED=1), then starts the API; /health answers only after both.
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 600_000,
      env: { PORT: String(API_PORT), DATABASE_URL: process.env.DATABASE_URL_E2E!, WEB_ORIGIN: E2E_BASE, NODE_ENV: 'development', E2E_SKIP_SEED: process.env.E2E_SKIP_SEED ?? '' },
    },
    {
      command: 'npm run dev:web',
      url: E2E_BASE,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WEB_PORT: String(WEB_PORT), VITE_API_ORIGIN: `http://localhost:${API_PORT}` },
    },
  ],
});
