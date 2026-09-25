/**
 * The lesson mini board (M5, spec 10.3, R-WORLD-003): positions read from the puzzle FEN (lesson
 * sketches without kings too), click-to-move picking in UCI, promotions, board orientation and the
 * engine hints (legal targets, attacked pieces) behind the new-player settings.
 */
import { describe, expect, it } from 'vitest';
import { parseSquare } from '@chain-theorem/rules';
import { displayOrder, hintsFor, pick, promotionUci, readFen } from './miniboard.ts';

const sq = parseSquare;

describe('lesson mini board (R-WORLD-003)', () => {
  it('R-WORLD-003 reads a FEN, including lesson sketches without kings', () => {
    const pos = readFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    expect(pos?.turn).toBe('white');
    expect(pos?.board[sq('a1')]).toEqual({ side: 'white', type: 'rook' });
    expect(pos?.board[sq('e8')]).toEqual({ side: 'black', type: 'king' });
    expect(pos?.board.filter(Boolean)).toHaveLength(3);
    const sketch = readFen('8/8/8/3N4/8/8/8/8 b - - 0 1');
    expect(sketch?.turn).toBe('black');
    expect(sketch?.board[sq('d5')]).toEqual({ side: 'white', type: 'knight' });
    expect(readFen('8/8/8')).toBeNull();
    expect(readFen('9/8/8/8/8/8/8/8 w - - 0 1')).toBeNull();
    expect(readFen('8/8/8/8/8/8/8/X7 w - - 0 1')).toBeNull();
  });

  it('R-WORLD-003 picks a piece of the side to move, then a square, and answers in UCI', () => {
    const pos = readFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    if (!pos) throw new Error('fen');
    // Empty squares and the opponent's pieces cannot be picked first.
    expect(pick(pos, { selected: null }, sq('a2'))).toEqual({ kind: 'select', selected: null });
    expect(pick(pos, { selected: null }, sq('e8'))).toEqual({ kind: 'select', selected: null });
    expect(pick(pos, { selected: null }, sq('a1'))).toEqual({ kind: 'select', selected: sq('a1') });
    // Clicking it again deselects; another own piece reselects.
    expect(pick(pos, { selected: sq('a1') }, sq('a1'))).toEqual({ kind: 'select', selected: null });
    expect(pick(pos, { selected: sq('a1') }, sq('e1'))).toEqual({
      kind: 'select',
      selected: sq('e1'),
    });
    expect(pick(pos, { selected: sq('a1') }, sq('a8'))).toEqual({ kind: 'move', uci: 'a1a8' });
    // Capturing is a move too; legality is the zone's call (a wrong move gets the hint).
    expect(pick(pos, { selected: sq('a1') }, sq('e8'))).toEqual({ kind: 'move', uci: 'a1e8' });
    expect(pick(pos, { selected: sq('a1') }, sq('h7'))).toEqual({ kind: 'move', uci: 'a1h7' });
  });

  it('R-WORLD-003 a pawn reaching the last rank asks which piece to promote to', () => {
    const white = readFen('8/P3k3/8/8/8/8/8/4K3 w - - 0 1');
    const black = readFen('4k3/8/8/8/8/8/p7/4K3 b - - 0 1');
    if (!white || !black) throw new Error('fen');
    expect(pick(white, { selected: sq('a7') }, sq('a8'))).toEqual({
      kind: 'promote',
      from: sq('a7'),
      to: sq('a8'),
    });
    expect(promotionUci(sq('a7'), sq('a8'), 'knight')).toBe('a7a8n');
    expect(pick(black, { selected: sq('a2') }, sq('a1'))).toMatchObject({ kind: 'promote' });
    expect(pick(black, { selected: sq('e8') }, sq('e7'))).toEqual({ kind: 'move', uci: 'e8e7' });
  });

  it('R-WORLD-003 shows the board from the side to move', () => {
    const w = displayOrder('white');
    const b = displayOrder('black');
    expect(w[0]).toBe(sq('a8'));
    expect(w[63]).toBe(sq('h1'));
    expect(b[0]).toBe(sq('h1'));
    expect(b[63]).toBe(sq('a8'));
    expect(new Set(w).size).toBe(64);
  });

  it('R-WORLD-003 hints: legal targets and "this square is attacked" for full positions', () => {
    const h = hintsFor('4k3/8/8/8/8/8/4r3/R3K3 w - - 0 1');
    expect(h).not.toBeNull();
    // The white king on e1 is in check from the rook on e2: it is attacked.
    expect(h?.attacked).toContain(sq('e1'));
    // The king may take the rook; the a1 rook cannot move into a1-h1 through the king.
    expect(h?.targets.get(sq('e1'))).toContain(sq('e2'));
    // Lesson sketches without kings show no hints (and do not throw).
    expect(hintsFor('8/8/8/3N4/8/8/8/8 w - - 0 1')).toBeNull();
  });
});
