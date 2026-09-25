import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import {
  uciToMove,
  type BattleEvent,
  type GameState,
  type Loadout,
  type PublicEvent,
} from '@chain-theorem/rules';
import { CHAIN_CAP_STEPS, FAST_CHAIN_MS, landFirst, planAnimation } from './timeline.ts';

const loadout = (element: Loadout['elements'][number], abilities: string[]): Loadout => ({
  elements: [element],
  items: [],
  sets: [abilities],
});

/** Play UCI moves (default answers for prompts); returns the last action's before/after/events. */
function play(moves: string[], white: Loadout, black: Loadout) {
  let state: GameState = engine.newBattle({
    format: 'full',
    white: { level: 25, loadout: white },
    black: { level: 25, loadout: black },
  }).state;
  let last = { before: engine.project(state, 'white'), events: [] as PublicEvent[] };
  for (const uci of moves) {
    const before = engine.project(state, 'white');
    let r = engine.applyAction(state, { kind: 'move', side: state.turn, move: uciToMove(uci) });
    const evs: BattleEvent[] = [...r.events];
    while (r.kind === 'needsChoice') {
      const req = r.request;
      r = engine.applyAction(r.state, {
        kind: 'choice',
        side: req.chooser,
        promptId: req.promptId,
        option: req.defaultOption,
      });
      evs.push(...r.events);
    }
    state = r.state;
    last = { before, events: engine.projectEvents(state, evs, 'white') };
  }
  return last;
}

// Ember Hit and Run capturing a Grove pawn: capture, trigger, retreat and ignite (R-ELEM-005).
const chain = () =>
  play(
    ['e2e4', 'd7d5', 'e4d5'],
    loadout('ember', ['hit_and_run']),
    loadout('grove', ['backdraft']),
  );

describe('animation timeline (11.2, R-ART-002)', () => {
  it('R-ART-002 reduced motion (0 ms) skips animation entirely', () => {
    const { before, events } = chain();
    expect(planAnimation(before, events, 0)).toEqual({ steps: [], total: 0 });
  });

  it('R-ART-002 a reaction chain animates event by event, in order', () => {
    const { before, events } = chain();
    const plan = planAnimation(before, events, 200);
    const kinds = plan.steps.map((s) => s.k);
    // The attacker lands, the victim faints, the ability bursts, the piece retreats, d5 ignites.
    expect(kinds[0]).toBe('move');
    expect(kinds.indexOf('faint')).toBeGreaterThan(0);
    expect(kinds).toContain('burst');
    expect(kinds.indexOf('ignite')).toBeGreaterThan(kinds.lastIndexOf('move'));
    for (let i = 1; i < plan.steps.length; i++) {
      const a = plan.steps[i - 1];
      const b = plan.steps[i];
      if (a && b) expect(b.start).toBeGreaterThanOrEqual(a.start + a.dur - 1e-9);
    }
    const ignite = plan.steps.find((s) => s.k === 'ignite');
    expect(ignite && ignite.k === 'ignite' ? ignite.turns : 0).toBeGreaterThan(0);
  });

  it('R-ART-002 fast mode resolves any reaction chain in under 1 second', () => {
    const { before, events } = chain();
    // Worst case: the same chain repeated, as in a long nested reaction (well past any real chain).
    const long: PublicEvent[] = Array.from({ length: 12 }, () => events).flat();
    for (const ms of [30, 60, 100]) {
      const plan = planAnimation(before, long, ms, true);
      expect(plan.total).toBeLessThanOrEqual(FAST_CHAIN_MS);
      expect(plan.total).toBeLessThan(1000);
    }
    // Fast mode is also inferred from a short base duration.
    expect(planAnimation(before, long, 60).total).toBeLessThanOrEqual(FAST_CHAIN_MS);
  });

  it('R-ART-002 normal speed caps a chain at CHAIN_CAP_STEPS base durations', () => {
    const { before, events } = chain();
    const long: PublicEvent[] = Array.from({ length: 12 }, () => events).flat();
    const plan = planAnimation(before, long, 220);
    expect(plan.total).toBeLessThanOrEqual(CHAIN_CAP_STEPS * 220 + 1e-6);
    // A normal-length chain is not compressed: each step keeps its full duration.
    const short = planAnimation(before, events, 220);
    expect(short.steps[0]?.dur).toBe(220);
  });

  it('R-ART-002 castling moves the rook together with the king', () => {
    const { before, events } = play(
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1'],
      loadout('neutral', []),
      loadout('neutral', []),
    );
    const plan = planAnimation(before, events, 100);
    const moves = plan.steps.filter((s) => s.k === 'move');
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => (m.k === 'move' ? [m.from, m.to] : []))).toEqual([
      [4, 6],
      [7, 5],
    ]);
    expect(moves[0]?.start).toBe(moves[1]?.start);
  });

  it('landFirst puts the captor move before its victim faints', () => {
    const { events } = chain();
    const ordered = landFirst(events);
    const move = ordered.findIndex((e) => e.k === 'MoveMade');
    const captured = ordered.findIndex((e) => e.k === 'Captured');
    expect(move).toBeGreaterThanOrEqual(0);
    expect(captured).toBeGreaterThan(move);
    expect(ordered).toHaveLength(events.length);
  });
});
