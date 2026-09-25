/**
 * Headmaster Ring scenario tests (R-LOAD-002, spec 7.2): capacity 5 for 4 item slots, min level 20,
 * capacity items never stack (exclusive group 'capacity'). The Maximum and Focused builds (7.3) use it.
 *
 * Expected behaviour comes from spec 5.3, 5.4 (ordering), 7.1-7.4 and DD-13, not from the engine's
 * current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { CAPS, engine, itemById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

const ID = 'headmaster_ring';
const OTHER_CAPACITY = ['dual_adepts_glove', 'triple_adepts_gloves', 'journeymans_medallion'];
const FIVE = ['scout', 'pierce', 'antidote', 'cleave', 'hit_and_run'];

function loadout(items: string[], sets: string[][], elements: Loadout['elements'] = ['tide']) {
  return { elements, items, sets } satisfies Loadout;
}

// White knight c3 takes the black pawn d5; a second black pawn e6 is diagonally adjacent to d5.
const CAPTOR_FEN = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';

describe('headmaster ring (R-LOAD-002)', () => {
  it('R-LOAD-002 DD-13 Headmaster Ring gives capacity 5 (the maximum) for 4 slots at min level 20 in the capacity group', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(4);
    expect(def?.minLevel).toBe(20);
    expect(def?.capacity).toBe(5);
    expect(def?.capacity).toBe(CAPS.MAX_ABILITY_CAPACITY);
    expect(def?.exclusiveGroup).toBe('capacity');
  });

  it('R-LOAD-002 R-LOAD-004 R-LOAD-001 at level 20 the Ring uses 4 of 5 slots and allows a five-ability set', () => {
    const v = engine.validateLoadout(loadout([ID], [FIVE]), { level: 20 });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.capacity).toBe(5);
    expect(v.consumedSlots).toBe(4);
    expect(v.unlockedSlots).toBe(5);
  });

  it('R-LOAD-002 R-LOAD-004 at level 19 the Ring fits the 4 slots but fails only its level requirement (rule 2)', () => {
    const v = engine.validateLoadout(loadout([ID], [FIVE]), { level: 19 });
    expect(v.ok).toBe(false);
    expect(v.unlockedSlots).toBe(4);
    expect(v.errors.map((e) => [e.rule, e.code, e.ref])).toEqual([[2, 'item_level', ID]]);
  });

  it('R-LOAD-002 R-LOAD-004 a six-ability set exceeds the Ring capacity of 5 (rule 4)', () => {
    const v = engine.validateLoadout(loadout([ID], [[...FIVE, 'last_word']]), { level: 30 });
    expect(v.ok).toBe(false);
    expect(v.capacity).toBe(5);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-003 R-LOAD-004 the Maximum build (Ring, Schedule, Blended Family) fills 6 slots with 30 selections at level 25', () => {
    const sets = [
      FIVE,
      FIVE,
      FIVE,
      FIVE,
      FIVE,
      ['scout', 'pierce', 'antidote', 'cleave', 'stalwart'],
    ];
    const l = loadout([ID, 'multitaskers_schedule', 'blended_family'], sets, ['tide', 'ember']);
    const v = engine.validateLoadout(l, { level: 25 });
    expect(v.errors).toEqual([]);
    expect(v.consumedSlots).toBe(6);
    expect(v.unlockedSlots).toBe(6);
    expect(sets.flat()).toHaveLength(30);
    // At level 20 only 5 slots are unlocked.
    expect(engine.validateLoadout(l, { level: 20 }).errors).toContainEqual(
      expect.objectContaining({ rule: 1, code: 'slots_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-001 R-LOAD-004 the Focused build (Ring plus two utilities) fits 6 slots; a third utility does not', () => {
    const focused = loadout([ID, 'scouts_lens', 'resonance_crystal'], [FIVE]);
    expect(engine.validateLoadout(focused, { level: 25 }).errors).toEqual([]);
    expect(engine.validateLoadout(focused, { level: 20 }).errors).toContainEqual(
      expect.objectContaining({ rule: 1, code: 'slots_exceeded' }),
    );
    const over = loadout([ID, 'scouts_lens', 'resonance_crystal', 'wardens_stopwatch'], [FIVE]);
    const v = engine.validateLoadout(over, { level: 30 });
    expect(v.consumedSlots).toBe(7);
    expect(v.errors).toContainEqual(expect.objectContaining({ rule: 1, code: 'slots_exceeded' }));
  });

  it('R-LOAD-002 R-LOAD-004 capacity items never stack: the Ring with any other capacity item breaks the exclusive group (rule 3)', () => {
    for (const other of OTHER_CAPACITY) {
      const v = engine.validateLoadout(loadout([ID, other], [['scout']]), { level: 30 });
      expect(v.ok, other).toBe(false);
      expect(v.errors, other).toContainEqual(
        expect.objectContaining({ rule: 3, code: 'exclusive_group' }),
      );
    }
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-003 R-ABIL-004 with capacity 5 all five abilities trigger in loadout order', () => {
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: FIVE },
      black: {},
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawnD5 = idAt(r.initial, 'd5');
    const pawnE6 = idAt(r.initial, 'e6');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual(
      FIVE.map((a) => [knight, a]),
    );
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [pawnD5, 'move'],
      [pawnE6, 'effect'],
    ]);
    // The knight's full set is now visible to Black, piece type by piece type.
    expect(r.state.reveals.white.abilities.knight).toEqual(FIVE);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-004 a reversed five-ability set resolves each phase in the reversed loadout order', () => {
    const reversed = [...FIVE].reverse(); // hit_and_run, cleave, antidote, pierce, scout
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: reversed },
      black: {},
      moves: ['c3d5'],
    });
    // Capturing abilities (phase 2) first, then Captures abilities (phase 4), each in set order.
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'antidote',
      'pierce',
      'scout',
      'hit_and_run',
      'cleave',
    ]);
  });
});
