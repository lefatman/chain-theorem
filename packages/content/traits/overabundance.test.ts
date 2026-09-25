/**
 * Overabundance scenario tests (Grove trait, R-ELEM-001, R-ELEM-007, E9, DD-14, DD-17).
 *
 * Expected behaviour comes from spec 6.1 (Overabundance rules), 5.4, 5.5 E9, 6.4 and DD-14 and
 * DD-17, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ElementId } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
// Start position ids: a1 rook 0, b1 knight 1, c1 bishop 2, d1 queen 3, a2 pawn 8.
const ROOK = 0;
const KNIGHT = 1;
const BISHOP = 2;
const PAWN = 8;

describe('overabundance (R-ELEM-007)', () => {
  it('R-ELEM-007 every consumable ability on a Grove piece starts with double the charges', () => {
    const grove = setup({
      white: { elements: ['grove'], abilities: ['momentum', 'rebirth', 'reinforce'] },
    });
    expect(grove.engine.remainingCharges(grove.state, KNIGHT, 'momentum')).toBe(4);
    expect(grove.engine.remainingCharges(grove.state, BISHOP, 'rebirth')).toBe(2);
    expect(grove.engine.remainingCharges(grove.state, PAWN, 'reinforce')).toBe(2);
  });

  it('R-ELEM-007 R-ELEM-001 pieces of every other element keep the listed charges', () => {
    const others: ElementId[] = ['ember', 'tide', 'storm', 'stone', 'frost', 'neutral'];
    for (const element of others) {
      const s = setup({
        white: { elements: [element], abilities: ['momentum', 'rebirth', 'reinforce'] },
      });
      expect(s.engine.remainingCharges(s.state, KNIGHT, 'momentum'), element).toBe(2);
      expect(s.engine.remainingCharges(s.state, BISHOP, 'rebirth'), element).toBe(1);
      expect(s.engine.remainingCharges(s.state, PAWN, 'reinforce'), element).toBe(1);
    }
  });

  it('R-ELEM-007 abilities without charges are unaffected', () => {
    const grove = setup({
      white: { elements: ['grove'], abilities: ['poisoned_meat', 'hit_and_run', 'cleave'] },
    });
    for (const id of ['poisoned_meat', 'hit_and_run', 'cleave'])
      expect(grove.engine.remainingCharges(grove.state, KNIGHT, id), id).toBe(Infinity);
  });

  it('R-ELEM-007 R-ELEM-004 Overabundance applies per piece under Blended Family', () => {
    const a = setup({
      white: { elements: ['grove', 'ember'], items: ['blended_family'], abilities: ['momentum'] },
    });
    expect(a.engine.remainingCharges(a.state, KNIGHT, 'momentum')).toBe(4); // group A: Grove
    expect(a.engine.remainingCharges(a.state, ROOK, 'momentum')).toBe(2); // group B: Ember
    const b = setup({
      white: { elements: ['ember', 'grove'], items: ['blended_family'], abilities: ['momentum'] },
    });
    expect(b.engine.remainingCharges(b.state, KNIGHT, 'momentum')).toBe(2);
    expect(b.engine.remainingCharges(b.state, ROOK, 'momentum')).toBe(4);
  });

  it('R-ELEM-007 E9 R-ABIL-004 a Grove bishop with Rebirth returns twice; charges persist through revival and the third capture is final', () => {
    // 1... Bf5 2. Qxf5 (back to c8) 2... Bd7 3. Qxd7 (back to c8) 3... Bb7 4. Qxb7 (gone).
    const r = scenario({
      fen: '2b4k/8/8/8/8/8/8/4KQ2 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['c8f5', 'f1f5', 'c8d7', 'f5d7', 'c8b7', 'd7b7'],
      // Attuned Rebirth (Grove bearer) offers the back rank; the owner picks the start square.
      answers: [
        { kind: 'square', square: sq('c8') },
        { kind: 'square', square: sq('c8') },
      ],
    });
    const bishop = idAt(r.initial, 'c8');
    expect(r.engine.remainingCharges(r.initial, bishop, 'rebirth')).toBe(2);
    const step = (i: number) => r.steps[i]?.events ?? [];

    expect(eventsOf(step(1), 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: bishop, square: sq('c8') }),
    ]);
    expect(eventsOf(step(1), 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: bishop, ability: 'rebirth', remaining: 1 }),
    ]);
    expect(eventsOf(step(3), 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: bishop, square: sq('c8') }),
    ]);
    expect(eventsOf(step(3), 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: bishop, ability: 'rebirth', remaining: 0 }),
    ]);
    // The same identity came back each time (it is the piece that moves next).
    expect(eventsOf(step(2), 'MoveMade')[0]).toMatchObject({ piece: bishop });
    expect(eventsOf(step(4), 'MoveMade')[0]).toMatchObject({ piece: bishop });

    // DD-17: with no charges left Rebirth does not trigger at all.
    expect(eventsOf(step(5), 'Captured')).toEqual([
      expect.objectContaining({ victim: bishop, by: 'move' }),
    ]);
    expect(eventsOf(step(5), 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(step(5), 'PieceRevived')).toEqual([]);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(r.prompts).toHaveLength(2);
    expect(r.state.usage[`${bishop}:rebirth`]).toBe(2);
    expect(r.engine.remainingCharges(r.state, bishop, 'rebirth')).toBe(0);
  });

  it('R-ELEM-007 E9 a non-Grove bishop with Rebirth returns only once', () => {
    const r = scenario({
      fen: '2b4k/8/8/8/8/8/8/4KQ2 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['tide'], abilities: ['rebirth'] },
      moves: ['c8f5', 'f1f5', 'c8d7', 'f5d7'],
    });
    const bishop = idAt(r.initial, 'c8');
    expect(eventsOf(r.steps[1]?.events ?? [], 'PieceRevived')).toHaveLength(1);
    expect(eventsOf(r.steps[3]?.events ?? [], 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.steps[3]?.events ?? [], 'PieceRevived')).toEqual([]);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c8')).toBeUndefined();
  });

  it('R-ELEM-007 DD-17 a Grove knight spends one of its four Momentum charges per bonus move', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['grove'], abilities: ['momentum'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
      answers: [{ kind: 'move', from: sq('d5'), to: sq('b4') }],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: knight, ability: 'momentum', remaining: 3 }),
    ]);
    expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(3);
    expect(pieceAt(r.state, 'b4')?.id).toBe(knight);
  });

  it('R-ELEM-007 DD-43 R-RULES-002 the doubling is fixed at battle start: an Ember pawn promoted to a Grove queen keeps single charges', () => {
    const r = scenario({
      fen: '4k3/6P1/8/8/8/8/8/4K3 w - - 0 1',
      white: { elements: ['ember', 'grove'], items: ['blended_family'], abilities: ['momentum'] },
      black: { elements: ['neutral'] },
      moves: ['g7g8q'],
    });
    const pawn = idAt(r.initial, 'g7');
    expect(r.engine.remainingCharges(r.initial, pawn, 'momentum')).toBe(2);
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, to: 'queen', element: 'grove' }),
    ]);
    // "A Grove piece starts each battle with double the charges": this piece did not start as one.
    expect(r.engine.remainingCharges(r.state, pawn, 'momentum')).toBe(2);
  });

  it('R-ELEM-007 DD-43 R-RULES-002 a Grove pawn promoted to an Ember queen keeps its doubled charges', () => {
    const r = scenario({
      fen: '4k3/6P1/8/8/8/8/8/4K3 w - - 0 1',
      white: { elements: ['grove', 'ember'], items: ['blended_family'], abilities: ['momentum'] },
      black: { elements: ['neutral'] },
      moves: ['g7g8q'],
    });
    const pawn = idAt(r.initial, 'g7');
    expect(r.engine.remainingCharges(r.initial, pawn, 'momentum')).toBe(4);
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, to: 'queen', element: 'ember' }),
    ]);
    expect(r.engine.remainingCharges(r.state, pawn, 'momentum')).toBe(4);
  });
});
