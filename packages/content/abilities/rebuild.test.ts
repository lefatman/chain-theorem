/**
 * Rebuild scenario tests (R-ABIL-005, M7 7.3): Captures, Stone, all, revive, 1 charge. After
 * capturing a rook or queen, revive the owner's most recently captured rook on its starting square.
 * Attuned (Stone bearer): also after capturing a knight or bishop.
 *
 * Expected behaviour comes from spec 5.2 (REVIVE), 5.4 (identity and usage counters), 5.6
 * (conditions), 6.1 (Overabundance), 6.3, 7.2 (Warden's Stopwatch) and DD-17, DD-22, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

// White rook h1 steps to h5 and is taken by the bishop e8; then the queen d1 takes the rook d7 (or
// the knight d7 in KNIGHT).
const FEN = 'k3b3/3r4/8/8/8/8/8/3QK2R w - - 0 1';
const KNIGHT = 'k3b3/3n4/8/8/8/8/8/3QK2R w - - 0 1';
const MOVES = ['h1h5', 'e8h5', 'd1d7'];

describe('rebuild (R-ABIL-005)', () => {
  it('R-ABIL-005 rebuild is a level-17, 1-slot Stone After-capturing card with the revive tag and 1 charge', () => {
    expect(abilityById.get('rebuild')).toMatchObject({
      category: 'CAPTURES',
      affinity: 'stone',
      eligible: 'all',
      tags: ['revive'],
      minLevel: 17,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ victimTypeIs: ['rook', 'queen'] }],
    });
  });

  it('R-ABIL-002 after capturing a rook, the most recently captured rook returns to its starting square and a charge is spent', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['rebuild'] }, moves: MOVES });
    const rook = idAt(r.initial, 'h1');
    const queen = idAt(r.initial, 'd1');
    expect(eventsOf(r.steps[2]?.events ?? [], 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: rook, square: pieceAt(r.initial, 'h1')?.start }),
    ]);
    expect(pieceAt(r.state, 'h1')?.id).toBe(rook);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: queen, ability: 'rebuild', remaining: 0 }),
    ]);
  });

  it('R-ABIL-005 R-ELEM-003 the base version ignores a knight victim (not revealed); attuned (Stone) it triggers', () => {
    const base = scenario({ fen: KNIGHT, white: { abilities: ['rebuild'] }, moves: MOVES });
    expect(eventsOf(base.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(base.state, 'h1')).toBeUndefined();
    const attuned = scenario({
      fen: KNIGHT,
      white: { elements: ['stone'], abilities: ['rebuild'] },
      moves: MOVES,
    });
    expect(eventsOf(attuned.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'rebuild', attuned: true }),
    ]);
    expect(pieceAt(attuned.state, 'h1')?.type).toBe('rook');
  });

  it('R-ABIL-004 DD-17 with no captured rook it fizzles (no target) and spends no charge', () => {
    const r = scenario({
      fen: 'k7/3r4/8/8/8/8/8/3QK2R w - - 0 1',
      white: { abilities: ['rebuild'] },
      moves: ['d1d7'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'rebuild', effect: 'revive', reason: 'no_target' }),
    ]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });

  it('R-ELEM-007 Overabundance gives a Grove piece 2 charges', () => {
    const r = scenario({ fen: FEN, white: { elements: ['grove'], abilities: ['rebuild'] } });
    expect(r.engine.remainingCharges(r.state, idAt(r.state, 'd1'), 'rebuild')).toBe(2);
  });

  it('R-LOAD-002 D-39 Warden’s Stopwatch negates Rebuild (revive)', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['rebuild'] },
      black: { items: ['wardens_stopwatch'] },
      moves: MOVES,
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['rebuild']);
    expect(pieceAt(r.state, 'h1')).toBeUndefined();
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Rebuild', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['rebuild'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('rebuild');
  });
});
