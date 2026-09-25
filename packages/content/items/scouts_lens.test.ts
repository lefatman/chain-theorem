/**
 * Scout's Lens scenario tests (R-LOAD-002, spec 7.2): 1 slot, min level 3. At battle start it
 * reveals the first ability in the opponent's pawn set, and the Lens itself is revealed when it
 * fires, so both players see what was exposed (DD-27). Explicit reveals still name veiled
 * abilities (DD-28).
 *
 * Expected behaviour comes from spec 7.2, 7.3, 8.1, 8.2, 8.5 and DD-27, DD-28, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, setup } from '../src/testing.ts';

const ID = 'scouts_lens';

function lensReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );
}

function abilityReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter((e) => e.side === side && e.info.kind === 'ability');
}

describe("scout's lens (R-LOAD-002)", () => {
  it("R-LOAD-002 Scout's Lens costs 1 slot at min level 3", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(3);
    expect(def?.capacity).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-004 the Lens validates at level 3 and is rejected at level 2 (rule 2)', () => {
    const l: Loadout = { elements: ['tide'], items: [ID], sets: [['scout']] };
    expect(engine.validateLoadout(l, { level: 3 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 2 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it("R-LOAD-002 DD-27 at battle start the Lens reveals only the first ability of the opponent's pawn set and is itself revealed", () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: { items: ['dual_adepts_glove'], abilities: ['poisoned_meat', 'last_word'] },
    });
    expect(events[0]?.k).toBe('BattleStarted');
    expect(abilityReveals(events, 'black')).toEqual([
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
        source: { kind: 'item', id: ID, side: 'white' },
      }),
    ]);
    expect(lensReveals(events, 'white')).toHaveLength(1);
    // Only the pawn set's first ability; the set is not complete and no other type is revealed.
    expect(state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(state.reveals.black.complete).toEqual([]);
    expect(state.reveals.black.items).toEqual([]);
    expect(state.reveals.white.items).toEqual([ID]);
    // The Lens reveals nothing about its owner's own abilities.
    expect(state.reveals.white.abilities).toEqual({});
  });

  it('R-LOAD-002 DD-27 R-INFO-005 both players see which pawn ability the Lens exposed', () => {
    const {
      engine: e,
      state,
      events,
    } = setup({
      white: { items: [ID] },
      black: { abilities: ['backdraft', 'last_word'] },
    });
    const whiteView = e.project(state, 'white');
    expect(whiteView.armies.black.revealed.abilities.pawn).toEqual(['backdraft']);
    const blackView = e.project(state, 'black');
    expect(blackView.armies.white.revealed.items).toEqual([ID]);
    // Black's own army view carries the same reveal log about Black.
    expect(blackView.armies.black.revealed.abilities.pawn).toEqual(['backdraft']);
    // The projected setup events name the Lens as the source for Black too.
    const seenByBlack = eventsOf(e.projectEvents(state, events, 'black'), 'Revealed');
    expect(seenByBlack).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'pawn', ability: 'backdraft' },
        source: { kind: 'item', id: ID, side: 'white' },
      }),
    );
    // Last Word stays hidden from White.
    expect(JSON.stringify(whiteView)).not.toContain('last_word');
  });

  it("R-LOAD-002 R-LOAD-003 DD-27 with the opponent's Schedule the Lens reads the pawn set, not another type's set", () => {
    const { state } = setup({
      white: { items: [ID] },
      black: {
        items: ['multitaskers_schedule'],
        sets: [['cleave', 'last_word'], ['poisoned_meat'], [], [], [], []],
      },
    });
    expect(state.reveals.black.abilities).toEqual({ pawn: ['cleave'] });
  });

  it('R-LOAD-002 DD-28 the Lens is an explicit reveal, so it still names an ability on a veiled pawn set', () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: { items: ['dual_adepts_glove'], abilities: ['poisoned_meat', 'veil'] },
    });
    expect(state.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    expect(abilityReveals(events, 'black').map((e) => e.info)).toEqual([
      { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
    ]);
  });

  it('R-LOAD-002 DD-27 when both players carry the Lens, each sees the other’s first pawn ability and both Lenses are revealed', () => {
    const { state } = setup({
      white: { items: [ID], abilities: ['scout'] },
      black: { items: [ID], abilities: ['antidote'] },
    });
    expect(state.reveals.black.abilities).toEqual({ pawn: ['antidote'] });
    expect(state.reveals.white.abilities).toEqual({ pawn: ['scout'] });
    expect(state.reveals.white.items).toEqual([ID]);
    expect(state.reveals.black.items).toEqual([ID]);
  });

  it('R-LOAD-002 R-INFO-001 without the Lens nothing about the opponent is revealed at battle start', () => {
    const { state, events } = setup({
      white: { items: ['resonance_crystal'] },
      black: { abilities: ['poisoned_meat'] },
    });
    expect(eventsOf(events, 'Revealed')).toEqual([]);
    expect(state.reveals.black.abilities).toEqual({});
    expect(state.reveals.white.items).toEqual([]);
  });
});
