/**
 * Playwright end-to-end layer (spec 17.1, R-TEST-001) for local play (M3): title screen, every
 * format against every NPC tier, hot-seat, resign, loadout builder and settings.
 *
 * `pnpm test:e2e` builds the production client and serves it with `vite preview` (webServer below),
 * so the suite always runs against the same bundle players get, with Phaser lazy-loaded (12.3).
 * Moves are made by clicking squares on the board canvas (e2e/helpers.ts).
 * The preinstalled Chromium is used when present (no `playwright install` needed there); otherwise
 * Playwright's own Chromium is used (install it with `pnpm --filter @chain-theorem/client exec
 * playwright install chromium`); PW_CHROMIUM_PATH overrides the binary. Set PW_REUSE_SERVER=1 to
 * reuse a preview server already running on port 4174 (skips the build; make sure it is fresh).
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const HOST = '127.0.0.1';
// The suite builds into its own directory so a concurrent `vite build` (dev, other tools) cannot
// swap hashed chunks under a running test; node_modules keeps it out of git, ESLint and Prettier.
const OUT_DIR = 'node_modules/.cache/e2e-dist';
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  // Deterministic by design: no retries, so a flaky step shows up as a failure.
  retries: 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
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
  webServer: {
    // Build first so the suite never runs against a stale bundle.
    // VITE_OFFLINE=1: this suite covers local play only and runs without the Worker (online e2e
    // runs against `wrangler dev`, see e2e-online).
    command: `VITE_OFFLINE=1 pnpm --filter @chain-theorem/client build --outDir ${OUT_DIR} && pnpm --filter @chain-theorem/client preview --outDir ${OUT_DIR} --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
