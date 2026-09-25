/**
 * Slipstream scenario tests (R-ABIL-005, M7 7.3): Captures, Storm, all, replay, 1 charge. After
 * capturing a piece that is not a pawn, any friendly piece may make one non-capturing move.
 * Attuned (Storm bearer): triggers on any victim.
 *
 * Expected behaviour comes from spec 4.1 (INV-01), 5.3 (phase 4), 5.4, 5.6 (conditions, charges),
 * 6.1 (Always First, Overabundance), 6.3, 7.2 (Warden's Stopwatch) and DD-17, DD-18, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const mv = (from: string, to: string): ChoiceOption => ({
  kind: 'move',
  from: sq(from),
  to: sq(to),
});
// Knight c3 takes a black knight d5 (or a pawn on e5 via e4 in the pawn case); a white rook a1.
const KNIGHT = '4k3/8/8/3n4/8/2N5/8/R3K3 w - - 0 1';
const PAWN = '4k3/8/8/3p4/8/2N5/8/R3K3 w - - 0 1';

describe('slipstream (R-ABIL-005)', () => {
  it('R-ABIL-005 slipstream is a level-12, 1-slot Storm After-capturing card with 1 charge, replay, and a non-pawn condition', () => {
    expect(abilityById.get('slipstream')).toMatchObject({
      category: 'CAPTURES',
      affinity: 'storm',
      eligible: 'all',
      tags: ['replay'],
      minLevel: 12,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ victimTypeNot: 'pawn' }],
    });
  });

  it('R-ABIL-001 DD-18 after capturing a non-pawn, any friendly piece may make one non-capturing move', () => {
    const r = scenario({
      fen: KNIGHT,
      white: { abilities: ['slipstream'] },
      moves: ['c3d5'],
      answers: [mv('a1', 'a7')],
    });
    const options = r.prompts[0]?.options ?? [];
    expect(options[0]).toEqual({ kind: 'decline' });
    expect(options).toContainEqual(mv('a1', 'a7'));
    expect(options).toContainEqual(mv('d5', 'f6'));
    expect(options).toContainEqual(mv('e1', 'd2'));
    expect(pieceAt(r.state, 'a7')?.type).toBe('rook');
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: knight, ability: 'slipstream', remaining: 0 }),
    ]);
  });

  it('R-ABIL-005 DD-17 the charge is spent once, then it never triggers again; a declined bonus spends nothing', () => {
    const declined = scenario({
      fen: KNIGHT,
      white: { abilities: ['slipstream'] },
      moves: ['c3d5'],
      answers: [0],
    });
    expect(eventsOf(declined.events, 'ChargeSpent')).toEqual([]);
    const knight = idAt(declined.initial, 'c3');
    expect(declined.engine.remainingCharges(declined.state, knight, 'slipstream')).toBe(1);
    // The same knight later takes a second knight on a8: its only charge is gone, so no trigger.
    const twice = scenario({
      fen: 'n3k3/8/8/3n4/8/2N5/8/R3K3 w - - 0 1',
      white: { abilities: ['slipstream'] },
      moves: ['c3d5', 'e8f8', 'd5b6', 'f8e8', 'b6a8'],
      answers: [mv('e1', 'd1')],
    });
    expect(pieceAt(twice.state, 'a8')?.type).toBe('knight');
    expect(eventsOf(twice.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'slipstream',
    ]);
  });

  it('R-ABIL-005 the base version does not trigger on a pawn (and is not revealed); attuned (Storm) it does', () => {
    const base = scenario({ fen: PAWN, white: { abilities: ['slipstream'] }, moves: ['c3d5'] });
    expect(eventsOf(base.events, 'AbilityTriggered')).toEqual([]);
    expect(base.state.reveals.white.abilities.knight).toBeUndefined();
    const attuned = scenario({
      fen: PAWN,
      white: { elements: ['storm'], abilities: ['slipstream'] },
      moves: ['c3d5'],
      answers: [mv('a1', 'a2')],
    });
    expect(eventsOf(attuned.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'slipstream', attuned: true }),
    ]);
    expect(pieceAt(attuned.state, 'a2')?.type).toBe('rook');
  });

  it('R-ELEM-001 Always First: a Storm captor’s bonus move comes before the victim’s When-captured abilities', () => {
    const r = scenario({
      fen: KNIGHT,
      white: { elements: ['storm'], abilities: ['slipstream'] },
      black: { abilities: ['last_word'] },
      moves: ['c3d5'],
      answers: [mv('a1', 'a7')],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'slipstream',
      'last_word',
    ]);
    const tide = scenario({
      fen: KNIGHT,
      white: { elements: ['tide'], abilities: ['slipstream'] },
      black: { abilities: ['last_word'] },
      moves: ['c3d5'],
      answers: [mv('a1', 'a7')],
    });
    expect(eventsOf(tide.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'last_word',
      'slipstream',
    ]);
  });

  it('R-ELEM-007 Overabundance doubles the charge on a Grove piece', () => {
    const r = scenario({ fen: KNIGHT, white: { elements: ['grove'], abilities: ['slipstream'] } });
    expect(r.engine.remainingCharges(r.state, idAt(r.state, 'c3'), 'slipstream')).toBe(2);
  });

  it('R-LOAD-002 D-39 Warden’s Stopwatch negates Slipstream (replay) and spends nothing', () => {
    const r = scenario({
      fen: KNIGHT,
      white: { abilities: ['slipstream'], items: ['wardens_stopwatch'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['slipstream']);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Slipstream', () => {
    const r = scenario({ fen: KNIGHT, white: { abilities: ['slipstream'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('slipstream');
  });
});
