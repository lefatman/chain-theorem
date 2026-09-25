/**
 * Stonewall scenario tests (R-ABIL-005, M7 7.3): Captured, Stone, all. Negate the captor's
 * After-capturing abilities for this capture. Attuned (Stone bearer): also reveal all abilities of
 * the captor's piece type.
 *
 * Expected behaviour comes from spec 5.2 (NEGATE), 5.3 (phase 4 queue order), 6.1 (Always First,
 * Stillness), 6.2, 6.3, 8.2 and DD-36, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

// Knight c3 takes the pawn d5 (the Stonewall bearer); a black pawn e6 is diagonal to d5 (Cleave).
const FEN = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';

describe('stonewall (R-ABIL-005)', () => {
  it('R-ABIL-005 stonewall is a level-6, 1-slot Stone When-captured card', () => {
    expect(abilityById.get('stonewall')).toMatchObject({
      category: 'CAPTURED',
      affinity: 'stone',
      eligible: 'all',
      tags: [],
      minLevel: 6,
      slotCost: 1,
    });
    expect(abilityById.get('stonewall')?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-004 when captured, the captor’s After-capturing Cleave is negated (and revealed as negated)', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['cleave'] },
      black: { abilities: ['stonewall'] },
      moves: ['c3d5'],
    });
    const pawn = idAt(r.initial, 'd5');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['stonewall']);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        ability: 'cleave',
        side: 'white',
        source: expect.objectContaining({ kind: 'ability', id: 'stonewall', piece: pawn }),
      }),
    ]);
    expect(pieceAt(r.state, 'e6')?.type).toBe('pawn');
    expect(r.state.reveals.white.abilities.knight).toEqual(['cleave']);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['stonewall']);
  });

  it('R-ELEM-003 attuned (Stone bearer): also reveals the captor’s whole set', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['cleave', 'momentum'] },
      black: { elements: ['stone'], abilities: ['stonewall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'stonewall',
      attuned: true,
    });
    expect(r.state.reveals.white.complete).toContain('knight');
    expect(r.state.reveals.white.abilities.knight).toEqual(
      expect.arrayContaining(['cleave', 'momentum']),
    );
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual([
      'cleave',
      'momentum',
    ]);
  });

  it('R-ELEM-001 Always First: a Storm captor’s After-capturing abilities resolve before Stonewall, so it has nothing left to negate', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'], abilities: ['cleave'] },
      black: { elements: ['tide'], abilities: ['stonewall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'cleave',
      'stonewall',
    ]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([]);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-ELEM-002 a Frost captor silences Stonewall on a Stone victim (Frost beats Stone)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['frost'], abilities: ['cleave'] },
      black: { elements: ['stone'], abilities: ['stonewall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['stonewall']);
    // Cleave resolves, but the Stone pawn e6's Bulwark answers the first effect capture (6.1).
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'cleave', reason: 'bulwark' }),
    ]);
    expect(pieceAt(r.state, 'e6')?.type).toBe('pawn');
  });

  it('R-INFO-005 R-SEC-001 before it fires, White’s projection never names Stonewall', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['stonewall'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'white'))).not.toContain('stonewall');
  });
});
