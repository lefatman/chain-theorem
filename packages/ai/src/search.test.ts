/**
 * NPC search tests (M3 step 3.3, spec 9.4 R-FMT-005): tier depths, mate in one, no queen blunders,
 * determinism under a node budget and the per-move time budget.
 *
 * The AI package depends only on rules at runtime (13.1). Tests need real content modules to build
 * an engine, so they import `@chain-theorem/content` by relative path: scripts/check-deps.ts also
 * checks devDependencies, so declaring content as an ai devDependency would fail `pnpm deps:check`.
 */
import { describe, expect, it } from 'vitest';
import {
  type GameState,
  type Move,
  type Side,
  applyWithDefaults,
  moveToUci,
} from '@chain-theorem/rules';
import { engine, makeEngine } from '../../content/index.ts';
import { setup } from '../../content/src/testing.ts';
import { TIERS, type SearchOptions, type SearchResult, type Tier, search } from './index.ts';

const TIER_NAMES: readonly Tier[] = ['wild', 'trainer', 'elite'];
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Search for the side to move, from its own projection and its own loadout only (9.4). */
function npc(state: GameState, tier: Tier, opts: SearchOptions = {}): SearchResult {
  const side = state.turn;
  return search(engine, engine.project(state, side), state.armies[side].loadout, tier, opts);
}

function apply(state: GameState, move: Move): GameState {
  return applyWithDefaults(engine, state, { kind: 'move', side: state.turn, move }).state;
}

const opp = (s: Side): Side => (s === 'white' ? 'black' : 'white');

describe('tiers (R-FMT-005, spec 9.4)', () => {
  it('R-FMT-005 tier search depths are Wild 2, Trainer 3, Elite 4', () => {
    expect(TIERS.wild.depth).toBe(2);
    expect(TIERS.trainer.depth).toBe(3);
    expect(TIERS.elite.depth).toBe(4);
  });

  it('R-FMT-005 Trainer and Elite use the ability-aware evaluation; Wild uses heuristics only', () => {
    expect(TIERS.wild.abilityAware).toBe(false);
    expect(TIERS.trainer.abilityAware).toBe(true);
    expect(TIERS.elite.abilityAware).toBe(true);
  });

  it('R-FMT-005 every tier defaults to the ~50 ms per-move CPU budget', () => {
    for (const t of TIER_NAMES) expect(TIERS[t].ms).toBe(50);
  });

  it('R-FMT-005 with an unlimited node budget each tier completes exactly its spec depth', () => {
    const { state } = setup({ fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1' });
    for (const t of TIER_NAMES) {
      const r = npc(state, t, { nodes: 10_000_000 });
      expect(r.depth, t).toBe(TIERS[t].depth);
    }
  });

  it('R-FMT-005 each tier reaches its spec depth within its own default node budget', () => {
    for (const fen of [undefined, KIWIPETE]) {
      const { state } = setup(fen ? { fen } : {});
      for (const t of TIER_NAMES) {
        const r = npc(state, t);
        expect(r.depth, `${t} ${fen ?? 'start'}`).toBe(TIERS[t].depth);
        expect(r.nodes).toBeLessThanOrEqual(TIERS[t].nodes);
      }
    }
  });

  it('R-FMT-005 a depth override caps the iterative deepening', () => {
    const { state } = setup({});
    expect(npc(state, 'elite', { depth: 1, nodes: 10_000_000 }).depth).toBe(1);
  });
});

const MATES: readonly { name: string; fen: string }[] = [
  { name: 'back-rank rook mate', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' },
  { name: 'queen and king mate', fen: 'k7/8/1K6/8/8/8/8/7Q w - - 0 1' },
  {
    name: "scholar's mate",
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  },
  {
    name: "fool's mate (black to move)",
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2',
  },
  { name: 'smothered mate', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1' },
];

describe('mate in one (R-FMT-005)', () => {
  for (const t of TIER_NAMES) {
    for (const { name, fen } of MATES) {
      it(`R-FMT-005 ${t} finds mate in one: ${name}`, () => {
        const { state } = setup({ fen });
        const side = state.turn;
        const r = npc(state, t);
        const after = apply(state, r.move);
        expect(after.result, moveToUci(r.move)).toEqual({ winner: side, reason: 'checkmate' });
      });
    }
  }
});

const QUEEN_BAIT: readonly { name: string; fen: string }[] = [
  { name: 'a pawn guarded by a pawn', fen: '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1' },
  { name: 'a knight guarded by a pawn', fen: '4k3/8/2p5/3n4/8/8/8/3QK3 w - - 0 1' },
  { name: 'a queen attacked by two pawns', fen: '4k3/8/8/8/2p1p3/3Q4/8/4K3 w - - 0 1' },
  { name: 'black: a pawn guarded by a pawn', fen: '3qk3/8/8/8/3P4/2P5/8/4K3 b - - 0 1' },
  {
    name: 'black in an open game',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
  },
];

/** Squares of `side`'s queens that an enemy pawn can capture next move. */
function queensEnPriseToPawn(state: GameState, side: Side): string[] {
  const queens = state.pieces.filter((p) => p.side === side && p.type === 'queen' && p.square >= 0);
  const hits = engine
    .legalMoves(state, opp(side))
    .filter((m) => state.pieces[state.board[m.from] ?? -1]?.type === 'pawn')
    .filter((m) => queens.some((q) => q.square === m.to));
  return hits.map((m) => moveToUci(m));
}

describe('no queen blunders (R-FMT-005)', () => {
  for (const t of TIER_NAMES) {
    for (const { name, fen } of QUEEN_BAIT) {
      it(`R-FMT-005 ${t} does not hang its queen to a pawn: ${name}`, () => {
        const { state } = setup({ fen });
        const side = state.turn;
        const r = npc(state, t);
        const after = apply(state, r.move);
        expect(
          after.pieces.some((p) => p.side === side && p.type === 'queen' && p.square >= 0),
        ).toBe(true);
        expect(queensEnPriseToPawn(after, side), `after ${moveToUci(r.move)}`).toEqual([]);
      });
    }
  }
});

describe('determinism with a node budget (R-FMT-005, INV-04)', () => {
  const positions = [
    { name: 'start', fen: undefined },
    { name: 'Kiwipete', fen: KIWIPETE },
  ];
  for (const { name, fen } of positions) {
    for (const t of TIER_NAMES) {
      it(`R-FMT-005 ${t} on ${name}: same inputs give the same move, score and node count`, () => {
        const { state } = setup(fen ? { fen } : {});
        const opts = { nodes: 3_000, seed: 7 };
        const a = npc(state, t, opts);
        const b = npc(state, t, opts);
        // A second engine instance built from the same registry must agree too.
        const other = makeEngine();
        const c = search(
          other,
          other.project(state, state.turn),
          state.armies[state.turn].loadout,
          t,
          opts,
        );
        expect(b).toEqual(a);
        expect(c).toEqual(a);
      });
    }
  }

  it('R-FMT-005 without a clock the tier node budget applies, so repeated searches agree', () => {
    const { state } = setup({ fen: KIWIPETE });
    for (const t of TIER_NAMES) {
      const a = npc(state, t);
      expect(npc(state, t).move).toEqual(a.move);
    }
  });

  it('R-FMT-005 the node budget is honoured beyond the guaranteed first iteration (checked between root moves and every 256 nodes)', () => {
    const { state } = setup({ fen: KIWIPETE });
    for (const t of TIER_NAMES) {
      // The first iteration (quiescence on every root move) always completes, and stays cheap.
      const floor = npc(state, t, { nodes: 0 });
      expect(floor.depth, t).toBe(1);
      expect(floor.nodes, t).toBeLessThan(4_000);
      for (const budget of [200, 1_000, 5_000]) {
        const r = npc(state, t, { nodes: budget });
        expect(r.depth, `${t} budget ${budget}`).toBeGreaterThanOrEqual(1);
        expect(r.nodes, `${t} budget ${budget}`).toBeLessThanOrEqual(
          Math.max(budget, floor.nodes) + 256,
        );
      }
    }
  });

  it('R-FMT-005 a different noise seed may change the wild move but never makes it illegal', () => {
    const { state } = setup({});
    const legal = new Set(engine.legalMoves(state, 'white').map((m) => moveToUci(m)));
    for (let seed = 0; seed < 8; seed++) {
      const r = npc(state, 'wild', { seed, nodes: 2_000 });
      expect(legal.has(moveToUci(r.move))).toBe(true);
    }
  });
});

describe('time budget (R-FMT-005: about 50 ms per move)', () => {
  const clock = () => performance.now();

  function timed(state: GameState, t: Tier): { ms: number; r: SearchResult } {
    const t0 = performance.now();
    const r = npc(state, t, { now: clock });
    return { ms: performance.now() - t0, r };
  }

  it('R-FMT-005 each tier answers within the budget on the start position (fails above 250 ms)', () => {
    const { state } = setup({});
    const legal = new Set(engine.legalMoves(state, 'white').map((m) => moveToUci(m)));
    for (const t of TIER_NAMES) {
      timed(state, t); // warm up the JIT
      for (let i = 0; i < 3; i++) {
        const { ms, r } = timed(state, t);
        expect(ms, `${t} run ${i}`).toBeLessThan(250);
        expect(legal.has(moveToUci(r.move))).toBe(true);
      }
    }
  });

  it('R-FMT-005 the budget also holds in a wide middlegame (Kiwipete, 48 legal moves)', () => {
    const { state } = setup({ fen: KIWIPETE });
    for (const t of TIER_NAMES) {
      timed(state, t);
      const { ms } = timed(state, t);
      expect(ms, t).toBeLessThan(250);
    }
  });

  it('R-FMT-005 the deadline is checked between root moves: a clock already past it stops after the first iteration', () => {
    const { state } = setup({ fen: KIWIPETE });
    for (const t of TIER_NAMES) {
      let calls = 0;
      // 0 ms when the search starts, then far past any deadline.
      const jump = () => (calls++ === 0 ? 0 : 10_000);
      const r = npc(state, t, { now: jump, ms: 50 });
      const floor = npc(state, t, { nodes: 0 });
      expect(r.depth, t).toBe(1);
      expect(r.nodes, t).toBe(floor.nodes);
      expect(engine.legalMoves(state, 'white').map((m) => moveToUci(m))).toContain(
        moveToUci(r.move),
      );
    }
  });
});
