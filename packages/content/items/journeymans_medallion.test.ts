/**
 * Journeyman's Medallion scenario tests (R-LOAD-002, spec 7.2): capacity 4 for 3 item slots, min
 * level 12, capacity items never stack (exclusive group 'capacity'). The Flexible build (7.3) uses it.
 *
 * Expected behaviour comes from spec 5.3, 5.4 (ordering), 7.1-7.4 and DD-13, not from the engine's
 * current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

const ID = 'journeymans_medallion';
const OTHER_CAPACITY = ['dual_adepts_glove', 'triple_adepts_gloves', 'headmaster_ring'];
const FOUR = ['scout', 'pierce', 'cleave', 'hit_and_run'];

function loadout(items: string[], sets: string[][], elements: Loadout['elements'] = ['tide']) {
  return { elements, items, sets } satisfies Loadout;
}

// White knight c3 takes the black pawn d5; a second black pawn e6 is diagonally adjacent to d5.
const CAPTOR_FEN = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';

describe("journeyman's medallion (R-LOAD-002)", () => {
  it("R-LOAD-002 DD-13 Journeyman's Medallion gives capacity 4 for 3 slots at min level 12 in the capacity group", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(3);
    expect(def?.minLevel).toBe(12);
    expect(def?.capacity).toBe(4);
    expect(def?.exclusiveGroup).toBe('capacity');
  });

  it('R-LOAD-002 R-LOAD-004 R-LOAD-001 at level 12 the Medallion fills all 3 slots and allows a four-ability set', () => {
    const v = engine.validateLoadout(loadout([ID], [FOUR]), { level: 12 });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.capacity).toBe(4);
    expect(v.consumedSlots).toBe(3);
    expect(v.unlockedSlots).toBe(3);
  });

  it('R-LOAD-002 R-LOAD-004 at level 11 the Medallion fits the slots but fails only its level requirement (rule 2)', () => {
    const v = engine.validateLoadout(loadout([ID], [FOUR]), { level: 11 });
    expect(v.ok).toBe(false);
    expect(v.unlockedSlots).toBe(3);
    expect(v.errors.map((e) => [e.rule, e.code, e.ref])).toEqual([[2, 'item_level', ID]]);
  });

  it('R-LOAD-002 R-LOAD-004 a five-ability set exceeds the Medallion capacity of 4 (rule 4)', () => {
    const v = engine.validateLoadout(loadout([ID], [[...FOUR, 'last_word']]), { level: 12 });
    expect(v.ok).toBe(false);
    expect(v.capacity).toBe(4);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-001 R-LOAD-004 the Medallion plus a 1-slot utility needs 4 slots: rejected at level 12, accepted at level 15', () => {
    const l = loadout([ID, 'scouts_lens'], [FOUR]);
    const at12 = engine.validateLoadout(l, { level: 12 });
    expect(at12.ok).toBe(false);
    expect(at12.consumedSlots).toBe(4);
    expect(at12.errors).toContainEqual(
      expect.objectContaining({ rule: 1, code: 'slots_exceeded' }),
    );
    expect(engine.validateLoadout(l, { level: 15 }).errors).toEqual([]);
  });

  it('R-LOAD-002 R-LOAD-003 R-LOAD-004 the Flexible build (Medallion, Schedule, Blended Family, one utility) uses 6 slots for 24 selections', () => {
    const sets = [
      FOUR,
      FOUR,
      FOUR,
      ['scout', 'pierce', 'antidote', 'last_word'],
      ['poisoned_meat', 'pierce', 'cleave', 'hit_and_run'],
      ['scout', 'pierce', 'antidote', 'stalwart'],
    ];
    const l = loadout([ID, 'multitaskers_schedule', 'blended_family', 'scouts_lens'], sets, [
      'tide',
      'grove',
    ]);
    const v = engine.validateLoadout(l, { level: 25 });
    expect(v.errors).toEqual([]);
    expect(v.consumedSlots).toBe(6);
    expect(v.capacity).toBe(4);
    expect(sets.flat()).toHaveLength(24);
    // At level 20 only 5 slots are unlocked.
    expect(engine.validateLoadout(l, { level: 20 }).errors).toContainEqual(
      expect.objectContaining({ rule: 1, code: 'slots_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-004 capacity items never stack: the Medallion with any other capacity item breaks the exclusive group (rule 3)', () => {
    for (const other of OTHER_CAPACITY) {
      const v = engine.validateLoadout(loadout([ID, other], [['scout']]), { level: 30 });
      expect(v.ok, other).toBe(false);
      expect(v.errors, other).toContainEqual(
        expect.objectContaining({ rule: 3, code: 'exclusive_group' }),
      );
    }
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-003 R-ABIL-004 with capacity 4 all four abilities trigger in loadout order', () => {
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: FOUR },
      black: {},
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawnD5 = idAt(r.initial, 'd5');
    const pawnE6 = idAt(r.initial, 'e6');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual(
      FOUR.map((a) => [knight, a]),
    );
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    // d5 by the move, then e6 by Cleave; Hit and Run returned the knight to c3.
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [pawnD5, 'move'],
      [pawnE6, 'effect'],
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-004 swapping two Captures abilities in the set swaps their resolution order', () => {
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: ['scout', 'pierce', 'hit_and_run', 'cleave'] },
      black: {},
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'scout',
      'pierce',
      'hit_and_run',
      'cleave',
    ]);
  });
});
