/**
 * Necromancer (5.8): Captures, neutral, all, revive, 1 charge. "After capturing a piece of equal or
 * higher rank than this piece, revive one of your captured pieces of equal or lower rank than this
 * piece: on its starting square if empty, otherwise on any empty square of your back rank."
 *
 * Expected behaviour comes from spec 5.1 (rank, DD-97), 5.2, 5.4, 6.2, R-RULES-004 and DD-103.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;

/** Answer that picks the captured piece `id` in a target prompt. */
const pickPiece = (id: number) => (req: ChoiceRequest) => {
  const i = req.options.findIndex((o) => o.kind === 'piece' && o.piece === id);
  if (i < 0) throw new Error(`piece ${id} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};
const pickSquare = (name: string) => (req: ChoiceRequest) => {
  const i = req.options.findIndex((o) => o.kind === 'square' && o.square === sq(name));
  if (i < 0) throw new Error(`square ${name} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};

// b1 B=0, e1 K=1, b2 P=2, c3 N=3, b8 r=4, e8 k=5. Black's rook takes the pawn and then the bishop
// (with check); the knight takes the rook from c3: a knight (rank 2) capturing a rook (rank 3).
const FEN = '1r2k3/8/8/8/8/2N5/1P6/1B2K3 w - - 0 1';
const MOVES = ['c3e4', 'b8b2', 'e4c3', 'b2b1', 'c3b1'];

describe('Necromancer (5.8, DD-97, DD-103)', () => {
  it('R-ABIL-005 module data: Captures, neutral, all, revive, 1 charge, level 11', () => {
    const def = abilityById.get('necromancer');
    expect(def).toMatchObject({
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: 'all',
      tags: ['revive'],
      minLevel: 11,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ rank: { of: 'victim', cmp: '>=', to: 'captor' } }],
    });
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-004 a knight taking a rook may revive a captured pawn or minor piece; the options are the starting squares in square order', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: MOVES,
      answers: [pickPiece(2)],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req).toMatchObject({ chooser: 'white', kind: 'target', purpose: 'revive' });
    expect(req.source).toMatchObject({ ability: 'necromancer', piece: 3, side: 'white' });
    // Square order of the starting squares (b1 before b2); the options name those squares.
    expect(req.options).toEqual([
      { kind: 'piece', piece: 0, square: sq('b1') },
      { kind: 'piece', piece: 2, square: sq('b2') },
    ]);
    const last = r.steps[4]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'necromancer', piece: 3, attuned: false }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: 2, square: sq('b2') }),
    ]);
    expect(eventsOf(last, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: 3, ability: 'necromancer', remaining: 0 }),
    ]);
    expect(pieceAt(r.state, 'b2')).toMatchObject({ id: 2, side: 'white', type: 'pawn' });
    expect(idAt(r.state, 'b1')).toBe(3);
    expect(r.state.pieces[0]?.square).toBe(-1);
  });

  it("R-ABIL-002 DD-103 when the chosen piece's starting square is taken, the owner picks any empty back-rank square instead", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: MOVES,
      answers: [pickPiece(0), pickSquare('a1')],
    });
    expect(r.prompts).toHaveLength(2);
    const squares = r.prompts[1] as ChoiceRequest;
    expect(squares).toMatchObject({ chooser: 'white', kind: 'square', subject: 0 });
    // b1 holds the knight now and e1 the king; the other six back-rank squares are offered.
    expect(squares.options.map((o) => (o.kind === 'square' ? o.square : -1))).toEqual(
      ['a1', 'c1', 'd1', 'f1', 'g1', 'h1'].map(sq),
    );
    expect(pieceAt(r.state, 'a1')).toMatchObject({ id: 0, side: 'white', type: 'bishop' });
    expect(r.state.pieces[2]?.square).toBe(-1);
  });

  it('R-ABIL-004 DD-97 it does not trigger on a victim of lower rank (a rook taking a pawn), and stays hidden', () => {
    // a1 R=0, e1 K=1, a7 p=2, e8 k=3.
    const r = scenario({
      fen: '4k3/p7/8/8/8/8/8/R3K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: ['a1a7'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(r.state.reveals.white.abilities.rook ?? []).toEqual([]);
  });

  it('R-ABIL-004 DD-97 equal rank counts (a knight taking a bishop) but with nothing to revive the effect fizzles', () => {
    // e1 K=0, c3 N=1, d5 b=2, e8 k=3.
    const r = scenario({
      fen: '4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'necromancer', reason: 'no_target' }),
    ]);
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([]);
  });

  it("R-ABIL-004 DD-97 only pieces of rank at most the captor's are offered: a pawn taking a queen may revive a pawn, never the lost rook", () => {
    // a1 R=0, g2 K=1, d4 P=2, e5 q=3, a7 P=4, a8 r=5, e8 k=6. Black's rook takes the a-pawn, then
    // the a1 rook; the d-pawn takes the queen.
    const r = scenario({
      fen: 'r3k3/P7/8/4q3/3P4/8/6K1/R7 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: ['g2g1', 'a8a7', 'g1g2', 'a7a1', 'd4e5'],
    });
    expect(r.prompts).toHaveLength(0);
    const last = r.steps[4]?.events ?? [];
    // Exactly one candidate (the pawn): no prompt, it returns to a7.
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: 4, square: sq('a7') }),
    ]);
    expect(r.state.pieces[0]?.square).toBe(-1);
  });

  it('R-ELEM-002 the foil silences it: an Ember knight taking a Tide rook revives nothing', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['ember'], abilities: ['necromancer'] },
      black: { elements: ['tide'] },
      moves: MOVES,
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'necromancer' }),
    ]);
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([]);
  });

  it("R-LOAD-002 Warden's Stopwatch negates it (revive tag)", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'], items: ['wardens_stopwatch'] },
      moves: MOVES,
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'necromancer' }),
    ]);
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([]);
  });
});
