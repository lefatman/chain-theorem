/**
 * Herald's Horn scenario tests (R-LOAD-002, spec 7.2; plan item C7, DD-128): 1 slot, min level 7. At
 * battle start both players' full item lists are revealed (the engine's `items` reveal, cause effect,
 * the Horn as source), the Horn itself included, an empty list as complete; item parameters stay
 * hidden; two Horns reveal once. Expected behaviour comes from spec 7.2, 8.1, 8.2, 8.3 and DD-128,
 * not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, Loadout, Side } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, setup } from '../src/testing.ts';

const ID = 'heralds_horn';
const KINGS = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
const itemsReveals = (events: readonly BattleEvent[], side: Side) =>
  eventsOf(events, 'Revealed').filter((e) => e.side === side && e.info.kind === 'items');
const hornReveals = (events: readonly BattleEvent[], side: Side) =>
  eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );

describe("herald's horn (R-LOAD-002, DD-128)", () => {
  it("R-LOAD-002 Herald's Horn costs 1 slot at min level 7", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(7);
    expect(def?.capacity).toBeUndefined();
    expect(def?.hooks.onBattleStart).toBeTypeOf('function');
  });

  it('R-LOAD-002 R-LOAD-004 the Horn validates at level 7 and is rejected at level 6 (rule 2)', () => {
    const l: Loadout = { elements: ['ember'], items: [ID], sets: [['scout']] };
    expect(engine.validateLoadout(l, { level: 7 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 6 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it("R-INFO-002 DD-128 at battle start both players' item lists are revealed as complete, with the Horn as the source and the Horn itself revealed", () => {
    const { state, events } = setup({
      fen: KINGS,
      white: { items: [ID, 'scouts_lens'] },
      black: {
        elements: ['grove'],
        items: ['resonance_crystal', 'masquerade_mask'],
        itemParams: { masquerade_mask: { element: 'tide' } },
      },
    });
    expect([...state.reveals.white.items].sort()).toEqual([ID, 'scouts_lens']);
    expect(state.reveals.white.allItems).toBe(true);
    expect([...state.reveals.black.items].sort()).toEqual(['masquerade_mask', 'resonance_crystal']);
    expect(state.reveals.black.allItems).toBe(true);
    for (const side of ['white', 'black'] as const) {
      const evs = itemsReveals(events, side);
      expect(evs).toHaveLength(1);
      expect(evs[0]?.cause).toBe('effect');
      expect(evs[0]?.source).toEqual({ kind: 'item', id: ID, side: 'white' });
    }
    expect(hornReveals(events, 'white')).toHaveLength(1);
  });

  it("R-SEC-001 DD-128 each player's projection shows the other's item ids, never their loadout or an item's parameter", () => {
    const { state } = setup({
      fen: KINGS,
      white: { items: [ID] },
      black: {
        elements: ['grove'],
        items: ['masquerade_mask'],
        itemParams: { masquerade_mask: { element: 'tide' } },
      },
    });
    const forBlack = engine.project(state, 'black');
    expect(forBlack.armies.white.revealed.items).toEqual([ID]);
    expect(forBlack.armies.white.revealed.allItems).toBe(true);
    expect(forBlack.armies.white.loadout).toBeUndefined();
    const forWhite = engine.project(state, 'white');
    expect(forWhite.armies.black.revealed.items).toEqual(['masquerade_mask']);
    expect(forWhite.armies.black.loadout).toBeUndefined();
    // The Mask still shows its chosen element: the Horn tells White a Mask is worn, not what it shows.
    expect(forWhite.armies.black.elements).toEqual(['tide']);
    expect(JSON.stringify(forWhite.armies.black.revealed)).not.toContain('tide');
  });

  it('DD-128 an empty item list is revealed as complete too', () => {
    const { state, events } = setup({ fen: KINGS, white: { items: [ID] }, black: { items: [] } });
    expect(state.reveals.black.items).toEqual([]);
    expect(state.reveals.black.allItems).toBe(true);
    const evs = itemsReveals(events, 'black');
    expect(evs).toHaveLength(1);
    expect(evs[0]?.info).toEqual({ kind: 'items', items: [] });
  });

  it('DD-128 two Horns reveal each list once: no duplicate reveals, and both Horns are known', () => {
    const { state, events } = setup({
      fen: KINGS,
      white: { items: [ID, 'resonance_crystal'] },
      black: { items: [ID, 'scouts_lens'] },
    });
    expect(itemsReveals(events, 'white')).toHaveLength(1);
    expect(itemsReveals(events, 'black')).toHaveLength(1);
    // The first Horn to run lists the other side's items, the other Horn among them, so at most one
    // of the two is revealed by its own `revealSelf`; both are known either way.
    expect(
      hornReveals(events, 'white').length + hornReveals(events, 'black').length,
    ).toBeLessThanOrEqual(2);
    expect(state.reveals.white.items).toContain(ID);
    expect(state.reveals.black.items).toContain(ID);
    expect(state.reveals.white.allItems && state.reveals.black.allItems).toBe(true);
  });

  it("DD-121 DD-128 Scout's Lens still does its own work beside the Horn: the opponent's pawn set reads complete", () => {
    const { state } = setup({ fen: KINGS, white: { items: [ID, 'scouts_lens'] } });
    expect(state.reveals.black.complete).toContain('pawn');
    expect(state.reveals.black.allItems).toBe(true);
  });
});
