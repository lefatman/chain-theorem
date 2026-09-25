/**
 * Online end-to-end layer (M4 done-when, spec 16): the production client served by the real Worker
 * (`wrangler dev`: local D1, R2 and Durable Objects), two browser contexts playing a timed battle
 * with a disconnect and a reconnect, and an R-SEC-001 scan of every WebSocket frame each browser
 * receives. `pnpm test:e2e:online` builds the client and starts the Worker in e2e-online/setup.ts.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/** `CT_ONLINE_PORT` lets several runs share a machine (default 8788). */
export const ONLINE_PORT = Number(process.env.CT_ONLINE_PORT) || 8788;
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e-online',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-online' }]]
    : [['list']],
  globalSetup: './e2e-online/setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${ONLINE_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
