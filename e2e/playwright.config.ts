import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const PORT = process.env.PORT ?? '3020';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const STORAGE_STATE = resolve(__dirname, '.auth/user.json');
const WEB_SERVER_SCRIPT = resolve(__dirname, 'web-server.ts');

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: resolve(__dirname, 'global-setup.ts'),
  // The suite runs against `next dev`, which compiles routes on demand. On a
  // cold start the first hit to each page/API route is slow, so the default 30s
  // test / 5s expect budgets flake. Be generous — these absorb cold-compile
  // latency without masking genuinely hung tests.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry locally too: cold-compile contention is inherently racy against a
  // dev server, and a single retry hits warm routes and stabilizes the run.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: [/.*\.setup\.ts/, /.*unauth\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-unauth',
      testMatch: /.*unauth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `tsx ${JSON.stringify(WEB_SERVER_SCRIPT)} --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
