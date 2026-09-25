/** Loadout builder draft shaping (R-LOAD-003, R-LOAD-004, R-ELEM-004); legality stays with the engine. */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import {
  abilityBlock,
  equipItem,
  itemBlock,
  levelForSlots,
  moveInSet,
  setPerType,
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
