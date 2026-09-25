/**
 * `pnpm test:db:pg`: the database suite on PostgreSQL (spec 13.6, R-DATA-004 portability job).
 *
 * 1. TEST_PG_URL set (CI service container): run the suite against it.
 * 2. Otherwise start a throwaway local cluster from PostgreSQL binaries (PG_BIN, or the newest
 *    /usr/lib/postgresql/<version>/bin, or initdb on PATH): initdb into a temp dir, pg_ctl start on a
 *    free port with its unix socket in the temp dir, createdb, run, stop, delete. As root, the
 *    cluster runs as the `postgres` user (initdb refuses to run as root).
 * 3. Otherwise try Docker (`postgres:17`).
 * 4. Otherwise print why it was skipped and exit 0.
 *
 * The suite itself always runs SQLite too; the PostgreSQL variant is selected by TEST_PG_URL.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DB_USER = 'chain';
const DB_NAME = 'chain_test';

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function ok(cmd: string, args: string[], opts: SpawnSyncOptions = {}): boolean {
  const r = run(cmd, args, opts);
  return r.status === 0;
}

function runSuite(url: string): number {
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project', 'db'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TEST_PG_URL: url },
  });
  return r.status ?? 1;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findPgBin(): string | null {
  const fromEnv = process.env.PG_BIN;
  if (fromEnv && existsSync(join(fromEnv, 'initdb'))) return fromEnv;
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => existsSync(join(base, v, 'bin', 'initdb')))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0] !== undefined) return join(base, versions[0], 'bin');
  }
  const pgConfig = run('pg_config', ['--bindir']);
  if (pgConfig.status === 0) {
    const dir = pgConfig.stdout.trim();
    if (existsSync(join(dir, 'initdb'))) return dir;
  }
  return null;
}

/** Runs a cluster command, as the `postgres` user when we are root. */
function asOwner(owner: string | null, cmd: string, args: string[]) {
  if (owner === null) return run(cmd, args);
  if (ok('runuser', ['--help'])) return run('runuser', ['-u', owner, '--', cmd, ...args]);
  const quoted = [cmd, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return run('su', [owner, '-s', '/bin/sh', '-c', quoted]);
}

function check(step: string, r: ReturnType<typeof run>): void {
  if (r.status !== 0) {
    throw new Error(`${step} failed (exit ${r.status}):\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  }
}

async function withLocalCluster(bin: string): Promise<number> {
  const isRoot = process.getuid?.() === 0;
  let owner: string | null = null;
  let uid = -1;
  let gid = -1;
  if (isRoot) {
    const u = run('id', ['-u', 'postgres']);
    const g = run('id', ['-g', 'postgres']);
    if (u.status !== 0 || g.status !== 0) {
      throw new Error('running as root and no `postgres` user exists to own the throwaway cluster');
    }
    owner = 'postgres';
    uid = Number(u.stdout.trim());
    gid = Number(g.stdout.trim());
  }
  const dir = mkdtempSync(join(tmpdir(), 'ct-pg-'));
  if (owner !== null) chownSync(dir, uid, gid);
  const data = join(dir, 'data');
  const port = await freePort();
  let started = false;
  const stop = () => {
    if (started) {
      asOwner(owner, join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
      started = false;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    console.log(
      `test:db:pg: throwaway PostgreSQL cluster from ${bin} on 127.0.0.1:${port} (${dir})`,
    );
    check(
      'initdb',
      asOwner(owner, join(bin, 'initdb'), [
        '-D',
        data,
        '-U',
        DB_USER,
        '-A',
        'trust',
        '-E',
        'UTF8',
        '--locale=C',
        '--no-sync',
      ]),
    );
    const serverOpts = [
      `-p ${port}`,
      `-k ${dir}`,
      '-c listen_addresses=127.0.0.1',
      '-c fsync=off',
      '-c synchronous_commit=off',
      '-c full_page_writes=off',
    ].join(' ');
    check(
      'pg_ctl start',
      asOwner(owner, join(bin, 'pg_ctl'), [
        '-D',
        data,
        '-l',
        join(dir, 'server.log'),
        '-o',
        serverOpts,
        '-w',
        'start',
      ]),
    );
    started = true;
    check(
      'createdb',
      asOwner(owner, join(bin, 'createdb'), [
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        DB_USER,
        DB_NAME,
      ]),
    );
    return runSuite(`postgres://${DB_USER}@127.0.0.1:${port}/${DB_NAME}`);
  } finally {
    stop();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

async function withDocker(): Promise<number> {
  const port = await freePort();
  const started = run('docker', [
    'run',
    '-d',
    '--rm',
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    'POSTGRES_PASSWORD=chain',
    '-e',
    `POSTGRES_DB=${DB_NAME}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    'postgres:17',
  ]);
  check('docker run postgres:17', started);
  const id = started.stdout.trim();
  try {
    console.log(`test:db:pg: PostgreSQL 17 in Docker (${id.slice(0, 12)}) on 127.0.0.1:${port}`);
    // The image's init phase runs a socket-only server; TCP readiness means the real server is up.
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      ready = ok('docker', [
        'exec',
        id,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        DB_USER,
        '-d',
        DB_NAME,
      ]);
      if (!ready) sleep(500);
    }
    if (!ready) throw new Error('PostgreSQL container did not become ready in 60 s');
    return runSuite(`postgres://${DB_USER}:chain@127.0.0.1:${port}/${DB_NAME}`);
  } finally {
    run('docker', ['stop', id]);
  }
}

async function main(): Promise<number> {
  const url = process.env.TEST_PG_URL;
  if (url) {
    console.log('test:db:pg: using TEST_PG_URL');
    return runSuite(url);
  }
  const reasons: string[] = [];
  const bin = findPgBin();
  if (bin) {
    try {
      return await withLocalCluster(bin);
    } catch (err) {
      reasons.push(`local cluster: ${(err as Error).message}`);
    }
  } else {
    reasons.push('no PostgreSQL binaries (set PG_BIN or install postgresql)');
  }
  if (ok('docker', ['info'])) {
    try {
      return await withDocker();
    } catch (err) {
      reasons.push(`docker: ${(err as Error).message}`);
    }
  } else {
    reasons.push('Docker is not available');
  }
  console.log(
    `test:db:pg skipped: no TEST_PG_URL, and no local PostgreSQL could be started.\n  - ${reasons.join('\n  - ')}\n` +
      'The PostgreSQL portability job runs in CI (db-postgres) with TEST_PG_URL.',
  );
  return 0;
}

process.exit(await main());
