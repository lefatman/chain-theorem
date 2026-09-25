/**
 * Frost Heave scenario tests (R-ABIL-005, M7 7.3): Captured, Frost, all. Push the captor back to the
 * square it moved from, if empty. Attuned (Frost bearer): the owner may instead place a non-pawn
 * captor on any empty square adjacent to that square; a pawn always goes straight back.
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 5.2 (MOVE), 5.4, 6.1-6.3 and DD-18, DD-19, not
 * from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
/** Knight c3 takes the pawn d5 (the Frost Heave bearer). */
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('frost heave (R-ABIL-005)', () => {
  it('R-ABIL-005 frost heave is a level-3, 1-slot Frost When-captured card', () => {
    expect(abilityById.get('frost_heave')).toMatchObject({
      category: 'CAPTURED',
      affinity: 'frost',
      eligible: 'all',
      tags: [],
      minLevel: 3,
      slotCost: 1,
    });
  });

  it('R-ABIL-001 R-ABIL-002 when captured, the captor is pushed back to its origin; the capture stands (D-03)', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['frost_heave'] }, moves: ['c3d5'] });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({
        piece: knight,
        from: sq('d5'),
        to: sq('c3'),
        source: expect.objectContaining({ kind: 'ability', id: 'frost_heave' }),
      }),
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.reveals.black.abilities.pawn).toEqual(['frost_heave']);
  });

  it('R-ELEM-003 DD-18 attuned (Frost bearer): the owner places the captor on a square next to its origin, offered from its side', () => {
    const r = scenario({
      fen: FEN,
      black: { elements: ['frost'], abilities: ['frost_heave'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('b2') }],
    });
    expect(r.prompts[0]?.chooser).toBe('black');
    // Black's square order starts at a8: rank 4 first, then rank 3 (with the origin c3), then rank 2.
    expect(r.prompts[0]?.options.map((o) => (o.kind === 'square' ? o.square : -1))).toEqual(
      ['b4', 'c4', 'd4', 'b3', 'c3', 'd3', 'b2', 'c2', 'd2'].map(sq),
    );
    expect(pieceAt(r.state, 'b2')?.type).toBe('knight');
    expect(eventsOf(r.events, 'AbilityTriggered')[0]?.attuned).toBe(true);
  });

  it('R-ELEM-003 attuned, a pawn captor always goes straight back (no prompt)', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
      black: { elements: ['frost'], abilities: ['frost_heave'] },
      moves: ['e4d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(pieceAt(r.state, 'e4')?.type).toBe('pawn');
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-004 loadout order: a Squall pawn move into the origin first makes the push fizzle (occupied)', () => {
    const push: ChoiceOption = { kind: 'move', from: sq('c4'), to: sq('c3') };
    const r = scenario({
      fen: '4k3/8/8/3p4/2p5/2N5/8/4K3 w - - 0 1',
      black: { abilities: ['squall', 'frost_heave'] },
      moves: ['c3d5'],
      answers: [push],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'frost_heave', effect: 'move', reason: 'occupied' }),
    ]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
  });

  it('INV-03 a king captor is pushed back unless that leaves it in check, in which case the push fizzles', () => {
    const safe = scenario({
      fen: '4k3/8/8/3p4/4K3/8/8/8 w - - 0 1',
      black: { abilities: ['frost_heave'] },
      moves: ['e4d5'],
    });
    expect(pieceAt(safe.state, 'e4')?.type).toBe('king');
    // The king escapes the rook e8's check by taking d5; pushing it back to e4 would put it in check.
    const check = scenario({
      fen: 'k3r3/8/8/3p4/4K3/8/8/8 w - - 0 1',
      black: { abilities: ['frost_heave'] },
      moves: ['e4d5'],
    });
    expect(eventsOf(check.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'frost_heave', reason: 'inv03' }),
    ]);
    expect(pieceAt(check.state, 'd5')?.type).toBe('king');
  });

  it('R-ELEM-002 a Storm captor silences Frost Heave on a Frost victim (Storm beats Frost)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'] },
      black: { elements: ['frost'], abilities: ['frost_heave'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['frost_heave']);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
  });

  it('R-INFO-005 R-SEC-001 before it fires, White’s projection never names Frost Heave', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['frost_heave'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'white'))).not.toContain('frost_heave');
  });
});
