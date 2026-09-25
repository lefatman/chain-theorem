/**
 * Dual Adept's Glove scenario tests (R-LOAD-002, spec 7.2): capacity 2 for 1 item slot (DD-01),
 * min level 1, capacity items never stack (exclusive group 'capacity').
 *
 * Expected behaviour comes from spec 5.4 (ordering), 7.1-7.4, 8.1-8.3 and DD-01, DD-13, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const ID = 'dual_adepts_glove';
const OTHER_CAPACITY = ['triple_adepts_gloves', 'journeymans_medallion', 'headmaster_ring'];
const sq = parseSquare;

function loadout(items: string[], sets: string[][], elements: Loadout['elements'] = ['tide']) {
  return { elements, items, sets } satisfies Loadout;
}

function codes(v: { errors: { code: string }[] }): string[] {
  return v.errors.map((e) => e.code);
}

describe("dual adept's glove (R-LOAD-002)", () => {
  it("R-LOAD-002 DD-01 DD-13 Dual Adept's Glove is a capacity-2 item costing 1 slot at min level 1 in the capacity group", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(1);
    expect(def?.capacity).toBe(2);
    expect(def?.exclusiveGroup).toBe('capacity');
    expect(def?.grants).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-004 R-LOAD-001 at level 1 the Glove fills the single slot and allows a two-ability set', () => {
    const v = engine.validateLoadout(loadout([ID], [['scout', 'hit_and_run']]), { level: 1 });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.capacity).toBe(2);
    expect(v.consumedSlots).toBe(1);
    expect(v.unlockedSlots).toBe(1);
  });

  it('R-LOAD-002 R-LOAD-004 a three-ability set exceeds the Glove capacity of 2 (rule 4)', () => {
    const v = engine.validateLoadout(loadout([ID], [['scout', 'hit_and_run', 'last_word']]), {
      level: 1,
    });
    expect(v.ok).toBe(false);
    expect(v.capacity).toBe(2);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-004 without a capacity item capacity is 1, so the same two-ability set is rejected', () => {
    const v = engine.validateLoadout(loadout([], [['scout', 'hit_and_run']]), { level: 1 });
    expect(v.ok).toBe(false);
    expect(v.capacity).toBe(1);
    expect(v.consumedSlots).toBe(0);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
  });

  it('R-LOAD-002 R-LOAD-004 capacity items never stack: the Glove with any other capacity item breaks the exclusive group (rule 3)', () => {
    for (const other of OTHER_CAPACITY) {
      const v = engine.validateLoadout(loadout([ID, other], [['scout']]), { level: 30 });
      expect(v.ok, other).toBe(false);
      expect(v.errors, other).toContainEqual(
        expect.objectContaining({ rule: 3, code: 'exclusive_group' }),
      );
    }
  });

  it('R-LOAD-002 R-LOAD-004 stacking the Glove with Triple Gloves adds no capacity: a four-ability set is still over capacity', () => {
    const v = engine.validateLoadout(
      loadout([ID, 'triple_adepts_gloves'], [['scout', 'hit_and_run', 'last_word', 'pierce']]),
      { level: 30 },
    );
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain('exclusive_group');
    expect(codes(v)).toContain('capacity_exceeded');
  });

  it('R-LOAD-002 R-LOAD-004 the Glove cannot be equipped twice (rule 3)', () => {
    const v = engine.validateLoadout(loadout([ID, ID], [['scout', 'hit_and_run']]), {
      level: 30,
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(expect.objectContaining({ rule: 3, code: 'duplicate_item' }));
  });

  it('R-LOAD-002 R-LOAD-001 R-LOAD-004 the Glove plus a 1-slot utility needs 2 item slots: rejected at level 4, accepted at level 5', () => {
    const l = loadout([ID, 'scouts_lens'], [['scout', 'hit_and_run']]);
    const at4 = engine.validateLoadout(l, { level: 4 });
    expect(at4.ok).toBe(false);
    expect(at4.consumedSlots).toBe(2);
    expect(at4.unlockedSlots).toBe(1);
    expect(at4.errors).toContainEqual(expect.objectContaining({ rule: 1, code: 'slots_exceeded' }));
    const at5 = engine.validateLoadout(l, { level: 5 });
    expect(at5.errors).toEqual([]);
    expect(at5.ok).toBe(true);
  });

  // A white knight on c3 takes a black pawn on d5 whose army carries the Glove: both of the pawn's
  // When-captured abilities fire, in loadout order (5.4 "same piece: the owner's loadout order").
  const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

  it('R-LOAD-002 R-LOAD-003 R-ABIL-004 with capacity 2 both abilities of the set trigger, in loadout order (Poisoned Meat then Last Word)', () => {
    const r = scenario({
      fen: FEN,
      white: {},
      black: { items: [ID], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawn = idAt(r.initial, 'd5');
    const triggered = eventsOf(r.events, 'AbilityTriggered');
    expect(triggered.map((e) => [e.side, e.piece, e.ability])).toEqual([
      ['black', pawn, 'poisoned_meat'],
      ['black', pawn, 'last_word'],
    ]);
    // Poisoned Meat resolved first: the knight is effect-captured before Last Word triggers.
    const order = r.events.flatMap((e) =>
      e.k === 'AbilityTriggered'
        ? [e.ability]
        : e.k === 'Captured' && e.by === 'effect'
          ? [`captured#${e.victim}`]
          : [],
    );
    expect(order).toEqual(['poisoned_meat', `captured#${knight}`, 'last_word']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['poisoned_meat', 'last_word']);
  });

  it('R-LOAD-002 R-LOAD-003 R-ABIL-004 reversing the two-ability set reverses the resolution order (Last Word then Poisoned Meat)', () => {
    const r = scenario({
      fen: FEN,
      white: {},
      black: { items: [ID], abilities: ['last_word', 'poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const triggered = eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability);
    expect(triggered).toEqual(['last_word', 'poisoned_meat']);
    // Last Word revealed the (empty) knight set before Poisoned Meat removed the knight.
    const lastWordReveal = r.events.findIndex(
      (e) => e.k === 'Revealed' && e.side === 'white' && e.info.kind === 'set',
    );
    const knightRemoved = r.events.findIndex(
      (e) => e.k === 'Captured' && e.by === 'effect' && e.victim === knight,
    );
    expect(lastWordReveal).toBeGreaterThanOrEqual(0);
    expect(knightRemoved).toBeGreaterThan(lastWordReveal);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(r.state.board[sq('d5')]).toBe(-1);
  });

  it('R-LOAD-002 R-INFO-003 the Dossier proves the Glove from 1 consumed slot and two abilities seen on pawns (spec 8.3 example)', () => {
    const r = scenario({
      fen: FEN,
      white: {},
      black: { level: 30, items: [ID], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['c3d5'],
    });
    const pub = r.engine.project(r.state, 'white');
    expect(pub.armies.black.consumedSlots).toBe(1);
    expect(pub.armies.black.revealed.abilities.pawn).toEqual(['poisoned_meat', 'last_word']);
    const d = r.engine.deduce(pub);
    expect(d.side).toBe('black');
    expect(d.certainItems).toContain(ID);
    expect(d.schedule).toBe('no');
    expect(d.capacity).toEqual({ min: 2, max: 2 });
  });
});
