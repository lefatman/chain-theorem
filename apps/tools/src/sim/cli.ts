/**
 * `pnpm sim` — balance simulator (M3 step 3.4, R-TEST-002). AI versus AI across loadouts; prints and
 * writes matchup tables: win rates per element matchup and per build archetype, white win rate,
 * surprise losses and battle lengths, compared with the 17.2 targets.
 *
 *   pnpm sim [--games N] [--format first_blood|vanguard|full] [--tier wild|trainer|elite]
 *            [--nodes K] [--workers W] [--suite elements|archetypes|all] [--seed S]
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CAPS, engine } from '@chain-theorem/content';
import { beats, type ElementId, type FormatId, type Side } from '@chain-theorem/rules';
import type { Tier } from '@chain-theorem/ai';
import { ARCHETYPES, assertValid, buildLoadout, elementLoadout } from './builds.ts';
import { playSim, type SimGame, type SimOutcome } from './play.ts';

interface Job {
  suite: 'elements' | 'archetypes';
  a: string;
  b: string;
  /** Which of a/b plays white. */
  aWhite: boolean;
  game: SimGame;
}
interface Done {
  job: Omit<Job, 'game'> & { format: FormatId };
  out: SimOutcome;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}

if (!isMainThread) {
  const jobs = workerData as Job[];
  const done: Done[] = [];
  for (const j of jobs) {
    const out = playSim(engine, j.game);
    done.push({
      job: { suite: j.suite, a: j.a, b: j.b, aWhite: j.aWhite, format: j.game.format },
      out,
    });
    parentPort?.postMessage({ tick: 1 });
  }
  parentPort?.postMessage({ done });
} else {
  const games = Number(arg('games', '12'));
  const format = arg('format', 'full') as FormatId;
  const tier = arg('tier', 'trainer') as Tier;
  const nodes = Number(arg('nodes', '3000'));
  const suite = arg('suite', 'all');
  const seed0 = Number(arg('seed', '1'));
  const workers = Math.max(
    1,
    Number(arg('workers', String(Math.max(1, availableParallelism() - 1)))),
  );
  const maxPlies = Number(arg('max-plies', '240'));
  const jobs: Job[] = [];
  let seed = seed0;
  const els = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
  if (suite === 'all' || suite === 'elements') {
    for (const a of els) {
      for (const b of els) {
        if (a > b) continue;
        for (let i = 0; i < games; i++) {
          const aWhite = i % 2 === 0;
          const la = assertValid(elementLoadout(a), 25);
          const lb = assertValid(elementLoadout(b), 25);
          const w = aWhite ? la : lb;
          const bl = aWhite ? lb : la;
          jobs.push({
            suite: 'elements',
            a,
            b,
            aWhite,
            game: {
              format,
              white: { loadout: w, level: 25, tier },
              black: { loadout: bl, level: 25, tier },
              nodes,
              maxPlies,
              seed: seed++,
            },
          });
        }
      }
    }
  }
  if (suite === 'all' || suite === 'archetypes') {
    for (const [ai, a] of ARCHETYPES.entries()) {
      for (const [bi, b] of ARCHETYPES.entries()) {
        if (bi <= ai) continue;
        for (let i = 0; i < games; i++) {
          const aWhite = i % 2 === 0;
          const e1 = els[i % els.length] as ElementId;
          const e2 = els[(i + 1) % els.length] as ElementId;
          const la = assertValid(buildLoadout(a, e1, e2), 25);
          const lb = assertValid(buildLoadout(b, e1, e2), 25);
          jobs.push({
            suite: 'archetypes',
            a,
            b,
            aWhite,
            game: {
              format,
              white: { loadout: aWhite ? la : lb, level: 25, tier },
              black: { loadout: aWhite ? lb : la, level: 25, tier },
              nodes,
              maxPlies,
              seed: seed++,
            },
          });
        }
      }
    }
  }
  const t0 = performance.now();
  const chunks: Job[][] = Array.from({ length: Math.min(workers, jobs.length) }, () => []);
  jobs.forEach((j, i) => chunks[i % chunks.length]?.push(j));
  let ticks = 0;
  const results: Done[] = [];
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: chunk,
            execArgv: ['--import', 'tsx'],
          });
          w.on('message', (m: { tick?: number; done?: Done[] }) => {
            if (m.tick) {
              ticks++;
              if (ticks % 25 === 0)
                console.log(
                  `  ${ticks}/${jobs.length} battles (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
                );
            }
            if (m.done) {
              results.push(...m.done);
              resolve();
            }
          });
          w.on('error', reject);
        }),
    ),
  );
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  // Score from a's point of view: win 1, draw 0.5.
  const scoreFor = (d: Done, who: 'a' | 'b'): number => {
    const aSide: Side = d.job.aWhite ? 'white' : 'black';
    if (d.out.winner === null) return 0.5;
    const aWon = d.out.winner === aSide;
    return who === 'a' ? (aWon ? 1 : 0) : aWon ? 0 : 1;
  };
  const lines: string[] = [];
  lines.push(`# Balance simulator report`, '');
  lines.push(
    `Format ${format}, tier ${tier}, ${nodes} nodes per move, ${games} games per pairing, seeds from ${seed0}. Draws count as half a win.`,
    '',
  );
  const el = results.filter((r) => r.job.suite === 'elements');
  let advGames = 0;
  let advScore = 0;
  if (el.length > 0) {
    lines.push('## Element matchups (mono-element Focused builds, level 25)', '');
    lines.push(
      '| Row vs column | ' + els.join(' | ') + ' |',
      '| --- | ' + els.map(() => '---').join(' | ') + ' |',
    );
    for (const a of els) {
      const cells = els.map((b) => {
        const rs = el.filter(
          (r) => (r.job.a === a && r.job.b === b) || (r.job.a === b && r.job.b === a),
        );
        if (rs.length === 0) return '—';
        if (a === b) {
          const w =
            rs.reduce(
              (sum, r) => sum + (r.out.winner === 'white' ? 1 : r.out.winner === null ? 0.5 : 0),
              0,
            ) / rs.length;
          return `mirror, white ${pct(w)} (${rs.length})`;
        }
        const s =
          rs.reduce((sum, r) => sum + (r.job.a === a ? scoreFor(r, 'a') : scoreFor(r, 'b')), 0) /
          rs.length;
        return `${pct(s)} (${rs.length})`;
      });
      lines.push(`| ${a} | ${cells.join(' | ')} |`);
    }
    for (const r of el) {
      if (r.job.a === r.job.b) continue;
      const a = r.job.a as ElementId;
      const b = r.job.b as ElementId;
      if (beats(a, b)) {
        advGames++;
        advScore += scoreFor(r, 'a');
      } else if (beats(b, a)) {
        advGames++;
        advScore += scoreFor(r, 'b');
      }
    }
    lines.push(
      '',
      `Advantaged element score: **${advGames ? pct(advScore / advGames) : '—'}** over ${advGames} games (target 55–60%).`,
      '',
    );
  }
  const ar = results.filter((r) => r.job.suite === 'archetypes');
  if (ar.length > 0) {
    lines.push('## Build archetypes (7.3, level 25)', '');
    lines.push(
      '| Row vs column | ' + ARCHETYPES.join(' | ') + ' |',
      '| --- | ' + ARCHETYPES.map(() => '---').join(' | ') + ' |',
    );
    for (const a of ARCHETYPES) {
      const cells = ARCHETYPES.map((b) => {
        if (a === b) return '—';
        const rs = ar.filter(
          (r) => (r.job.a === a && r.job.b === b) || (r.job.a === b && r.job.b === a),
        );
        if (rs.length === 0) return '—';
        const s =
          rs.reduce((sum, r) => sum + (r.job.a === a ? scoreFor(r, 'a') : scoreFor(r, 'b')), 0) /
          rs.length;
        return `${pct(s)} (${rs.length})`;
      });
      lines.push(`| ${a} | ${cells.join(' | ')} |`);
    }
    lines.push(
      '',
      'Target: Maximum, Flexible and Focused each 45–55% against the others (17.2).',
      '',
    );
  }
  const decided = results.filter((r) => r.out.winner !== null);
  const whiteScore =
    results.reduce(
      (s, r) => s + (r.out.winner === 'white' ? 1 : r.out.winner === null ? 0.5 : 0),
      0,
    ) / Math.max(1, results.length);
  const surprise = decided.filter((r) => r.out.surprise).length / Math.max(1, decided.length);
  const plies = results.map((r) => r.out.plies).sort((x, y) => x - y);
  const median = plies[Math.floor(plies.length / 2)] ?? 0;
  const reasons = new Map<string, number>();
  for (const r of results) reasons.set(r.out.reason, (reasons.get(r.out.reason) ?? 0) + 1);
  lines.push('## Totals', '');
  lines.push(`| Metric | Value | Target (17.2) |`, `| --- | --- | --- |`);
  lines.push(`| Battles | ${results.length} | |`);
  lines.push(`| White score | ${pct(whiteScore)} | ≤ 56% |`);
  lines.push(`| Surprise losses | ${pct(surprise)} of decided battles | < 15% |`);
  lines.push(
    `| Median length | ${median} plies | First Blood 2–5 min, Full 10–25 min (live clocks) |`,
  );
  lines.push(
    `| Result reasons | ${[...reasons.entries()].map(([k, v]) => `${k} ${v}`).join(', ')} | |`,
  );
  lines.push(
    '',
    `Wall time ${((performance.now() - t0) / 1000).toFixed(0)} s on ${chunks.length} worker(s).`,
  );
  const md = lines.join('\n');
  mkdirSync('reports/sim', { recursive: true });
  writeFileSync(`reports/sim/${format}-${tier}.md`, md + '\n');
  writeFileSync(
    `reports/sim/${format}-${tier}.json`,
    JSON.stringify({ format, tier, nodes, games, results }, null, 1),
  );
  console.log(md);
}
