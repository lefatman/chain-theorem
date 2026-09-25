/**
 * Triple Adept's Gloves scenario tests (R-LOAD-002, spec 7.2): capacity 3 for 2 item slots, min
 * level 5, capacity items never stack (exclusive group 'capacity').
 *
 * Expected behaviour comes from spec 5.3, 5.4 (ordering), 7.1-7.4 and DD-13, not from the engine's
 * current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

const ID = 'triple_adepts_gloves';
const OTHER_CAPACITY = ['dual_adepts_glove', 'journeymans_medallion', 'headmaster_ring'];

function loadout(items: string[], sets: string[][], elements: Loadout['elements'] = ['tide']) {
  return { elements, items, sets } satisfies Loadout;
}

// White knight c3 takes the black pawn d5; a second black pawn e6 is diagonally adjacent to d5.
const CAPTOR_FEN = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';

describe("triple adept's gloves (R-LOAD-002)", () => {
  it("R-LOAD-002 DD-13 Triple Adept's Gloves give capacity 3 for 2 slots at min level 5 in the capacity group", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(2);
    expect(def?.minLevel).toBe(5);
    expect(def?.capacity).toBe(3);
    expect(def?.exclusiveGroup).toBe('capacity');
  });

  it('R-LOAD-002 R-LOAD-004 R-LOAD-001 at level 5 the Gloves fill both slots and allow a three-ability set', () => {
    const v = engine.validateLoadout(loadout([ID], [['scout', 'pierce', 'hit_and_run']]), {
      level: 5,
    });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.capacity).toBe(3);
    expect(v.consumedSlots).toBe(2);
    expect(v.unlockedSlots).toBe(2);
  });

  it('R-LOAD-002 R-LOAD-004 below level 5 the Gloves are rejected (rule 2 level requirement)', () => {
    const v = engine.validateLoadout(loadout([ID], [['scout', 'hit_and_run']]), { level: 4 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-LOAD-004 a four-ability set exceeds the Gloves capacity of 3 (rule 4)', () => {
    const v = engine.validateLoadout(
      loadout([ID], [['scout', 'pierce', 'hit_and_run', 'last_word']]),
      { level: 5 },
    );
    expect(v.ok).toBe(false);
    expect(v.capacity).toBe(3);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-001 R-LOAD-004 the Gloves plus a 1-slot utility need 3 slots: rejected at level 5, accepted at level 10', () => {
    const l = loadout([ID, 'scouts_lens'], [['scout', 'pierce', 'hit_and_run']]);
    const at5 = engine.validateLoadout(l, { level: 5 });
    expect(at5.ok).toBe(false);
    expect(at5.consumedSlots).toBe(3);
    expect(at5.errors).toContainEqual(expect.objectContaining({ rule: 1, code: 'slots_exceeded' }));
    const at10 = engine.validateLoadout(l, { level: 10 });
    expect(at10.errors).toEqual([]);
  });

  it('R-LOAD-002 R-LOAD-004 capacity items never stack: the Gloves with any other capacity item break the exclusive group (rule 3)', () => {
    for (const other of OTHER_CAPACITY) {
      const v = engine.validateLoadout(loadout([ID, other], [['scout']]), { level: 30 });
      expect(v.ok, other).toBe(false);
      expect(v.errors, other).toContainEqual(
        expect.objectContaining({ rule: 3, code: 'exclusive_group' }),
      );
    }
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-003 R-ABIL-004 with capacity 3 all three abilities trigger in loadout order', () => {
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: ['pierce', 'scout', 'hit_and_run'] },
      black: {},
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawn = idAt(r.initial, 'd5');
    const triggered = eventsOf(r.events, 'AbilityTriggered');
    expect(triggered.map((e) => [e.piece, e.ability, e.category])).toEqual([
      [knight, 'pierce', 'CAPTURING'],
      [knight, 'scout', 'CAPTURING'],
      [knight, 'hit_and_run', 'CAPTURES'],
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    // Capturing abilities resolve before the victim is removed; Captures abilities after.
    const idx = (pred: (e: (typeof r.events)[number]) => boolean) => r.events.findIndex(pred);
    const captured = idx((e) => e.k === 'Captured' && e.victim === pawn);
    expect(idx((e) => e.k === 'AbilityTriggered' && e.ability === 'scout')).toBeLessThan(captured);
    expect(idx((e) => e.k === 'AbilityTriggered' && e.ability === 'hit_and_run')).toBeGreaterThan(
      captured,
    );
    // Scout revealed the (empty) black pawn set; Hit and Run returned the knight to c3.
    expect(r.state.reveals.black.complete).toContain('pawn');
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'e6')?.side).toBe('black');
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-004 reordering the set reorders same-phase triggers (Scout before Pierce)', () => {
    const r = scenario({
      fen: CAPTOR_FEN,
      white: { items: [ID], abilities: ['scout', 'pierce', 'hit_and_run'] },
      black: {},
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'scout',
      'pierce',
      'hit_and_run',
    ]);
  });
});
