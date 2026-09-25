/**
 * Multitasker's Schedule scenario tests (R-LOAD-002, R-LOAD-003, spec 7.2-7.4): 1 slot, min level
 * 10, a separate ability set for each of the six piece types (DD-13: grants.perTypeSets).
 *
 * Expected behaviour comes from spec 4.2 (R-RULES-002), 5.3, 7.1-7.4, 8.1 and DD-13, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario, setup } from '../src/testing.ts';

const ID = 'multitaskers_schedule';

function loadout(items: string[], sets: string[][], elements: Loadout['elements'] = ['tide']) {
  return { elements, items, sets } satisfies Loadout;
}

/** Six per-type sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king. */
function perType(p: {
  pawn?: string[];
  knight?: string[];
  bishop?: string[];
  rook?: string[];
  queen?: string[];
  king?: string[];
}): string[][] {
  return [p.pawn ?? [], p.knight ?? [], p.bishop ?? [], p.rook ?? [], p.queen ?? [], p.king ?? []];
}

describe("multitasker's schedule (R-LOAD-002, R-LOAD-003)", () => {
  it("R-LOAD-002 DD-13 Multitasker's Schedule costs 1 slot at min level 10 and grants per-type sets", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(10);
    expect(def?.grants?.perTypeSets).toBe(true);
    expect(def?.capacity).toBeUndefined();
    expect(def?.exclusiveGroup).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-003 R-LOAD-004 at level 10 the Schedule allows six per-type sets, and one ability may sit in several sets', () => {
    const sets = perType({
      pawn: ['poisoned_meat'],
      knight: ['hit_and_run'],
      bishop: ['poisoned_meat'],
      rook: ['scout'],
      queen: ['pierce'],
      king: ['hit_and_run'],
    });
    const v = engine.validateLoadout(loadout([ID], sets), { level: 10 });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.consumedSlots).toBe(1);
    expect(v.capacity).toBe(1);
  });

  it('R-LOAD-002 R-LOAD-004 six sets without the Schedule are rejected (rule 5)', () => {
    const sets = perType({ pawn: ['scout'], knight: ['hit_and_run'] });
    const v = engine.validateLoadout(loadout([], sets), { level: 10 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(expect.objectContaining({ rule: 5, code: 'set_count' }));
  });

  it('R-LOAD-002 R-LOAD-004 with the Schedule the set count must still be 1 or 6 (rule 5)', () => {
    expect(engine.validateLoadout(loadout([ID], [['scout']]), { level: 10 }).errors).toEqual([]);
    const two = engine.validateLoadout(loadout([ID], [['scout'], ['hit_and_run']]), { level: 10 });
    expect(two.ok).toBe(false);
    expect(two.errors).toContainEqual(expect.objectContaining({ rule: 5, code: 'set_count' }));
  });

  it('R-LOAD-002 R-LOAD-004 below level 10 the Schedule is rejected (rule 2)', () => {
    const v = engine.validateLoadout(loadout([ID], perType({ pawn: ['scout'] })), { level: 9 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-LOAD-003 R-LOAD-004 every per-type set is checked against capacity and duplicates on its own', () => {
    // Schedule + Dual Adept's Glove at level 10: 2 of 3 slots, capacity 2 per set.
    const ok = perType({
      pawn: ['scout', 'hit_and_run'],
      knight: ['scout', 'hit_and_run'],
      king: ['pierce', 'scout'],
    });
    expect(
      engine.validateLoadout(loadout([ID, 'dual_adepts_glove'], ok), { level: 10 }).errors,
    ).toEqual([]);
    const over = perType({ pawn: ['scout'], rook: ['scout', 'pierce', 'hit_and_run'] });
    const v1 = engine.validateLoadout(loadout([ID, 'dual_adepts_glove'], over), { level: 10 });
    expect(v1.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'capacity_exceeded' }),
    );
    const dup = perType({ bishop: ['scout', 'scout'] });
    const v2 = engine.validateLoadout(loadout([ID, 'dual_adepts_glove'], dup), { level: 10 });
    expect(v2.errors).toContainEqual(
      expect.objectContaining({ rule: 4, code: 'duplicate_ability' }),
    );
  });

  it('R-LOAD-002 R-LOAD-003 the battle expands six sets onto their own piece types', () => {
    const sets = perType({ knight: ['hit_and_run'], bishop: ['cleave'], queen: ['pierce'] });
    const { state } = setup({ white: { items: [ID], sets }, black: {} });
    expect(state.armies.white.sets).toEqual({
      pawn: [],
      knight: ['hit_and_run'],
      bishop: ['cleave'],
      rook: [],
      queen: ['pierce'],
      king: [],
    });
  });

  it('R-LOAD-002 R-LOAD-003 different abilities per type apply in battle: the knight set fires for a knight capture only', () => {
    // Knight c3 takes d5 (knight set: Hit and Run). A black pawn e6 sits diagonal to d5, so Cleave
    // (bishop set only) would take it if it wrongly applied to the knight.
    const sets = perType({ knight: ['hit_and_run'], bishop: ['cleave'] });
    const r = scenario({
      fen: '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID], sets },
      black: {},
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [knight, 'hit_and_run'],
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'e6')?.side).toBe('black');
  });

  it('R-LOAD-002 R-LOAD-003 different abilities per type apply in battle: the bishop set fires for a bishop capture only', () => {
    // Bishop b3 takes d5 (bishop set: Cleave takes e6). Hit and Run (knight set) must not move it back.
    const sets = perType({ knight: ['hit_and_run'], bishop: ['cleave'] });
    const r = scenario({
      fen: '4k3/8/4p3/3p4/8/1B6/8/4K3 w - - 0 1',
      white: { items: [ID], sets },
      black: {},
      moves: ['b3d5'],
    });
    const bishop = idAt(r.initial, 'b3');
    const pawnE6 = idAt(r.initial, 'e6');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [bishop, 'cleave'],
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toContainEqual([
      pawnE6,
      'effect',
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(bishop);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-003 per-type sets apply to the victim side too: a pawn set fires, an empty knight set does not', () => {
    // Black: pawn set Poisoned Meat, knight set empty. White knight c3 takes the pawn d5 and dies;
    // white knight f3 takes the black knight e5 and survives.
    const black = { items: [ID], sets: perType({ pawn: ['poisoned_meat'] }) };
    const fen = '4k3/8/8/3pn3/8/2N2N2/8/4K3 w - - 0 1';
    const onPawn = scenario({ fen, white: {}, black, moves: ['c3d5'] });
    const knightC3 = idAt(onPawn.initial, 'c3');
    expect(eventsOf(onPawn.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'poisoned_meat',
    ]);
    expect(onPawn.state.pieces[knightC3]?.square).toBe(-1);

    const onKnight = scenario({ fen, white: {}, black, moves: ['f3e5'] });
    const knightF3 = idAt(onKnight.initial, 'f3');
    expect(eventsOf(onKnight.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(onKnight.state, 'e5')?.id).toBe(knightF3);
  });

  it('R-LOAD-002 R-LOAD-003 R-RULES-002 a promoted pawn adopts its new type’s set: the queen set fires, the pawn set no longer does', () => {
    // White pawn b7 promotes on b8; later the new queen takes the rook b5. Queen set: Hit and Run
    // (back to b8). Pawn set: Cleave, which would take the black pawn c6 if it still applied.
    const sets = perType({ pawn: ['cleave'], queen: ['hit_and_run'] });
    const r = scenario({
      fen: '8/1P6/2p5/1r5k/8/8/8/K7 w - - 0 1',
      white: { items: [ID], sets },
      black: {},
      moves: ['b7b8q', 'h5h4', 'b8b5'],
    });
    const pawn = idAt(r.initial, 'b7');
    expect(r.state.pieces[pawn]?.type).toBe('queen');
    const last = r.steps[2]?.events ?? [];
    expect(
      eventsOf(last, 'AbilityTriggered').map((e) => [e.piece, e.pieceType, e.ability]),
    ).toEqual([[pawn, 'queen', 'hit_and_run']]);
    expect(pieceAt(r.state, 'b8')?.id).toBe(pawn);
    expect(pieceAt(r.state, 'b5')).toBeUndefined();
    expect(pieceAt(r.state, 'c6')?.side).toBe('black');
  });

  it('R-LOAD-002 R-INFO-001 the opponent sees consumed slots but not that the Schedule is equipped', () => {
    const sets = perType({ knight: ['hit_and_run'], bishop: ['cleave'] });
    const { engine: e, state } = setup({ white: { items: [ID], sets }, black: {} });
    const pub = e.project(state, 'black');
    expect(pub.armies.white.consumedSlots).toBe(1);
    expect(pub.armies.white.loadout).toBeUndefined();
    expect(pub.armies.white.sets).toBeUndefined();
    expect(pub.armies.white.revealed.items).toEqual([]);
    expect(JSON.stringify(pub)).not.toContain(ID);
    // The owner sees its own sets.
    expect(e.project(state, 'white').armies.white.sets?.knight).toEqual(['hit_and_run']);
  });
});
