/**
 * Permafrost scenario tests (R-ABIL-005, M7 7.3): Captured, Frost, all. Send the captor back to its
 * starting square, if empty. Attuned (Frost bearer): also send one other enemy knight, bishop, rook
 * or queen adjacent to this square back to its starting square.
 *
 * Starting squares are the pieces' identities' starts (DD-22): FEN pieces start where the FEN puts
 * them, so the pieces here move away first. Expected behaviour comes from spec 5.2 (MOVE), 5.4 (last
 * known square), 6.2, 6.3 and DD-18, DD-22, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// White: king e1, knight g1, bishop c4; black: king a8, pawn f7 (the Permafrost bearer). The knight
// goes g1-f3-e5 and the bishop c4-e6 before the knight takes f7.
const FEN = 'k7/5p2/8/8/2B5/8/8/4K1N1 w - - 0 1';
const MOVES = ['g1f3', 'a8b8', 'f3e5', 'b8a8', 'c4e6', 'a8b8', 'e5f7'];

describe('permafrost (R-ABIL-005)', () => {
  it('R-ABIL-005 permafrost is a level-20, 1-slot Frost When-captured card with 1 charge', () => {
    expect(abilityById.get('permafrost')).toMatchObject({
      category: 'CAPTURED',
      affinity: 'frost',
      eligible: 'all',
      tags: [],
      minLevel: 20,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
    });
  });

  it('R-ABIL-005 DD-17 R-ELEM-007 the push spends the charge; Overabundance gives a Grove piece 2', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['permafrost'] }, moves: MOVES });
    const pawn = idAt(r.initial, 'f7');
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: pawn, ability: 'permafrost', remaining: 0 }),
    ]);
    const grove = scenario({ fen: FEN, black: { elements: ['grove'], abilities: ['permafrost'] } });
    expect(grove.engine.remainingCharges(grove.state, idAt(grove.state, 'f7'), 'permafrost')).toBe(
      2,
    );
  });

  it('R-ABIL-001 R-ABIL-002 when captured, the captor is sent back to its starting square; the capture stands', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['permafrost'] }, moves: MOVES });
    const knight = idAt(r.initial, 'g1');
    const last = r.steps[6]?.events ?? [];
    expect(eventsOf(last, 'Captured')).toHaveLength(1);
    expect(eventsOf(last, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('f7'), to: sq('g1') }),
    ]);
    expect(pieceAt(r.state, 'g1')?.id).toBe(knight);
    expect(pieceAt(r.state, 'f7')).toBeUndefined();
    expect(pieceAt(r.state, 'e6')?.type).toBe('bishop');
  });

  it('R-ABIL-004 an occupied starting square makes the move fizzle (occupied)', () => {
    const r = scenario({
      fen: 'k7/5p2/8/8/8/8/8/4K1NR w - - 0 1',
      black: { abilities: ['permafrost'] },
      moves: ['g1f3', 'a8b8', 'h1g1', 'b8a8', 'f3e5', 'a8b8', 'e5f7'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'permafrost', effect: 'move', reason: 'occupied' }),
    ]);
    expect(pieceAt(r.state, 'f7')?.type).toBe('knight');
    // DD-17: a fully fizzled activation spends no charge.
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });

  it('R-ELEM-003 attuned (Frost bearer): the bishop next to f7 is sent home to c4 as well', () => {
    const r = scenario({
      fen: FEN,
      black: { elements: ['frost'], abilities: ['permafrost'] },
      moves: MOVES,
    });
    const bishop = idAt(r.initial, 'c4');
    expect(eventsOf(r.events, 'AbilityTriggered').at(-1)).toMatchObject({
      ability: 'permafrost',
      attuned: true,
    });
    expect(pieceAt(r.state, 'g1')?.type).toBe('knight');
    expect(pieceAt(r.state, 'c4')?.id).toBe(bishop);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-ELEM-002 a Storm captor silences Permafrost on a Frost victim (Storm beats Frost)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'] },
      black: { elements: ['frost'], abilities: ['permafrost'] },
      moves: MOVES,
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['permafrost']);
    expect(pieceAt(r.state, 'f7')?.type).toBe('knight');
  });

  it('R-INFO-005 R-SEC-001 before it fires, White’s projection never names Permafrost', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['permafrost'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'white'))).not.toContain('permafrost');
  });
});
