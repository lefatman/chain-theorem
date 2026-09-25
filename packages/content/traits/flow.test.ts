import { describe, expect, it } from 'vitest';
import { scenario, setup } from '../src/testing.ts';

describe('flow', () => {
  it('R-ELEM-006 E8 a Tide rook attacks and moves through its own pawn', () => {
    const s = setup({
      fen: 'k7/8/8/8/8/8/P7/R3K3 b - - 0 1',
      white: { elements: ['tide'] },
      black: { elements: ['ember'] },
    });
    expect(s.state.inCheck).toBe('black');
    const w = setup({
      fen: 'k7/8/8/8/8/8/P7/R3K3 w - - 0 1',
      white: { elements: ['tide'] },
      black: { elements: ['ember'] },
    });
    expect(w.engine.legalMoves(w.state, 'white').some((m) => m.from === 0 && m.to === 32)).toBe(
      true,
    );
    expect(w.engine.legalMoves(w.state, 'white').some((m) => m.from === 0 && m.to === 8)).toBe(
      false,
    );
  });

  it('R-ELEM-006 non-Tide pieces do not pass through allies', () => {
    const w = setup({
      fen: 'k7/8/8/8/8/8/P7/R3K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['ember'] },
    });
    expect(w.engine.legalMoves(w.state, 'white').some((m) => m.from === 0 && m.to === 32)).toBe(
      false,
    );
  });

  it('R-ELEM-006 a Tide pawn may double-push through its own piece', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/4N3/4P3/4K3 w - - 0 1',
      white: { elements: ['tide'] },
      black: { elements: ['ember'] },
      moves: ['e2e4'],
    });
    expect(r.state.board[28]).toBeGreaterThanOrEqual(0);
    expect(r.state.ep).toBe(-1);
  });
});
