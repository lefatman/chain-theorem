/**
 * Quantum Kill (5.8): Captures, neutral, all, replay, 2 charges. "After capturing a piece of higher
 * rank than this piece, effect-capture one enemy piece of equal or lower rank than this piece (you
 * choose). If there is none, this piece may make one move that does not capture instead."
 *
 * Expected behaviour comes from spec 5.1 (rank, DD-97), 5.2, 5.4, 6.2, INV-01, INV-07, R-RULES-004
 * and DD-103.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;

const pickPiece = (id: number) => (req: ChoiceRequest) => {
  const i = req.options.findIndex((o) => o.kind === 'piece' && o.piece === id);
  if (i < 0) throw new Error(`piece ${id} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};
const pickMove = (uci: string) => (req: ChoiceRequest) => {
  const from = sq(uci.slice(0, 2));
  const to = sq(uci.slice(2, 4));
  const i = req.options.findIndex((o) => o.kind === 'move' && o.from === from && o.to === to);
  if (i < 0) throw new Error(`move ${uci} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};

describe('Quantum Kill (5.8, DD-97, DD-103)', () => {
  it('R-ABIL-005 module data: Captures, neutral, all, replay, 2 charges, level 13', () => {
    const def = abilityById.get('quantum_kill');
    expect(def).toMatchObject({
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: 'all',
      tags: ['replay'],
      minLevel: 13,
      slotCost: 1,
      limits: { perAction: 1, charges: 2 },
      conditions: [{ rank: { of: 'victim', cmp: '>', to: 'captor' } }],
    });
    expect(def?.attuned).toBeUndefined();
  });

  it("R-ABIL-002 R-ABIL-004 a pawn taking a knight also removes an enemy pawn of the owner's choice", () => {
    // e1 K=0, d4 P=1, e5 n=2, a7 p=3, h7 p=4, a8 r=5, e8 k=6.
    const r = scenario({
      fen: 'r3k3/p6p/8/4n3/3P4/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d4e5'],
      answers: [pickPiece(4)],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req).toMatchObject({ chooser: 'white', kind: 'target', purpose: 'capture' });
    // Only the pawns (rank 1) qualify; the rook and the king are never offered.
    expect(req.options).toEqual([
      { kind: 'piece', piece: 3, square: sq('a7') },
      { kind: 'piece', piece: 4, square: sq('h7') },
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'quantum_kill', piece: 1 }),
    ]);
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ victim: 2, by: 'move' }),
      expect.objectContaining({ victim: 4, by: 'effect' }),
    ]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'quantum_kill', remaining: 1 }),
    ]);
    expect(pieceAt(r.state, 'h7')).toBeUndefined();
    expect(pieceAt(r.state, 'a7')).toMatchObject({ type: 'pawn', side: 'black' });
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([]);
  });

  it('R-ABIL-002 INV-01 with no lesser enemy piece the captor may make one non-capturing move instead (declinable)', () => {
    // e1 K=0, d4 P=1, e5 n=2, e8 k=3.
    const r = scenario({
      fen: '4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d4e5'],
      answers: [pickMove('e5e6')],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req.kind).toBe('bonusMove');
    expect(req.options[0]).toEqual({ kind: 'decline' });
    expect(req.options.slice(1)).toEqual([{ kind: 'move', from: sq('e5'), to: sq('e6') }]);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([
      expect.objectContaining({ piece: 1, from: sq('e5'), to: sq('e6') }),
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(pieceAt(r.state, 'e6')).toMatchObject({ id: 1, type: 'pawn' });
  });

  it('R-RULES-004 DD-97 a knight taking a queen may remove a pawn, knight or bishop, never a rook or the king', () => {
    // e1 K=0, d4 N=1, c6 q=2, h7 p=3, e8 k=4, g8 n=5, h8 r=6.
    const r = scenario({
      fen: '4k1nr/7p/2q5/8/3N4/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d4c6'],
      answers: [pickPiece(5)],
    });
    const req = r.prompts[0] as ChoiceRequest;
    expect(req.options).toEqual([
      { kind: 'piece', piece: 3, square: sq('h7') },
      { kind: 'piece', piece: 5, square: sq('g8') },
    ]);
    expect(pieceAt(r.state, 'g8')).toBeUndefined();
    expect(pieceAt(r.state, 'h8')).toMatchObject({ type: 'rook' });
  });

  it('R-ABIL-004 DD-97 it does not trigger when the victim is not of higher rank (a queen taking a rook)', () => {
    // d1 Q=0, e1 K=1, d8 r=2, e8 k=3, h7 p=4.
    const r = scenario({
      fen: '3rk3/7p/8/8/8/8/8/3QK3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d1d8'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'h7')).toMatchObject({ type: 'pawn' });
  });

  it('R-ABIL-004 DD-17 two charges: the third qualifying capture by the same piece does not trigger', () => {
    // e1 K=0, d2 P=1, a7 p=2, b7 p=3, c7 p=4, e8 k=5, b3 n, c4 b? Use three enemy minor pieces the
    // pawn can take in turn: knights on e3, f4 and g5 with pawns to remove each time.
    // Layout: e1 K=0, d2 P=1, e3 n=2, f4 n=3, g5 n=4, a7 p=5, b7 p=6, c7 p=7, e8 k=8.
    const r = scenario({
      fen: '4k3/ppp5/8/6n1/5n2/4n3/3P4/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d2e3', 'e8d8', 'e3f4', 'd8e8', 'f4g5'],
      answers: [pickPiece(5), pickPiece(6)],
    });
    expect(r.prompts).toHaveLength(2);
    expect(eventsOf(r.steps[4]?.events ?? [], 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'c7')).toMatchObject({ type: 'pawn' });
    expect(pieceAt(r.state, 'a7')).toBeUndefined();
    expect(pieceAt(r.state, 'b7')).toBeUndefined();
  });

  it('R-ELEM-002 the foil silences it: an Ember pawn taking a Tide knight removes nothing', () => {
    const r = scenario({
      fen: 'r3k3/p6p/8/4n3/3P4/8/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['quantum_kill'] },
      black: { elements: ['tide'] },
      moves: ['d4e5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'quantum_kill' }),
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
  });
});
