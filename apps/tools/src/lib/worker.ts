/**
 * Start the real Worker locally (`wrangler dev`: local D1, R2 and Durable Objects) on a free port with
 * fresh state, capture its console (magic links from the console mail sender) and sign accounts up
 * through the real REST flow. Used by the load test (and usable by other tools).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../../../', import.meta.url).pathname;

export interface LocalWorker {
  origin: string;
  log: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export async function startWorker(
  opts: { build?: boolean; vars?: Record<string, string> } = {},
): Promise<LocalWorker> {
  const port = await freePort();
  // wrangler serves the client build as static assets; the folder must exist even when unbuilt.
  mkdirSync(join(ROOT, 'apps/client/dist'), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'ct-worker-'));
  const log = join(dir, 'worker.log');
  const out = openSync(log, 'a');
  const origin = `http://127.0.0.1:${port}`;
  if (opts.build) {
    const b = spawn('pnpm', ['--filter', '@chain-theorem/client', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    await new Promise((r) => b.on('exit', r));
  }
  const child: ChildProcess = spawn(
    'pnpm',
    [
      '--filter',
      '@chain-theorem/server',
      'exec',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--local',
      '--persist-to',
      join(dir, 'state'),
      '--var',
      `APP_ORIGIN:${origin}`,
      '--var',
      'AUTH_SECRET:local-tool-secret-0123456789abcdef0123456789abcdef',
      '--var',
      'MAIL_MODE:console',
      ...Object.entries(opts.vars ?? {}).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', out, out],
      detached: true,
      env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  const until = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`${origin}/api/me`)).ok) break;
    } catch {
      /* starting */
    }
    if (Date.now() > until) throw new Error(`worker did not start; see ${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    origin,
    log,
    async stop() {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
      await new Promise((r) => setTimeout(r, 500));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Sign up through the magic-link flow; returns the session cookie. */
export async function signUp(
  w: LocalWorker,
  email: string,
  name: string,
  dob = '1995-05-05',
): Promise<{ cookie: string; id: string }> {
  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(`${w.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const start = await post('/api/auth/start', { email });
  if (!start.ok) throw new Error(`auth/start ${start.status}`);
  let token = '';
  for (let i = 0; i < 100 && !token; i++) {
    const text = readFileSync(w.log, 'utf8');
    const at = text.lastIndexOf(`[mail] to ${email}`);
    token = at >= 0 ? decodeURIComponent(/token=([\w%-]+)/.exec(text.slice(at))?.[1] ?? '') : '';
    if (!token) await new Promise((r) => setTimeout(r, 100));
  }
  const verify = (await (await post('/api/auth/verify', { token })).json()) as {
    status: string;
    signup?: string;
  };
  if (verify.status !== 'needs_profile' || !verify.signup)
    throw new Error(`verify: ${JSON.stringify(verify)}`);
  const done = await post('/api/auth/complete', { signup: verify.signup, name, dob });
  const cookie = (done.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const me = (await done.json()) as { me?: { id: string } };
  if (!cookie || !me.me) throw new Error(`complete ${done.status}`);
  return { cookie, id: me.me.id };
}
