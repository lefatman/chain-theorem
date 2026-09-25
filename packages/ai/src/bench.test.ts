/**
 * NPC search benchmark (R-FMT-005, spec 9.4: about 50 ms per move). Skipped unless AI_BENCH=1:
 *
 *   AI_BENCH=1 pnpm vitest run --project unit packages/ai/src/bench.test.ts --reporter=verbose
 *
 * Prints nodes per second with each tier's node budget and the depth each tier reaches with the
 * default 50 ms clock, on a quiet opening, a sharp middlegame and an ability-heavy position.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, Loadout } from '@chain-theorem/rules';
import { engine } from '../../content/index.ts';
import { play } from '../../content/src/testing.ts';
import { TIERS, type Tier, search } from './index.ts';

const RUNS = 5;
const TIER_NAMES: readonly Tier[] = ['wild', 'trainer', 'elite'];

const PLAIN: Loadout = { elements: ['neutral'], items: [], sets: [[]] };
const EMBER: Loadout = {
  elements: ['ember'],
  items: ['triple_adepts_gloves'],
  sets: [['riposte', 'momentum', 'backdraft']],
};
const GROVE: Loadout = {
  elements: ['grove'],
  items: ['triple_adepts_gloves'],
  sets: [['poisoned_meat', 'reinforce', 'rebirth']],
};

function position(fen: string | undefined, white: Loadout, black: Loadout, moves: string[] = []) {
  let { state } = engine.newBattle({
    format: 'full',
    white: { level: 30, loadout: white },
    black: { level: 30, loadout: black },
    ...(fen ? { fen } : {}),
  });
  for (const uci of moves) state = play(engine, state, uci).state;
  return state;
}

const POSITIONS: readonly { name: string; state: () => GameState }[] = [
  { name: 'start', state: () => position(undefined, PLAIN, PLAIN) },
  {
    name: 'Kiwipete',
    state: () =>
      position(
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        PLAIN,
        PLAIN,
      ),
  },
  {
    name: 'abilities (Ember vs Grove, Italian)',
    state: () => position(undefined, EMBER, GROVE, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']),
  },
];

describe.runIf(process.env.AI_BENCH === '1')('AI benchmark (AI_BENCH=1)', () => {
  it('R-FMT-005 prints nodes per second and the depth reached in 50 ms per tier', () => {
    const rows: string[] = [];
    for (const p of POSITIONS) {
      const state = p.state();
      const side = state.turn;
      const pub = engine.project(state, side);
      const own = state.armies[side].loadout;
      for (const t of TIER_NAMES) {
        search(engine, pub, own, t); // warm up
        let nodes = 0;
        let ms = 0;
        let depth = 0;
        for (let i = 0; i < RUNS; i++) {
          const t0 = performance.now();
          const r = search(engine, pub, own, t);
          ms += performance.now() - t0;
          nodes += r.nodes;
          depth = r.depth;
        }
        let timedDepth = 0;
        let timedMs = 0;
        for (let i = 0; i < RUNS; i++) {
          const t0 = performance.now();
          const r = search(engine, pub, own, t, { now: () => performance.now() });
          timedMs = Math.max(timedMs, performance.now() - t0);
          timedDepth += r.depth;
        }
        const nps = Math.round(nodes / (ms / 1000));
        rows.push(
          [
            p.name.padEnd(38),
            t.padEnd(8),
            `${TIERS[t].nodes} nodes: depth ${depth}, ${Math.round(nodes / RUNS)} nodes, ${(ms / RUNS).toFixed(1)} ms, ${nps.toLocaleString('en-US')} nodes/s`.padEnd(
              72,
            ),
            `${TIERS[t].ms} ms clock: mean depth ${(timedDepth / RUNS).toFixed(1)}, worst ${timedMs.toFixed(1)} ms`,
          ].join(' '),
        );
        expect(nps).toBeGreaterThan(0);
      }
    }
    console.log(`\nNPC search benchmark (${RUNS} runs each)\n${rows.join('\n')}\n`);
  });
});
