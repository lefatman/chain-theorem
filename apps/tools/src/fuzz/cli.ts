/**
 * `pnpm test:fuzz` (quick, CI) and `pnpm test:fuzz:full` (100,000 games) — M2 done-when:
 * fuzzed games with random loadouts finish with no crash, no unbounded chain and identical replays.
 * The R-SEC-001 payload scan (both players' projections and the spectator projection, M7 7.2) runs on
 * every game in quick mode and on 10,000 games in full mode (release checklist 17.3). Runs on worker
 * threads; exits 1 on any failure.
 *
 *   tsx apps/tools/src/fuzz/cli.ts --games N [--seed S] [--workers W] [--max-plies P] [--scan-every K]
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { engine } from '@chain-theorem/content';
import { fuzzGame, type FuzzGameResult } from './game.ts';

interface Job {
  seeds: number[];
  maxPlies: number;
  scanEvery: number;
}

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
}

if (!isMainThread) {
  const job = workerData as Job;
  const results: FuzzGameResult[] = [];
  for (const seed of job.seeds) {
    const r = fuzzGame(engine, seed, {
      maxPlies: job.maxPlies,
      scanProjection: seed % job.scanEvery === 0,
      checkReplay: true,
    });
    results.push(r);
    if (results.length % 100 === 0) parentPort?.postMessage({ progress: 100 });
  }
  parentPort?.postMessage({ done: results.map((r) => ({ ...r, failure: r.failure })) });
} else {
  const games = arg('games', 500);
  const seed0 = arg('seed', 1);
  const maxPlies = arg('max-plies', 300);
  const scanEvery = arg('scan-every', games > 20_000 ? 10 : 1);
  const workers = Math.max(
    1,
    Math.min(arg('workers', Math.max(1, availableParallelism() - 1)), games),
  );
  const t0 = performance.now();
  const seeds = Array.from({ length: games }, (_, i) => seed0 + i);
  const chunks: number[][] = Array.from({ length: workers }, () => []);
  seeds.forEach((s, i) => chunks[i % workers]?.push(s));
  let progress = 0;
  const all: FuzzGameResult[] = [];
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: { seeds: chunk, maxPlies, scanEvery } satisfies Job,
            execArgv: [
              ...process.execArgv.filter((a) => a !== '--import' && a !== 'tsx'),
              '--import',
              'tsx',
            ],
          });
          w.on('message', (m: { progress?: number; done?: FuzzGameResult[] }) => {
            if (m.progress) {
              progress += m.progress;
              if (games >= 2000 && progress % 2000 === 0) {
                const rate = progress / ((performance.now() - t0) / 1000);
                console.log(`  ${progress}/${games} games (${rate.toFixed(0)}/s)`);
              }
            }
            if (m.done) {
              all.push(...m.done);
              resolve();
            }
          });
          w.on('error', reject);
          w.on('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited with ${code}`));
          });
        }),
    ),
  );
  const secs = (performance.now() - t0) / 1000;
  const failures = all.filter((r) => r.failure);
  const capped = all.filter((r) => r.capped).length;
  const scanned = all.filter((r) => r.scanned).length;
  const plies = all.reduce((s, r) => s + r.plies, 0);
  const maxChain = Math.max(...all.map((r) => r.maxChain));
  const reasons = new Map<string, number>();
  for (const r of all) reasons.set(r.result, (reasons.get(r.result) ?? 0) + 1);
  const summary = {
    games,
    seeds: [seed0, seed0 + games - 1],
    seconds: Number(secs.toFixed(1)),
    plies,
    failures: failures.length,
    capped,
    projectionScanned: scanned,
    maxEventsInOneAction: maxChain,
    results: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
  };
  mkdirSync('reports', { recursive: true });
  writeFileSync(
    `reports/fuzz-${games}.json`,
    JSON.stringify({ summary, failures: failures.slice(0, 50) }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  for (const f of failures.slice(0, 5)) console.error(`seed ${f.seed}: ${f.failure}`);
  if (failures.length > 0) {
    console.error(`fuzz FAILED: ${failures.length}/${games} games (reports/fuzz-${games}.json)`);
    process.exit(1);
  }
  console.log(
    `fuzz ok: ${games} games, ${plies} plies, replays identical, ${scanned} projection-scanned (players and spectators), no crash, max ${maxChain} events per action`,
  );
}
