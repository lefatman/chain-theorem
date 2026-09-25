/**
 * Loadout model and validation (M2 step 2.3): R-LOAD-001 item slots by level, R-LOAD-002 item and
 * ability level requirements (DD-05), R-LOAD-003 ability sets and the four builds of spec 7.3,
 * R-LOAD-004 validation rules 1-7, DD-13 loadout-shaping item data and DD-23 (neutral is test-only).
 *
 * Expected values come from spec 5.7, 6.4, 7.1-7.4 and the DD rows, not from the engine's output.
 */
import { describe, expect, it } from 'vitest';
import {
  type ElementId,
  type Loadout,
  type LoadoutValidation,
  type PieceType,
  PIECE_TYPES,
  createEngine,
  parseSquare,
} from '@chain-theorem/rules';
import type { AbilityDef, ItemDef } from '@chain-theorem/rules/sdk';
import { CAPS, abilityById, engine, itemById, makeEngine, registry } from '../index.ts';
import { eventsOf, pieceAt, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

interface LoadoutSpec {
  elements?: ElementId[];
  items?: string[];
  sets?: string[][];
  itemParams?: Loadout['itemParams'];
}

function lo(p: LoadoutSpec = {}): Loadout {
  const out: Loadout = {
    elements: p.elements ?? ['ember'],
    items: p.items ?? [],
    sets: p.sets ?? [[]],
  };
  if (p.itemParams) out.itemParams = p.itemParams;
  return out;
}

/** Rule and code of every error, for exact comparisons. */
const errs = (v: LoadoutValidation) => v.errors.map((e) => ({ rule: e.rule, code: e.code }));

/** Six per-type sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king. */
function perType(p: Partial<Record<PieceType, string[]>>): string[][] {
  return PIECE_TYPES.map((t) => p[t] ?? []);
}

const selections = (l: Loadout) => l.sets.reduce((n, s) => n + s.length, 0);

// ---- spec tables ----------------------------------------------------------------------------------

/** Spec 7.1 (R-LOAD-001, COMMITTED). */
const SLOT_TABLE = [
  { from: 1, to: 4, slots: 1 },
  { from: 5, to: 9, slots: 2 },
  { from: 10, to: 14, slots: 3 },
  { from: 15, to: 19, slots: 4 },
  { from: 20, to: 24, slots: 5 },
  { from: 25, to: 30, slots: 6 },
];
const slotsAt = (level: number) =>
  must(
    SLOT_TABLE.find((r) => level >= r.from && level <= r.to),
    `slot row for level ${level}`,
  ).slots;

/** Spec 7.2 (R-LOAD-002) with DD-01 (Dual Adept's Glove costs 1 slot) and DD-05 (listed levels). */
const ITEMS_7_2: { id: string; slotCost: number; minLevel: number; capacity?: number }[] = [
  { id: 'dual_adepts_glove', slotCost: 1, minLevel: 1, capacity: 2 },
  { id: 'triple_adepts_gloves', slotCost: 2, minLevel: 5, capacity: 3 },
  { id: 'journeymans_medallion', slotCost: 3, minLevel: 12, capacity: 4 },
  { id: 'headmaster_ring', slotCost: 4, minLevel: 20, capacity: 5 },
  { id: 'multitaskers_schedule', slotCost: 1, minLevel: 10 },
  { id: 'blended_family', slotCost: 1, minLevel: 15 },
  { id: 'wardens_stopwatch', slotCost: 1, minLevel: 18 },
  { id: 'masquerade_mask', slotCost: 1, minLevel: 14 },
  { id: 'resonance_crystal', slotCost: 1, minLevel: 6 },
  { id: 'attunement_charm', slotCost: 1, minLevel: 4 },
  { id: 'scouts_lens', slotCost: 1, minLevel: 3 },
];

/**
 * M7 7.3 items (Storm, Stone and Frost rollout, 6.5): utility items, so 1 slot each (7.2); their
 * levels are PLAYTEST values like the others (DD-05).
 */
const ITEMS_M7: { id: string; slotCost: number; minLevel: number; capacity?: number }[] = [
  { id: 'mooring_chain', slotCost: 1, minLevel: 8 },
  { id: 'mainspring', slotCost: 1, minLevel: 11 },
];
const ALL_ITEMS = [...ITEMS_7_2, ...ITEMS_M7];

/** Spec 5.7 starter catalogue: level requirements (DD-05); every starter ability costs 1 slot. */
const ABILITIES_5_7: { id: string; minLevel: number }[] = [
  { id: 'scout', minLevel: 1 },
  { id: 'hit_and_run', minLevel: 1 },
  { id: 'last_word', minLevel: 1 },
  { id: 'poisoned_meat', minLevel: 2 },
  { id: 'pierce', minLevel: 3 },
  { id: 'backdraft', minLevel: 4 },
  { id: 'antidote', minLevel: 5 },
  { id: 'cleave', minLevel: 6 },
  { id: 'momentum', minLevel: 8 },
  { id: 'reinforce', minLevel: 10 },
  { id: 'riposte', minLevel: 12 },
  { id: 'rebirth', minLevel: 14 },
  { id: 'stalwart', minLevel: 16 },
  { id: 'veil', minLevel: 18 },
];

/**
 * M7 7.3 affinity abilities, four per new element (6.5), spread over levels 1-20 (PLAYTEST, DD-05);
 * each costs 1 ability slot like the starter set.
 */
const ABILITIES_M7: { id: string; minLevel: number; affinity: ElementId }[] = [
  { id: 'squall', minLevel: 1, affinity: 'storm' },
  { id: 'afterimage', minLevel: 5, affinity: 'storm' },
  { id: 'pawn_storm', minLevel: 7, affinity: 'storm' },
  { id: 'slipstream', minLevel: 12, affinity: 'storm' },
  { id: 'buttress', minLevel: 2, affinity: 'stone' },
  { id: 'stonewall', minLevel: 6, affinity: 'stone' },
  { id: 'phalanx', minLevel: 10, affinity: 'stone' },
  { id: 'rebuild', minLevel: 17, affinity: 'stone' },
  { id: 'frost_heave', minLevel: 3, affinity: 'frost' },
  { id: 'snowdrift', minLevel: 9, affinity: 'frost' },
  { id: 'snowbound', minLevel: 14, affinity: 'frost' },
  { id: 'permafrost', minLevel: 20, affinity: 'frost' },
];
const ALL_ABILITIES = [...ABILITIES_5_7, ...ABILITIES_M7];

/** A loadout holding only `id`, with what the item needs to be valid (6.4, DD-29). */
function itemLoadout(id: string): Loadout {
  const spec: LoadoutSpec = {
    elements: id === 'blended_family' ? ['ember', 'tide'] : ['ember'],
    items: [id],
  };
  if (id === 'attunement_charm' || id === 'masquerade_mask')
    spec.itemParams = { [id]: { element: 'tide' } };
  return lo(spec);
}

function testItem(id: string, extra: Partial<ItemDef>): ItemDef {
  return {
    id,
    name: id,
    version: 1,
    slotCost: 1,
    minLevel: 1,
    hooks: {},
    text: { short: id, rules: id },
    status: 'PLAYTEST',
    ...extra,
  };
}

// ---- R-LOAD-001 -----------------------------------------------------------------------------------

describe('R-LOAD-001 item slots by level', () => {
  it('R-LOAD-001 item slots follow the spec 7.1 table and formula for every level 1..30', () => {
    expect(CAPS.LEVEL_CAP).toBe(30);
    expect(CAPS.MAX_ITEM_SLOTS).toBe(6);
    for (let level = 1; level <= 30; level++) {
      const expected = slotsAt(level);
      expect(Math.min(6, 1 + Math.floor(level / 5)), `formula at level ${level}`).toBe(expected);
      expect(CAPS.itemSlots(level), `CAPS.itemSlots(${level})`).toBe(expected);
      expect(engine.validateLoadout(lo(), { level }).unlockedSlots, `validator at ${level}`).toBe(
        expected,
      );
    }
  });

  it('R-LOAD-001 levels 25-30 add no slots beyond 6', () => {
    for (let level = 25; level <= 30; level++) expect(CAPS.itemSlots(level)).toBe(6);
    expect(CAPS.itemSlots(24)).toBe(5);
  });

  it.each([
    {
      below: 4,
      at: 5,
      items: ['scouts_lens', 'attunement_charm'],
      itemParams: { attunement_charm: { element: 'tide' as const } },
    },
    { below: 9, at: 10, items: ['triple_adepts_gloves', 'resonance_crystal'] },
    { below: 14, at: 15, items: ['journeymans_medallion', 'multitaskers_schedule'] },
    {
      below: 19,
      at: 20,
      items: ['journeymans_medallion', 'multitaskers_schedule', 'resonance_crystal'],
    },
    {
      below: 24,
      at: 25,
      items: ['headmaster_ring', 'multitaskers_schedule', 'blended_family'],
      elements: ['tide', 'ember'] as ElementId[],
    },
  ])(
    'R-LOAD-001 R-LOAD-004 rule 1 at the level $at threshold: items using its slots pass at $at and fail at $below',
    ({ below, at, items, itemParams, elements }) => {
      const spec: LoadoutSpec = { items };
      if (itemParams) spec.itemParams = itemParams;
      if (elements) spec.elements = elements;
      const loadout = lo(spec);
      const cost = items.reduce((n, id) => n + must(itemById.get(id), id).slotCost, 0);
      expect(cost).toBe(slotsAt(at));
      const ok = engine.validateLoadout(loadout, { level: at });
      expect(ok.errors).toEqual([]);
      expect(ok.ok).toBe(true);
      expect(ok.consumedSlots).toBe(cost);
      expect(ok.unlockedSlots).toBe(slotsAt(at));
      const fail = engine.validateLoadout(loadout, { level: below });
      expect(fail.ok).toBe(false);
      expect(errs(fail)).toEqual([{ rule: 1, code: 'slots_exceeded' }]);
      expect(fail.consumedSlots).toBe(cost);
      expect(fail.unlockedSlots).toBe(slotsAt(below));
    },
  );
});

// ---- R-LOAD-002 -----------------------------------------------------------------------------------

describe('R-LOAD-002 item catalogue and level requirements (DD-05)', () => {
  it('R-LOAD-002 DD-01 DD-05 the catalogue holds the 11 items of spec 7.2 and the 2 M7 items with their slot costs, capacities and levels', () => {
    expect(registry.items.map((i) => i.id).sort()).toEqual(ALL_ITEMS.map((i) => i.id).sort());
    for (const row of ALL_ITEMS) {
      const def = must(itemById.get(row.id), row.id);
      expect(
        { slotCost: def.slotCost, minLevel: def.minLevel, capacity: def.capacity },
        row.id,
      ).toEqual({ slotCost: row.slotCost, minLevel: row.minLevel, capacity: row.capacity });
      // Capacity N costs N - 1 slots; every other item costs 1 slot (7.2).
      if (row.capacity !== undefined) expect(def.slotCost, row.id).toBe(row.capacity - 1);
      else expect(def.slotCost, row.id).toBe(1);
    }
  });

  it.each(ALL_ITEMS)(
    'R-LOAD-002 R-LOAD-004 DD-05 $id validates at level $minLevel and is rejected one level below (rule 2)',
    ({ id, minLevel }) => {
      const at = engine.validateLoadout(itemLoadout(id), { level: minLevel });
      expect(at.errors).toEqual([]);
      expect(at.ok).toBe(true);
      if (minLevel <= 1) return;
      const below = engine.validateLoadout(itemLoadout(id), { level: minLevel - 1 });
      expect(below.ok).toBe(false);
      expect(below.errors.filter((e) => e.rule === 2)).toEqual([
        expect.objectContaining({ rule: 2, code: 'item_level', ref: id }),
      ]);
      // Anything else can only be the slot budget of the lower level (Triple Adept's Gloves at 4).
      expect(below.errors.every((e) => e.rule === 1 || e.rule === 2)).toBe(true);
    },
  );

  it('R-LOAD-002 R-ABIL-005 the 14 starter abilities have the spec 5.7 level requirements and cost 1 ability slot', () => {
    expect(registry.abilities.map((a) => a.id).sort()).toEqual(
      ALL_ABILITIES.map((a) => a.id).sort(),
    );
    for (const row of ALL_ABILITIES) {
      const def = must(abilityById.get(row.id), row.id);
      expect(def.minLevel, row.id).toBe(row.minLevel);
      expect(def.slotCost, row.id).toBe(1);
    }
  });

  it('R-LOAD-002 R-ABIL-005 R-ELEM-001 6.5: Storm, Stone and Frost each have at least four affinity abilities (with attuned versions) spread over levels 1-20', () => {
    for (const el of ['storm', 'stone', 'frost'] as const) {
      const own = registry.abilities.filter((a) => a.affinity === el && !a.retired);
      expect(own.map((a) => a.id).sort(), el).toEqual(
        ABILITIES_M7.filter((a) => a.affinity === el)
          .map((a) => a.id)
          .sort(),
      );
      expect(own.length, el).toBeGreaterThanOrEqual(4);
      for (const a of own) expect(a.attuned, a.id).toBeDefined();
    }
    const levels = ABILITIES_M7.map((a) => a.minLevel);
    expect(Math.min(...levels)).toBe(1);
    expect(Math.max(...levels)).toBe(20);
    const categories = new Set(ABILITIES_M7.map((a) => must(abilityById.get(a.id), a.id).category));
    expect([...categories].sort()).toEqual(['CAPTURED', 'CAPTURES', 'CAPTURING']);
  });

  it.each(ALL_ABILITIES)(
    'R-LOAD-002 R-LOAD-004 DD-05 ability $id validates at level $minLevel and is rejected one level below (rule 2)',
    ({ id, minLevel }) => {
      const loadout = lo({ sets: [[id]] });
      const at = engine.validateLoadout(loadout, { level: minLevel });
      expect(at.errors).toEqual([]);
      if (minLevel <= 1) return;
      const below = engine.validateLoadout(loadout, { level: minLevel - 1 });
      expect(below.ok).toBe(false);
      expect(below.errors).toEqual([
        expect.objectContaining({ rule: 2, code: 'ability_level', ref: id }),
      ]);
    },
  );

  it('R-LOAD-002 R-LOAD-004 DD-05 level requirements are read from module data, so tuning them needs no engine change', () => {
    const tuned = createEngine(
      {
        ...registry,
        abilities: registry.abilities.map((a) => (a.id === 'scout' ? { ...a, minLevel: 7 } : a)),
        items: registry.items.map((i) =>
          i.id === 'resonance_crystal' ? { ...i, minLevel: 9 } : i,
        ),
      },
      CAPS,
    );
    const scout = lo({ sets: [['scout']] });
    expect(errs(tuned.validateLoadout(scout, { level: 6 }))).toEqual([
      { rule: 2, code: 'ability_level' },
    ]);
    expect(tuned.validateLoadout(scout, { level: 7 }).errors).toEqual([]);
    const crystal = lo({ items: ['resonance_crystal'] });
    expect(errs(tuned.validateLoadout(crystal, { level: 8 }))).toEqual([
      { rule: 2, code: 'item_level' },
    ]);
    expect(tuned.validateLoadout(crystal, { level: 9 }).errors).toEqual([]);
  });
});

// ---- R-LOAD-003 -----------------------------------------------------------------------------------

const MAX_SETS = perType({
  pawn: ['poisoned_meat', 'backdraft', 'last_word', 'rebirth', 'antidote'],
  knight: ['hit_and_run', 'scout', 'pierce', 'momentum', 'cleave'],
  bishop: ['riposte', 'reinforce', 'poisoned_meat', 'scout', 'veil'],
  rook: ['cleave', 'momentum', 'hit_and_run', 'pierce', 'antidote'],
  queen: ['scout', 'pierce', 'riposte', 'reinforce', 'last_word'],
  king: ['stalwart', 'antidote', 'veil', 'scout', 'last_word'],
});

const BUILDS = [
  {
    name: 'Maximum',
    loadout: lo({
      elements: ['tide', 'ember'],
      items: ['headmaster_ring', 'multitaskers_schedule', 'blended_family'],
      sets: MAX_SETS,
    }),
    slots: 6,
    capacity: 5,
    selections: 30,
    elements: 2,
    perType: true,
  },
  {
    name: 'Flexible',
    loadout: lo({
      elements: ['grove', 'ember'],
      items: [
        'journeymans_medallion',
        'multitaskers_schedule',
        'blended_family',
        'wardens_stopwatch',
      ],
      sets: MAX_SETS.map((s) => s.slice(0, 4)),
    }),
    slots: 6,
    capacity: 4,
    selections: 24,
    elements: 2,
    perType: true,
  },
  {
    name: 'Focused',
    loadout: lo({
      elements: ['tide'],
      items: ['headmaster_ring', 'wardens_stopwatch', 'resonance_crystal'],
      sets: [['scout', 'pierce', 'hit_and_run', 'last_word', 'poisoned_meat']],
    }),
    slots: 6,
    capacity: 5,
    selections: 5,
    elements: 1,
    perType: false,
  },
  {
    name: 'Starter',
    loadout: lo({
      elements: ['grove'],
      items: ['dual_adepts_glove'],
      sets: [['poisoned_meat', 'last_word']],
    }),
    slots: 1,
    capacity: 2,
    selections: 2,
    elements: 1,
    perType: false,
  },
];

describe('R-LOAD-003 ability sets and builds', () => {
  it.each(BUILDS)(
    'R-LOAD-003 R-LOAD-004 the $name build of spec 7.3 validates at level 25 with $slots slots and $selections selections',
    (b) => {
      const v = engine.validateLoadout(b.loadout, { level: 25 });
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.consumedSlots).toBe(b.slots);
      expect(v.unlockedSlots).toBe(6);
      expect(v.capacity).toBe(b.capacity);
      expect(selections(b.loadout)).toBe(b.selections);
      expect(b.loadout.sets).toHaveLength(b.perType ? 6 : 1);
      expect(new Set(b.loadout.elements).size).toBe(b.elements);

      // The battle snapshot carries the same shape: per-type sets, or one set applied to all six types.
      const { state } = engine.newBattle({
        format: 'full',
        white: { level: 25, loadout: b.loadout },
        black: { level: 1, loadout: lo({ elements: ['tide'] }) },
      });
      const army = state.armies.white;
      expect(army.consumedSlots).toBe(b.slots);
      PIECE_TYPES.forEach((t, i) => {
        expect(army.sets[t], t).toEqual(b.perType ? b.loadout.sets[i] : b.loadout.sets[0]);
      });
      if (b.perType)
        expect(PIECE_TYPES.reduce((n, t) => n + army.sets[t].length, 0)).toBe(b.selections);
    },
  );

  it('R-LOAD-003 R-LOAD-001 DD-05 the Maximum build arrives at level 25: at level 24 it exceeds the slot budget', () => {
    const max = must(BUILDS[0], 'Maximum').loadout;
    expect(errs(engine.validateLoadout(max, { level: 24 }))).toEqual([
      { rule: 1, code: 'slots_exceeded' },
    ]);
  });

  it('R-LOAD-003 R-LOAD-004 the 6-slot builds are full: one more utility item or one more ability breaks them', () => {
    for (const b of BUILDS.filter((x) => x.slots === 6)) {
      const extraItem = { ...b.loadout, items: [...b.loadout.items, 'scouts_lens'] };
      expect(errs(engine.validateLoadout(extraItem, { level: 30 })), b.name).toEqual([
        { rule: 1, code: 'slots_exceeded' },
      ]);
      const spare = must(
        ABILITIES_5_7.map((a) => a.id).find((id) => !(b.loadout.sets[0] ?? []).includes(id)),
        'spare ability',
      );
      const sets = b.loadout.sets.map((s, i) => (i === 0 ? [...s, spare] : s));
      expect(errs(engine.validateLoadout({ ...b.loadout, sets }, { level: 30 })), b.name).toEqual([
        { rule: 4, code: 'capacity_exceeded' },
      ]);
    }
  });

  it('R-LOAD-003 without the Schedule one set applies to all six piece types; with it the six sets map pawn..king', () => {
    const one = setup({ white: { items: ['dual_adepts_glove'], abilities: ['scout', 'pierce'] } });
    for (const t of PIECE_TYPES)
      expect(one.state.armies.white.sets[t], t).toEqual(['scout', 'pierce']);
    const sets = perType({
      pawn: ['poisoned_meat'],
      knight: ['hit_and_run'],
      bishop: ['scout'],
      rook: ['cleave'],
      queen: ['pierce'],
      king: ['stalwart'],
    });
    const six = setup({ white: { items: ['multitaskers_schedule'], sets } });
    PIECE_TYPES.forEach((t, i) => expect(six.state.armies.white.sets[t], t).toEqual(sets[i]));
  });

  it('R-LOAD-003 R-LOAD-004 an ineligible ability (Stalwart in a pawn set) still uses a slot', () => {
    const withScout = lo({
      items: ['multitaskers_schedule'],
      sets: perType({ pawn: ['stalwart', 'scout'] }),
    });
    expect(errs(engine.validateLoadout(withScout, { level: 30 }))).toEqual([
      { rule: 4, code: 'capacity_exceeded' },
    ]);
    const alone = lo({ items: ['multitaskers_schedule'], sets: perType({ pawn: ['stalwart'] }) });
    expect(engine.validateLoadout(alone, { level: 16 }).errors).toEqual([]);
    const glove = lo({
      items: ['multitaskers_schedule', 'dual_adepts_glove'],
      sets: perType({ pawn: ['stalwart', 'scout'] }),
    });
    const v = engine.validateLoadout(glove, { level: 30 });
    expect(v.errors).toEqual([]);
    expect(v.capacity).toBe(2);
    // 4.3: an army-wide Stalwart is legal.
    expect(engine.validateLoadout(lo({ sets: [['stalwart']] }), { level: 16 }).errors).toEqual([]);
  });

  it('R-LOAD-003 R-RULES-003 Stalwart in a pawn set does nothing in battle: the king stays ordinary', () => {
    const fen = '3rk3/8/8/8/8/8/P7/4K3 w - - 0 1';
    const moves = (king: string[], pawn: string[]) => {
      const s = setup({
        fen,
        white: { items: ['multitaskers_schedule'], sets: perType({ pawn, king }) },
      });
      return s.engine.legalMoves(s.state, 'white').map((m) => `${m.from}-${m.to}`);
    };
    const intoCheck = `${sq('e1')}-${sq('d1')}`;
    const pawnOnly = moves([], ['stalwart']);
    expect(pawnOnly).not.toContain(intoCheck);
    expect(pawnOnly).not.toContain(`${sq('e1')}-${sq('d2')}`);
    // The pawn itself moves as a pawn.
    expect(pawnOnly).toEqual(
      expect.arrayContaining([`${sq('a2')}-${sq('a3')}`, `${sq('a2')}-${sq('a4')}`]),
    );
    // Control: on the king, the same card lets it step into the rook's file (4.3).
    expect(moves(['stalwart'], [])).toContain(intoCheck);
  });

  it('R-LOAD-003 an ineligible ability does nothing there: Hit and Run (non-king) on the king never triggers', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2NpK3/8/8 w - - 0 1',
      white: {
        items: ['multitaskers_schedule'],
        sets: perType({ knight: ['hit_and_run'], king: ['hit_and_run'] }),
      },
      moves: ['e3d3', 'e8e7', 'c3d5'],
    });
    const kingStep = must(r.steps[0], 'king capture');
    expect(eventsOf(kingStep.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(kingStep.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'd3')).toMatchObject({ side: 'white', type: 'king' });
    expect(pieceAt(r.state, 'e3')).toBeUndefined();
    // Control: on the knight the same card returns it to its origin square.
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.pieceType, e.ability])).toEqual([
      ['knight', 'hit_and_run'],
    ]);
    expect(pieceAt(r.state, 'c3')).toMatchObject({ side: 'white', type: 'knight' });
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-LOAD-003 R-ABIL-004 the order within a set is the resolution order', () => {
    const run = (set: string[]) =>
      eventsOf(
        scenario({
          fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
          black: { items: ['dual_adepts_glove'], abilities: set },
          moves: ['c3d5'],
        }).events,
        'AbilityTriggered',
      ).map((e) => e.ability);
    expect(run(['last_word', 'poisoned_meat'])).toEqual(['last_word', 'poisoned_meat']);
    expect(run(['poisoned_meat', 'last_word'])).toEqual(['poisoned_meat', 'last_word']);
  });
});

// ---- R-LOAD-004 -----------------------------------------------------------------------------------

describe('R-LOAD-004 loadout validation rules 1-7', () => {
  it('R-LOAD-004 rule 1: total item slot cost may equal but not exceed the unlocked slots', () => {
    const pass = engine.validateLoadout(
      lo({ items: ['triple_adepts_gloves', 'resonance_crystal'] }),
      { level: 10 },
    );
    expect(pass.errors).toEqual([]);
    expect(pass.consumedSlots).toBe(3);
    expect(pass.unlockedSlots).toBe(3);
    const fail = engine.validateLoadout(
      lo({ items: ['triple_adepts_gloves', 'resonance_crystal', 'scouts_lens'] }),
      { level: 10 },
    );
    expect(errs(fail)).toEqual([{ rule: 1, code: 'slots_exceeded' }]);
    expect(fail.consumedSlots).toBe(4);
  });

  it('R-LOAD-004 rule 2: item and ability level requirements must not exceed the player level', () => {
    expect(engine.validateLoadout(lo({ items: ['resonance_crystal'] }), { level: 6 }).ok).toBe(
      true,
    );
    const item = engine.validateLoadout(lo({ items: ['resonance_crystal'] }), { level: 5 });
    expect(item.errors).toEqual([
      expect.objectContaining({ rule: 2, code: 'item_level', ref: 'resonance_crystal' }),
    ]);
    expect(engine.validateLoadout(lo({ sets: [['cleave']] }), { level: 6 }).ok).toBe(true);
    const ability = engine.validateLoadout(lo({ sets: [['cleave']] }), { level: 5 });
    expect(ability.errors).toEqual([
      expect.objectContaining({ rule: 2, code: 'ability_level', ref: 'cleave' }),
    ]);
    // Abilities in per-type sets are checked too.
    const perTypeSets = lo({
      items: ['multitaskers_schedule'],
      sets: perType({ queen: ['riposte'] }),
    });
    expect(errs(engine.validateLoadout(perTypeSets, { level: 11 }))).toEqual([
      { rule: 2, code: 'ability_level' },
    ]);
    expect(engine.validateLoadout(perTypeSets, { level: 12 }).ok).toBe(true);
  });

  it('R-LOAD-004 rule 3: at most one item per exclusive group (one capacity item), and no item twice', () => {
    expect(
      engine.validateLoadout(lo({ items: ['headmaster_ring', 'scouts_lens'] }), { level: 30 })
        .errors,
    ).toEqual([]);
    expect(
      errs(
        engine.validateLoadout(lo({ items: ['headmaster_ring', 'dual_adepts_glove'] }), {
          level: 30,
        }),
      ),
    ).toEqual([{ rule: 3, code: 'exclusive_group' }]);
    expect(
      errs(
        engine.validateLoadout(lo({ items: ['triple_adepts_gloves', 'journeymans_medallion'] }), {
          level: 30,
        }),
      ),
    ).toEqual([{ rule: 3, code: 'exclusive_group' }]);
    expect(
      errs(engine.validateLoadout(lo({ items: ['scouts_lens', 'scouts_lens'] }), { level: 30 })),
    ).toEqual([{ rule: 3, code: 'duplicate_item' }]);
    const twoGloves = engine.validateLoadout(
      lo({ items: ['dual_adepts_glove', 'dual_adepts_glove'] }),
      { level: 30 },
    );
    expect(twoGloves.ok).toBe(false);
    expect(twoGloves.errors.length).toBeGreaterThan(0);
    expect(twoGloves.errors.every((e) => e.rule === 3)).toBe(true);
  });

  it('R-LOAD-004 rule 4: every set stays within capacity and has no duplicates', () => {
    expect(
      errs(engine.validateLoadout(lo({ sets: [['scout', 'pierce']] }), { level: 30 })),
    ).toEqual([{ rule: 4, code: 'capacity_exceeded' }]);
    const glove = engine.validateLoadout(
      lo({ items: ['dual_adepts_glove'], sets: [['scout', 'pierce']] }),
      { level: 30 },
    );
    expect(glove.errors).toEqual([]);
    expect(glove.capacity).toBe(2);
    expect(
      errs(
        engine.validateLoadout(lo({ items: ['dual_adepts_glove'], sets: [['scout', 'scout']] }), {
          level: 30,
        }),
      ),
    ).toEqual([{ rule: 4, code: 'duplicate_ability' }]);
    // Per-type sets are each checked on their own; one ability may sit in several sets (7.3).
    expect(
      errs(
        engine.validateLoadout(
          lo({ items: ['multitaskers_schedule'], sets: perType({ rook: ['scout', 'pierce'] }) }),
          { level: 30 },
        ),
      ),
    ).toEqual([{ rule: 4, code: 'capacity_exceeded' }]);
    expect(
      engine.validateLoadout(
        lo({ items: ['multitaskers_schedule'], sets: PIECE_TYPES.map(() => ['scout']) }),
        { level: 30 },
      ).errors,
    ).toEqual([]);
  });

  it('R-LOAD-004 rule 4: capacity counts ability slot cost, not the number of abilities', () => {
    const heavy: AbilityDef = {
      ...must(abilityById.get('scout'), 'scout'),
      id: 'test_heavy',
      name: 'Test Heavy',
      slotCost: 2,
    };
    const eng = createEngine({ ...registry, abilities: [...registry.abilities, heavy] }, CAPS);
    const v = (items: string[], set: string[]) =>
      eng.validateLoadout(lo({ items, sets: [set] }), { level: 30 });
    expect(errs(v([], ['test_heavy']))).toEqual([{ rule: 4, code: 'capacity_exceeded' }]);
    expect(v(['dual_adepts_glove'], ['test_heavy']).errors).toEqual([]);
    expect(errs(v(['dual_adepts_glove'], ['test_heavy', 'scout']))).toEqual([
      { rule: 4, code: 'capacity_exceeded' },
    ]);
    expect(v(['triple_adepts_gloves'], ['test_heavy', 'scout']).errors).toEqual([]);
  });

  it("R-LOAD-004 rule 5: the set count is 1, or 6 with Multitasker's Schedule", () => {
    const v = (items: string[], sets: string[][]) =>
      engine.validateLoadout(lo({ items, sets }), { level: 30 });
    expect(v([], [['scout']]).errors).toEqual([]);
    expect(v(['multitaskers_schedule'], [['scout']]).errors).toEqual([]);
    expect(v(['multitaskers_schedule'], perType({ pawn: ['scout'] })).errors).toEqual([]);
    expect(errs(v([], perType({ pawn: ['scout'] })))).toEqual([{ rule: 5, code: 'set_count' }]);
    expect(errs(v(['multitaskers_schedule'], [['scout'], ['pierce']]))).toEqual([
      { rule: 5, code: 'set_count' },
    ]);
    expect(errs(v([], []))).toEqual([{ rule: 5, code: 'set_count' }]);
  });

  it('R-LOAD-004 R-ELEM-004 rule 6: Blended Family requires two different elements, and two elements require it', () => {
    const v = (elements: ElementId[], items: string[]) =>
      engine.validateLoadout(lo({ elements, items }), { level: 30 });
    expect(v(['ember', 'tide'], ['blended_family']).errors).toEqual([]);
    expect(v(['tide'], []).errors).toEqual([]);
    expect(errs(v(['ember', 'ember'], ['blended_family']))).toEqual([
      { rule: 6, code: 'elements_same' },
    ]);
    expect(errs(v(['ember'], ['blended_family']))).toEqual([{ rule: 6, code: 'elements_count' }]);
    expect(errs(v(['ember', 'tide'], []))).toEqual([{ rule: 6, code: 'elements_count' }]);
    expect(errs(v([], []))).toEqual([{ rule: 6, code: 'elements_count' }]);
  });

  it('R-LOAD-004 R-ELEM-001 DD-23 disabled elements are rejected: M7 enables all six elements (6.5); neutral is test-only', () => {
    const codes = (elements: ElementId[], items: string[] = []) =>
      engine.validateLoadout(lo({ elements, items }), { level: 30 }).errors.map((e) => e.code);
    const six: ElementId[] = ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'];
    expect([...CAPS.ENABLED_ELEMENTS]).toEqual(six);
    for (const el of six) expect(codes([el]), el).toEqual([]);
    expect(codes(['neutral'])).toEqual(['element_disabled']);
    expect(codes(['ember', 'frost'], ['blended_family'])).toEqual([]);
    expect(codes(['storm', 'neutral'], ['blended_family'])).toEqual(['element_disabled']);
    // The rollout (6.5) is config, not code: the MVP's three-element config still rejects the rest.
    const mvp = makeEngine({ ENABLED_ELEMENTS: ['ember', 'tide', 'grove'] });
    for (const el of ['storm', 'stone', 'frost'] as ElementId[])
      expect(
        mvp.validateLoadout(lo({ elements: [el] }), { level: 30 }).errors.map((e) => e.code),
        el,
      ).toEqual(['element_disabled']);
  });

  it('R-LOAD-004 rule 7: every equipped item and ability must be owned', () => {
    const loadout = lo({ items: ['scouts_lens'], sets: [['scout']] });
    expect(
      engine.validateLoadout(loadout, {
        level: 30,
        ownedItems: ['scouts_lens'],
        ownedAbilities: ['scout'],
      }).errors,
    ).toEqual([]);
    const noItem = engine.validateLoadout(loadout, {
      level: 30,
      ownedItems: [],
      ownedAbilities: ['scout'],
    });
    expect(noItem.errors).toEqual([
      expect.objectContaining({ rule: 7, code: 'not_owned', ref: 'scouts_lens' }),
    ]);
    const noAbility = engine.validateLoadout(loadout, {
      level: 30,
      ownedItems: ['scouts_lens'],
      ownedAbilities: ['pierce'],
    });
    expect(noAbility.errors).toEqual([
      expect.objectContaining({ rule: 7, code: 'not_owned', ref: 'scout' }),
    ]);
  });

  it('R-LOAD-004 rule 7: retired items and abilities cannot be equipped, and unknown ids are rejected', () => {
    const retiredEngine = createEngine(
      {
        ...registry,
        abilities: registry.abilities.map((a) => (a.id === 'scout' ? { ...a, retired: true } : a)),
        items: registry.items.map((i) => (i.id === 'scouts_lens' ? { ...i, retired: true } : i)),
      },
      CAPS,
    );
    const loadout = lo({ items: ['scouts_lens'], sets: [['scout']] });
    expect(engine.validateLoadout(loadout, { level: 30 }).errors).toEqual([]);
    const retired = retiredEngine.validateLoadout(loadout, { level: 30 });
    expect(retired.ok).toBe(false);
    expect(retired.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 7, code: 'retired', ref: 'scouts_lens' }),
        expect.objectContaining({ rule: 7, code: 'retired', ref: 'scout' }),
      ]),
    );
    expect(retired.errors.every((e) => e.rule === 7)).toBe(true);

    const unknownItem = engine.validateLoadout(lo({ items: ['no_such_item'] }), { level: 30 });
    expect(unknownItem.ok).toBe(false);
    expect(unknownItem.errors).toContainEqual(
      expect.objectContaining({ rule: 7, code: 'unknown_item', ref: 'no_such_item' }),
    );
    const unknownAbility = engine.validateLoadout(lo({ sets: [['no_such_ability']] }), {
      level: 30,
    });
    expect(unknownAbility.ok).toBe(false);
    expect(unknownAbility.errors).toContainEqual(
      expect.objectContaining({ rule: 7, code: 'unknown_ability', ref: 'no_such_ability' }),
    );
  });

  it('R-LOAD-004 DD-13 DD-29 items that need a choice need an enabled element parameter', () => {
    for (const id of ['attunement_charm', 'masquerade_mask']) {
      expect(engine.validateLoadout(itemLoadout(id), { level: 30 }).errors, id).toEqual([]);
      const none = engine.validateLoadout(lo({ items: [id] }), { level: 30 });
      expect(none.ok, id).toBe(false);
      expect(
        none.errors.map((e) => e.code),
        id,
      ).toEqual(['item_param']);
      // 'neutral' is never enabled (DD-23); Storm, Stone and Frost are since M7 (6.5).
      const neutral = engine.validateLoadout(
        lo({ items: [id], itemParams: { [id]: { element: 'neutral' } } }),
        { level: 30 },
      );
      expect(neutral.ok, id).toBe(false);
      expect(
        neutral.errors.map((e) => e.code),
        id,
      ).toEqual(['item_param']);
      for (const element of ['storm', 'stone', 'frost'] as const) {
        const ok = engine.validateLoadout(lo({ items: [id], itemParams: { [id]: { element } } }), {
          level: 30,
        });
        expect(ok.errors, `${id} ${element}`).toEqual([]);
      }
      const mvp = makeEngine({ ENABLED_ELEMENTS: ['ember', 'tide', 'grove'] });
      const storm = mvp.validateLoadout(
        lo({ items: [id], itemParams: { [id]: { element: 'storm' } } }),
        { level: 30 },
      );
      expect(
        storm.errors.map((e) => e.code),
        id,
      ).toEqual(['item_param']);
    }
  });

  it('R-LOAD-004 every limit comes from the caps config: slot formula and base capacity overrides change validation', () => {
    const three = lo({ items: ['triple_adepts_gloves', 'resonance_crystal'] });
    expect(errs(engine.validateLoadout(three, { level: 9 }))).toEqual([
      { rule: 1, code: 'slots_exceeded' },
    ]);
    const generous = makeEngine({ itemSlots: (level) => Math.min(6, 2 + Math.floor(level / 5)) });
    const v = generous.validateLoadout(three, { level: 9 });
    expect(v.errors).toEqual([]);
    expect(v.unlockedSlots).toBe(3);

    const pair = lo({ sets: [['scout', 'pierce']] });
    expect(errs(engine.validateLoadout(pair, { level: 30 }))).toEqual([
      { rule: 4, code: 'capacity_exceeded' },
    ]);
    const wide = makeEngine({ BASE_ABILITY_CAPACITY: 2 }).validateLoadout(pair, { level: 30 });
    expect(wide.errors).toEqual([]);
    expect(wide.capacity).toBe(2);
  });
});

// ---- DD-13 ----------------------------------------------------------------------------------------

describe('DD-13 loadout-shaping items declare data the validator reads', () => {
  it('DD-13 R-LOAD-002 capacity items, the Schedule, Blended Family and the element-choice items declare their flags', () => {
    for (const row of ITEMS_7_2.filter((r) => r.capacity !== undefined)) {
      const def = must(itemById.get(row.id), row.id);
      expect(def.capacity, row.id).toBe(row.capacity);
      expect(def.exclusiveGroup, row.id).toBe('capacity');
    }
    expect(itemById.get('multitaskers_schedule')?.grants?.perTypeSets).toBe(true);
    expect(itemById.get('blended_family')?.grants?.secondElement).toBe(true);
    expect(itemById.get('attunement_charm')?.param).toEqual({ element: 'required' });
    expect(itemById.get('masquerade_mask')?.param).toEqual({ element: 'required' });
    for (const id of ['scouts_lens', 'wardens_stopwatch', 'resonance_crystal']) {
      const def = must(itemById.get(id), id);
      expect(def.capacity, id).toBeUndefined();
      expect(def.grants, id).toBeUndefined();
      expect(def.param, id).toBeUndefined();
    }
  });

  it('DD-13 R-LOAD-004 a new item with the same flags is handled by the validator without engine changes', () => {
    const eng = createEngine(
      {
        ...registry,
        items: [
          ...registry.items,
          testItem('test_capacity', { slotCost: 2, capacity: 3, exclusiveGroup: 'capacity' }),
          testItem('test_per_type', { grants: { perTypeSets: true } }),
          testItem('test_second_element', { grants: { secondElement: true } }),
          testItem('test_param', { param: { element: 'required' } }),
        ],
      },
      CAPS,
    );
    const cap = eng.validateLoadout(
      lo({ items: ['test_capacity'], sets: [['scout', 'pierce', 'last_word']] }),
      { level: 30 },
    );
    expect(cap.errors).toEqual([]);
    expect(cap.capacity).toBe(3);
    expect(cap.consumedSlots).toBe(2);
    expect(
      errs(
        eng.validateLoadout(lo({ items: ['test_capacity', 'dual_adepts_glove'] }), { level: 30 }),
      ),
    ).toEqual([{ rule: 3, code: 'exclusive_group' }]);
    expect(
      eng.validateLoadout(lo({ items: ['test_per_type'], sets: perType({ pawn: ['scout'] }) }), {
        level: 30,
      }).errors,
    ).toEqual([]);
    expect(
      eng.validateLoadout(lo({ items: ['test_second_element'], elements: ['ember', 'tide'] }), {
        level: 30,
      }).errors,
    ).toEqual([]);
    expect(
      errs(
        eng.validateLoadout(lo({ items: ['test_second_element'], elements: ['ember', 'ember'] }), {
          level: 30,
        }),
      ),
    ).toEqual([{ rule: 6, code: 'elements_same' }]);
    expect(
      eng.validateLoadout(
        lo({ items: ['test_param'], itemParams: { test_param: { element: 'grove' } } }),
        { level: 30 },
      ).errors,
    ).toEqual([]);
    expect(
      eng.validateLoadout(lo({ items: ['test_param'] }), { level: 30 }).errors.map((e) => e.code),
    ).toEqual(['item_param']);
  });
});
