/**
 * Phalanx scenario tests (R-ABIL-005, M7 7.3): Capturing, Stone, all. When one of the owner's pawns
 * captures, negate the victim's When-captured abilities for this capture. Attuned (Stone bearer):
 * also when a knight or bishop captures.
 *
 * Expected behaviour comes from spec 5.2 (NEGATE), 5.3 (phase 2), 5.6 (conditions), 6.2, 6.3, 8.2
 * and DD-36, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

// White pawn e4 (and knight c3) can take the Poisoned Meat pawn d5.
const FEN = '4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1';

describe('phalanx (R-ABIL-005)', () => {
  it('R-ABIL-005 phalanx is a level-10, 1-slot Stone When-capturing card that needs a pawn captor', () => {
    expect(abilityById.get('phalanx')).toMatchObject({
      category: 'CAPTURING',
      affinity: 'stone',
      eligible: 'all',
      tags: [],
      minLevel: 10,
      slotCost: 1,
      conditions: [{ captorTypeIs: ['pawn'] }],
    });
    expect(abilityById.get('phalanx')?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-003 a capturing pawn negates the victim’s Poisoned Meat (revealed as negated) and survives', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['e4d5'],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['phalanx']);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        ability: 'poisoned_meat',
        side: 'black',
        source: expect.objectContaining({ kind: 'ability', id: 'phalanx' }),
      }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(pawn);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    expect(r.state.reveals.white.abilities.pawn).toEqual(['phalanx']);
  });

  it('R-ABIL-005 a knight captor does not trigger the base version (and it stays hidden)', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.reveals.white.abilities.knight).toBeUndefined();
  });

  it('R-ELEM-003 attuned (Stone bearer): a knight captor is covered too', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['phalanx'] },
      black: { elements: ['stone'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'phalanx', attuned: true }),
    ]);
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
  });

  it('R-ELEM-002 a Frost victim silences a Stone captor’s Phalanx (Frost beats Stone), so the Poisoned Meat resolves', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['phalanx'] },
      black: { elements: ['frost'], abilities: ['poisoned_meat'] },
      moves: ['e4d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['phalanx']);
    // The Stone pawn's Bulwark (6.1) still answers the first effect capture against it.
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'bulwark' }),
    ]);
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Phalanx', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['phalanx'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('phalanx');
  });
});
