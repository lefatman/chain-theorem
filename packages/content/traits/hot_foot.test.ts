import { describe, expect, it } from 'vitest';
import { eventsOf, idAt, play, scenario, setup } from '../src/testing.ts';
import type { HotFootState } from './hot_foot.ts';

const burning = (s: { slices: Record<string, unknown> }) =>
  (s.slices.hot_foot as HotFootState).burning;

describe('hot_foot', () => {
  it('R-ELEM-005 a move capture by an Ember piece burns the square once the piece leaves it', () => {
    const r = scenario({
      fen: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['tide'] },
      moves: ['f3e5', 'e8d8', 'e5f3'],
    });
    expect(burning(r.state)).toEqual([{ sq: 36, side: 'white', turns: 3 }]);
    expect(eventsOf(r.events, 'SquareIgnited')).toHaveLength(1);
  });

  it('R-ELEM-005 non-Ember pieces cannot move to a burning square, sliders pass over it, and it burns for 3 opponent turns', () => {
    const s0 = setup({
      fen: '3k4/8/8/r3p3/8/5N2/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['tide'] },
    });
    let state = s0.state;
    for (const m of ['f3e5', 'd8c8', 'e5f3']) state = play(s0.engine, state, m).state;
    const rook = s0.engine.legalMoves(state, 'black').filter((m) => m.from === 32);
    expect(rook.some((m) => m.to === 36)).toBe(false); // e5 burns
    expect(rook.some((m) => m.to === 37)).toBe(true); // f5: the rook slides over e5
    for (const m of ['c8d8', 'e1e2', 'd8c8', 'e2e1']) state = play(s0.engine, state, m).state;
    expect(burning(state)).toEqual([{ sq: 36, side: 'white', turns: 1 }]);
    const r = play(s0.engine, state, 'c8d8');
    expect(eventsOf(r.step.events, 'SquareExtinguished')).toHaveLength(1);
    expect(burning(r.state)).toEqual([]);
    expect(idAt(r.state, 'a5')).toBeGreaterThanOrEqual(0);
  });

  it('R-ELEM-005 being captured on the pending square does not ignite it', () => {
    const r = scenario({
      fen: '4k3/8/3p4/4p3/8/5N2/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['tide'] },
      moves: ['f3e5', 'd6e5'],
    });
    expect(burning(r.state)).toEqual([]);
    expect((r.state.slices.hot_foot as HotFootState).pending).toEqual([]);
  });
});
