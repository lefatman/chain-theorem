/**
 * `pnpm dev`: the whole stack locally, no accounts needed (BUILD_PROMPT 8). Starts the Worker with
 * local D1, R2 and Durable Objects (`wrangler dev`, port 8787) and the Vite client (port 5173, which
 * proxies /api and /ws to the Worker). Creates apps/server/.dev.vars with a random AUTH_SECRET on
 * first run. Magic-link emails are printed in this console.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const devVars = `${root}apps/server/.dev.vars`;

if (!existsSync(devVars)) {
  const example = readFileSync(`${root}apps/server/.dev.vars.example`, 'utf8');
  writeFileSync(
    devVars,
    example.replace('replace-with-64-random-hex-characters', randomBytes(32).toString('hex')),
  );
  console.log('dev: created apps/server/.dev.vars with a random AUTH_SECRET');
}

const children: ChildProcess[] = [];
function start(name: string, args: string[]): void {
  const child = spawn('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    // No wrangler telemetry from local development.
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  child.on('exit', (code) => {
    console.log(`dev: ${name} exited with ${code}; stopping`);
    for (const c of children) if (c !== child) c.kill('SIGTERM');
    process.exit(code ?? 0);
  });
  children.push(child);
}

start('worker', [
  '--filter',
  '@chain-theorem/server',
  'exec',
  'wrangler',
  'dev',
  '--port',
  '8787',
  '--ip',
  '127.0.0.1',
  '--persist-to',
  `${root}.wrangler/state`,
]);
start('client', ['--filter', '@chain-theorem/client', 'dev', '--host', '127.0.0.1']);
console.log('dev: open http://localhost:5173 (Worker API on http://127.0.0.1:8787)');

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    for (const c of children) c.kill('SIGTERM');
    process.exit(0);
  });
