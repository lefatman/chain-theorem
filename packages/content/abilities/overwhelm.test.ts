/**
 * Overwhelm (5.7; designer brief 2026-10-09, plan item C6; DD-125): Capturing, neutral, all, 2
 * charges. "When capturing a piece of lower rank, negate the victim's When-captured abilities for this
 * capture." A rank-conditioned Pierce.
 *
 * Expected behaviour comes from spec 5.1 (rank order, DD-97), 5.2 (NEGATE), 5.3 (phase 2), 5.6
 * (conditions gate the trigger: no event, no reveal, no charge), 8.2, DD-17 (a NEGATE that resolves
 * spends its charge whether or not anything was negated), DD-36 and DD-125, not from the engine.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, scenario } from '../src/testing.ts';

const negated = (events: readonly { k: string }[]) =>
  eventsOf(events as never, 'AbilityNegated').map((e) => e.ability);
const charges = (events: readonly { k: string }[]) =>
  eventsOf(events as never, 'ChargeSpent').map((e) => [e.ability, e.remaining]);

describe('Overwhelm (5.7, DD-125)', () => {
  it('R-ABIL-005 module data: Capturing, neutral, all, level 9, 1 slot, 2 charges, a captor-outranks-victim condition, negates the victim’s Captured abilities', () => {
    const def = abilityById.get('overwhelm');
    expect(def).toMatchObject({
      category: 'CAPTURING',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 9,
      slotCost: 1,
      limits: { perAction: 1, charges: 2 },
      conditions: [{ rank: { of: 'captor', cmp: '>', to: 'victim' } }],
      effects: [{ op: 'negate', of: 'victim', categories: ['CAPTURED'] }],
    });
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-003 DD-97 DD-125 a rook (rank 3) takes a Poisoned Meat knight (rank 2): the retaliation is negated, the rook survives, a charge is spent', () => {
    // Ids: d1 R=0, e1 K=1, d5 n=2, e8 k=3.
    const r = scenario({
      fen: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1',
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    });
    expect(negated(r.events)).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'd5')).toBe(0);
    expect(charges(r.events)).toEqual([['overwhelm', 1]]);
    expect(r.state.reveals.white.abilities.rook).toEqual(['overwhelm']);
    expect(r.state.reveals.black.abilities.knight).toEqual(['poisoned_meat']);
  });

  it('DD-97 DD-125 equal rank is not lower: a knight taking a Poisoned Meat knight does not trigger Overwhelm and dies; nothing revealed, no charge', () => {
    const r = scenario({
      fen: '4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(negated(r.events)).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'd5')).toBe(-1);
    expect(charges(r.events)).toEqual([]);
    expect(r.state.reveals.white.abilities.knight ?? []).toEqual([]);
  });

  it('DD-97 DD-125 a lower-ranked captor triggers nothing either: a knight taking a Poisoned Meat rook dies', () => {
    const r = scenario({
      fen: '4k3/8/8/3r4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(negated(r.events)).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(-1);
    expect(charges(r.events)).toEqual([]);
  });

  it('R-ABIL-004 DD-17 the charge is spent whenever it fires, even against a victim with nothing to negate', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { abilities: ['overwhelm'] },
      moves: ['d1d5'],
    });
    expect(negated(r.events)).toEqual([]);
    expect(charges(r.events)).toEqual([['overwhelm', 1]]);
  });

  it('R-ABIL-004 DD-17 two charges per piece: the queen shrugs off two Poisoned Meat pawns, the third takes her', () => {
    // Ids: d1 Q=0, e1 K=1, d3 p=2, d5 p=3, d7 p=4, e8 k=5.
    const r = scenario({
      fen: '4k3/3p4/8/3p4/8/3p4/8/3QK3 w - - 0 1',
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['d1d3', 'e8f8', 'd3d5', 'f8e8', 'd5d7'],
    });
    expect(negated(r.events)).toEqual(['poisoned_meat', 'poisoned_meat']);
    expect(charges(r.events)).toEqual([
      ['overwhelm', 1],
      ['overwhelm', 0],
    ]);
    const last = r.steps[4]?.events ?? [];
    expect(eventsOf(last, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [4, 'move'],
      [0, 'effect'],
    ]);
    expect(r.state.pieces[0]?.square).toBe(-1);
    expect(r.state.usage['0:overwhelm']).toBe(2);
  });

  it('R-ELEM-002 the foil silences it like any Capturing card: a Grove rook taking an Ember Poisoned Meat knight is silenced and dies', () => {
    // Ember beats Grove (6.1): the Grove captor's abilities are silenced when it captures an Ember piece.
    const r = scenario({
      fen: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1',
      white: { elements: ['grove'], abilities: ['overwhelm'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['overwhelm']);
    expect(negated(r.events)).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(-1);
    expect(charges(r.events)).toEqual([]);
  });
});
