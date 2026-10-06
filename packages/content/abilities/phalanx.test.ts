/**
 * Phalanx scenario tests (R-ABIL-005, M7 7.3; neutral since DD-98): Capturing, neutral, all. When
 * one of the owner's pawns, knights or bishops captures, negate the victim's When-captured abilities
 * for this capture. Knights and bishops were the attuned extension until DD-98 folded them into the
 * base condition; there is no attuned version, whatever the bearer's element.
 *
 * Expected behaviour comes from spec 5.2 (NEGATE), 5.3 (phase 2), 5.6 (conditions), 6.2, 6.3, 8.2
 * and DD-36, DD-98, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

// White pawn e4 (and knight c3) can take the Poisoned Meat pawn d5.
const FEN = '4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1';
// White bishop g2 can take d5 along the long diagonal.
const BISHOP = '4k3/8/8/3p4/8/8/6B1/4K3 w - - 0 1';
// White rook d1 can take d5 down the open d-file.
const ROOK = '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1';

describe('phalanx (R-ABIL-005)', () => {
  it('R-ABIL-005 phalanx is a level-10, 1-slot neutral When-capturing card that needs a pawn, knight or bishop captor (DD-98)', () => {
    expect(abilityById.get('phalanx')).toMatchObject({
      category: 'CAPTURING',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 10,
      slotCost: 1,
      conditions: [{ captorTypeIs: ['pawn', 'knight', 'bishop'] }],
    });
    expect(abilityById.get('phalanx')?.limits.charges).toBeUndefined();
    expect(abilityById.get('phalanx')?.attuned).toBeUndefined();
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

  it('R-ABIL-005 DD-98 a knight or bishop captor is covered by the base version on a neutral bearer', () => {
    for (const [fen, uci, type] of [
      [FEN, 'c3d5', 'knight'],
      [BISHOP, 'g2d5', 'bishop'],
    ] as const) {
      const r = scenario({
        fen,
        white: { abilities: ['phalanx'] },
        black: { abilities: ['poisoned_meat'] },
        moves: [uci],
      });
      expect(eventsOf(r.events, 'AbilityTriggered'), type).toEqual([
        expect.objectContaining({ ability: 'phalanx', attuned: false }),
      ]);
      expect(
        eventsOf(r.events, 'AbilityNegated').map((e) => e.ability),
        type,
      ).toEqual(['poisoned_meat']);
      expect(pieceAt(r.state, 'd5')?.type, type).toBe(type);
      expect(r.state.reveals.white.abilities[type], type).toEqual(['phalanx']);
    }
  });

  it('R-ABIL-005 a rook captor does not trigger it (and it stays hidden)', () => {
    const r = scenario({
      fen: ROOK,
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.reveals.white.abilities.rook).toBeUndefined();
  });

  it('R-ELEM-003 DD-98 a Tide knight is covered too, and nothing is attuned (no attuned version)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['phalanx'] },
      black: { elements: ['stone'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'phalanx', attuned: false }),
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
