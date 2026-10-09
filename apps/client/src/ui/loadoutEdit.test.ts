/** Loadout builder draft shaping (R-LOAD-003, R-LOAD-004, R-ELEM-004); legality stays with the engine. */
import { describe, expect, it } from 'vitest';
import { abilityById, engine } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import {
  abilityBlock,
  equipItem,
  isKingSet,
  itemBlock,
  kingSlotAbilities,
  kingSlotsOf,
  levelForSlots,
  moveInSet,
  setPerType,
  shapeOf,
  unequipItem,
} from './loadoutEdit.ts';

const base: Loadout = { elements: ['grove'], items: ['dual_adepts_glove'], sets: [['scout']] };

describe('loadout builder helpers (R-LOAD-004)', () => {
  it('R-LOAD-004 rule 3: equipping a capacity item replaces the other capacity item', () => {
    const l = equipItem(base, 'triple_adepts_gloves');
    expect(l.items).toEqual(['triple_adepts_gloves']);
    expect(engine.validateLoadout(l, { level: 5 }).ok).toBe(true);
  });

  it('R-LOAD-004 rule 1: an item that does not fit the unlocked slots is blocked with a reason', () => {
    expect(itemBlock(base, 5, 'multitaskers_schedule')).toBe('Needs level 10');
    expect(itemBlock(base, 5, 'resonance_crystal')).toBe('Needs level 6');
    expect(itemBlock(base, 1, 'scouts_lens')).toBe('Needs level 3');
    expect(itemBlock(base, 4, 'scouts_lens')).toMatch(/Needs 1 free slot \(0 free\)/);
    // Swapping capacity items frees the old item's slots first.
    expect(itemBlock(base, 5, 'triple_adepts_gloves')).toBeNull();
  });

  it('R-ELEM-004 Blended Family adds a second, different element and removing it drops it', () => {
    const l = equipItem({ ...base, items: [] }, 'blended_family');
    expect(l.elements).toHaveLength(2);
    expect(l.elements[0]).toBe('grove');
    expect(l.elements[1]).not.toBe('grove');
    expect(unequipItem(l, 'blended_family').elements).toEqual(['grove']);
  });

  it("R-LOAD-003 Multitasker's Schedule allows six sets; removing it collapses to one", () => {
    const withSchedule = equipItem(base, 'multitaskers_schedule');
    const six = setPerType(withSchedule, true);
    expect(six.sets).toHaveLength(6);
    expect(engine.validateLoadout(six, { level: 10 }).ok).toBe(true);
    expect(unequipItem(six, 'multitaskers_schedule').sets).toEqual([['scout']]);
  });

  it('R-LOAD-004 items with an element parameter get a default choice that validates', () => {
    const l = equipItem(base, 'attunement_charm');
    expect(l.itemParams?.attunement_charm?.element).toBeDefined();
    expect(engine.validateLoadout(l, { level: 5 }).ok).toBe(true);
    expect(unequipItem(l, 'attunement_charm').itemParams).toBeUndefined();
  });

  it('R-LOAD-003 abilities are blocked by duplicates, capacity and level; order moves', () => {
    expect(abilityBlock(['scout'], 2, 30, 'scout')).toBe('Already in this set');
    expect(abilityBlock(['scout', 'pierce'], 2, 30, 'cleave')).toBe('Set is full (2)');
    expect(abilityBlock([], 2, 1, 'rebirth')).toBe('Needs level 14');
    expect(abilityBlock([], 2, 30, 'rebirth')).toBeNull();
    expect(moveInSet(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('R-LOAD-001 slot unlock levels follow the caps formula', () => {
    expect([1, 2, 3, 4, 5, 6].map(levelForSlots)).toEqual([1, 5, 10, 15, 20, 25]);
    expect(levelForSlots(7)).toBeNull();
  });
});

describe('king item slots (R-LOAD-004 rule 9, DD-109)', () => {
  /** Six per-type sets (Multitasker's Schedule) with only the king's set filled. */
  const sixSets = (king: string[]): Loadout['sets'] => [[], [], [], [], [], king];

  it('R-LOAD-004 DD-109 kingSlotsOf counts kingItemSlots in the set that applies to the king', () => {
    // The army-wide set applies to the king.
    expect(kingSlotsOf({ ...base, sets: [['stalwart']] })).toBe(1);
    expect(kingSlotsOf({ ...base, sets: [['scout', 'stalwart']] })).toBe(1);
    expect(kingSlotsOf(base)).toBe(0);
    // With six sets only the sixth (king) set counts.
    expect(kingSlotsOf({ ...base, sets: sixSets(['stalwart']) })).toBe(1);
    expect(kingSlotsOf({ ...base, sets: [['stalwart'], [], [], [], [], []] })).toBe(0);
    expect(kingSlotAbilities({ ...base, sets: sixSets(['stalwart']) })).toEqual([
      { def: abilityById.get('stalwart'), slots: 1 },
    ]);
    expect(kingSlotAbilities(base)).toEqual([]);
    expect(isKingSet(base, 0)).toBe(true);
    expect(isKingSet({ ...base, sets: sixSets([]) }, 0)).toBe(false);
    expect(isKingSet({ ...base, sets: sixSets([]) }, 5)).toBe(true);
  });

  it('R-LOAD-004 DD-109 itemBlock counts the king slot: 5 of 6 item slots and a Stalwart king block a 1-slot item', () => {
    // Level 25 unlocks six slots; items use five and Stalwart on the king uses the sixth.
    const l: Loadout = {
      elements: ['grove'],
      items: [
        'triple_adepts_gloves',
        'multitaskers_schedule',
        'resonance_crystal',
        'mooring_chain',
      ],
      sets: sixSets(['stalwart']),
    };
    expect(shapeOf(l.items).consumed).toBe(5);
    expect(itemBlock(l, 25, 'scouts_lens')).toBe('Needs 1 free slot (0 free)');
    // Without Stalwart on the king the sixth slot is free; Stalwart on pawns costs nothing.
    expect(itemBlock({ ...l, sets: sixSets([]) }, 25, 'scouts_lens')).toBeNull();
    expect(
      itemBlock({ ...l, sets: [['stalwart'], [], [], [], [], []] }, 25, 'scouts_lens'),
    ).toBeNull();
    // A capacity swap still frees the old item's slots first.
    expect(itemBlock(l, 25, 'dual_adepts_glove')).toBeNull();
  });

  it('R-LOAD-004 DD-109 abilityBlock: Stalwart needs a free item slot when the set applies to the king', () => {
    // Level 30 unlocks six slots and these items use all six.
    const full: Loadout = {
      elements: ['grove'],
      items: ['headmaster_ring', 'multitaskers_schedule', 'resonance_crystal'],
      sets: sixSets([]),
    };
    expect(shapeOf(full.items).consumed).toBe(6);
    expect(engine.validateLoadout(full, { level: 30 }).ok).toBe(true);
    const msg = 'Needs a free item slot: Stalwart on the king uses one';
    expect(abilityBlock([], 4, 30, 'stalwart', { loadout: full, appliesToKing: true })).toBe(msg);
    expect(abilityBlock([], 4, 30, 'stalwart', { loadout: full, appliesToKing: false })).toBeNull();
    // The army-wide set applies to the king too.
    const one: Loadout = { ...full, sets: [[]] };
    expect(
      abilityBlock([], 4, 30, 'stalwart', { loadout: one, appliesToKing: isKingSet(one, 0) }),
    ).toBe(msg);
    // One item slot free: allowed.
    const room: Loadout = { ...full, items: ['headmaster_ring', 'multitaskers_schedule'] };
    expect(abilityBlock([], 4, 30, 'stalwart', { loadout: room, appliesToKing: true })).toBeNull();
    // Set capacity and level still come first; other abilities and callers without a target are
    // unaffected.
    expect(abilityBlock(['scout'], 1, 30, 'stalwart', { loadout: full, appliesToKing: true })).toBe(
      'Set is full (1)',
    );
    expect(abilityBlock([], 4, 15, 'stalwart', { loadout: full, appliesToKing: true })).toBe(
      'Needs level 16',
    );
    expect(abilityBlock([], 4, 30, 'scout', { loadout: full, appliesToKing: true })).toBeNull();
    expect(abilityBlock([], 4, 30, 'stalwart')).toBeNull();
  });
});
