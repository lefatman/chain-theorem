/**
 * Builds the production client (online build) into apps/client/dist and starts `wrangler dev` on
 * port 8788 with fresh local storage. The Worker's console (where magic links are printed by the
 * console mail sender) goes to a log file the tests read. Returns the teardown.
 */
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname;
const PORT = Number(process.env.CT_ONLINE_PORT) || 8788;
export const LOG_ENV = 'CT_WORKER_LOG';

async function waitUp(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`worker did not start at ${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  execSync('pnpm --filter @chain-theorem/client build', { cwd: ROOT, stdio: 'inherit' });
  const dir = mkdtempSync(join(tmpdir(), 'ct-online-'));
  const log = join(dir, 'worker.log');
  process.env[LOG_ENV] = log;
  const out = openSync(log, 'a');
  const origin = `http://127.0.0.1:${PORT}`;
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@chain-theorem/server',
      'exec',
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--local',
      '--persist-to',
      join(dir, 'state'),
      '--var',
      `APP_ORIGIN:${origin}`,
      '--var',
      'AUTH_SECRET:e2e-online-secret-0123456789abcdef0123456789abcdef',
      '--var',
      'MAIL_MODE:console',
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', out, out],
      detached: true,
      env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  await waitUp(`${origin}/api/me`, 120_000);
  return async () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dir, { recursive: true, force: true });
  };
}
