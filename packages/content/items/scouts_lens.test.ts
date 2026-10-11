/**
 * Scout's Lens scenario tests (R-LOAD-002, spec 7.2): 1 slot, min level 3. At battle start it
 * reveals the opponent's whole pawn set (every ability in it, in order; the pawn type reads
 * complete), and the Lens itself is revealed when it fires, so both players see what was exposed
 * (DD-27). Explicit reveals still name veiled abilities (DD-28). Until the B5 brief (2026-10-11) it
 * revealed only the first ability of the set.
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

/** Reveals about `side`'s abilities: single names and whole sets. */
function abilityReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && (e.info.kind === 'ability' || e.info.kind === 'set'),
  );
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

  it("R-LOAD-002 DD-27 the Lens reveals every ability in the opponent's pawn set and the pawn set reads complete", () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: { items: ['dual_adepts_glove'], abilities: ['poisoned_meat', 'last_word'] },
    });
    expect(events[0]?.k).toBe('BattleStarted');
    // One set reveal, in the set's order, attributed to the Lens.
    expect(abilityReveals(events, 'black')).toEqual([
      expect.objectContaining({
        side: 'black',
        info: { kind: 'set', pieceType: 'pawn', abilities: ['poisoned_meat', 'last_word'] },
        cause: 'effect',
        source: { kind: 'item', id: ID, side: 'white' },
      }),
    ]);
    expect(lensReveals(events, 'white')).toHaveLength(1);
    // The whole pawn set and nothing else: the pawn type is complete, no other type is touched.
    expect(state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat', 'last_word'] });
    expect(state.reveals.black.complete).toEqual(['pawn']);
    expect(state.reveals.black.items).toEqual([]);
    expect(state.reveals.white.items).toEqual([ID]);
    // The Lens reveals nothing about its owner's own abilities.
    expect(state.reveals.white.abilities).toEqual({});
    expect(state.reveals.white.complete).toEqual([]);
  });

  it('R-LOAD-002 DD-27 R-INFO-005 both players see which pawn abilities the Lens exposed', () => {
    const {
      engine: e,
      state,
      events,
    } = setup({
      white: { items: [ID] },
      black: { abilities: ['backdraft', 'last_word'] },
    });
    const whiteView = e.project(state, 'white');
    expect(whiteView.armies.black.revealed.abilities).toEqual({
      pawn: ['backdraft', 'last_word'],
    });
    expect(whiteView.armies.black.revealed.complete).toEqual(['pawn']);
    const blackView = e.project(state, 'black');
    expect(blackView.armies.white.revealed.items).toEqual([ID]);
    // Black's own army view carries the same reveal log about Black.
    expect(blackView.armies.black.revealed.abilities.pawn).toEqual(['backdraft', 'last_word']);
    expect(blackView.armies.black.revealed.complete).toEqual(['pawn']);
    // The projected setup events name the Lens as the source for Black too.
    const seenByBlack = eventsOf(e.projectEvents(state, events, 'black'), 'Revealed');
    expect(seenByBlack).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'set', pieceType: 'pawn', abilities: ['backdraft', 'last_word'] },
        source: { kind: 'item', id: ID, side: 'white' },
      }),
    );
    // Only the pawn set: with one army-wide set the other types' copies stay unrevealed.
    expect(whiteView.armies.black.revealed.abilities.knight).toBeUndefined();
    expect(whiteView.armies.black.revealed.complete).not.toContain('knight');
  });

  it("R-LOAD-002 R-LOAD-003 DD-27 with the opponent's Schedule the Lens reads the pawn set, in order, not another type's set", () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: {
        items: ['multitaskers_schedule'],
        sets: [['last_word', 'cleave'], ['poisoned_meat'], [], [], [], []],
      },
    });
    expect(state.reveals.black.abilities).toEqual({ pawn: ['last_word', 'cleave'] });
    expect(state.reveals.black.complete).toEqual(['pawn']);
    expect(abilityReveals(events, 'black').map((e) => e.info)).toEqual([
      { kind: 'set', pieceType: 'pawn', abilities: ['last_word', 'cleave'] },
    ]);
    // Nothing about the knights' Poisoned Meat reaches White.
    expect(JSON.stringify(engine.project(state, 'white'))).not.toContain('poisoned_meat');
  });

  it('R-LOAD-002 DD-27 an empty pawn set is revealed as complete: the opponent learns the pawns carry nothing', () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: { items: ['multitaskers_schedule'], sets: [[], ['cleave'], [], [], [], []] },
    });
    expect(abilityReveals(events, 'black').map((e) => e.info)).toEqual([
      { kind: 'set', pieceType: 'pawn', abilities: [] },
    ]);
    expect(state.reveals.black.abilities).toEqual({ pawn: [] });
    expect(state.reveals.black.complete).toEqual(['pawn']);
    expect(lensReveals(events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-28 the Lens is an explicit reveal, so it still names the abilities of a veiled pawn set, Veil included', () => {
    const { state, events } = setup({
      white: { items: [ID] },
      black: { items: ['dual_adepts_glove'], abilities: ['poisoned_meat', 'veil'] },
    });
    expect(state.reveals.black.abilities.pawn).toEqual(['poisoned_meat', 'veil']);
    expect(state.reveals.black.complete).toEqual(['pawn']);
    // Named outright: Veil's filter never ran, so no "veiled" marker is set for pawns.
    expect(state.reveals.black.veiled).toEqual([]);
    expect(abilityReveals(events, 'black').map((e) => e.info)).toEqual([
      { kind: 'set', pieceType: 'pawn', abilities: ['poisoned_meat', 'veil'] },
    ]);
  });

  it('R-LOAD-002 DD-27 when both players carry the Lens, each sees the other’s whole pawn set and both Lenses are revealed', () => {
    const { state } = setup({
      white: { items: [ID], abilities: ['scout'] },
      black: { items: [ID], abilities: ['antidote'] },
    });
    expect(state.reveals.black.abilities).toEqual({ pawn: ['antidote'] });
    expect(state.reveals.white.abilities).toEqual({ pawn: ['scout'] });
    expect(state.reveals.black.complete).toEqual(['pawn']);
    expect(state.reveals.white.complete).toEqual(['pawn']);
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
    expect(state.reveals.black.complete).toEqual([]);
    expect(state.reveals.white.items).toEqual([]);
  });
});
