/**
 * Duelist's Gauntlet scenario tests (R-LOAD-002, spec 7.2; plan item C7, DD-126): 1 slot, min level
 * 10. The wearer's When-capturing abilities are never silenced; its When-captured abilities are
 * always silenced when the foil captures them, under every scope and however often it already has
 * (ONCE_PER_ABILITY's once never spends, DD-108). After-capturing abilities are silenced as usual;
 * under OFF nothing happens. Revealed when it changes an outcome (8.2). Resonance Crystal's one spared
 * silence still applies; negations are not silences.
 *
 * Expected behaviour comes from spec 6.1, 6.2, 7.2, 8.2 and DD-30, DD-36, DD-108, DD-126, not from
 * the engine's current output. Ember beats Grove: a Grove captor's Capturing abilities are silenced
 * when it takes an Ember piece, and a Grove victim's Captured abilities when an Ember piece takes it.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, scenario } from '../src/testing.ts';

const ID = 'duelists_gauntlet';
const itemReveals = (events: readonly BattleEvent[], side: 'white' | 'black', item = ID) =>
  eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === item,
  );
const silenced = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'AbilitySilenced').map((e) => e.ability);
const negated = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'AbilityNegated').map((e) => e.ability);

/** Grove knight c3 (White, Capturing card) takes the Ember pawn d5 (Poisoned Meat). Ids: K=0 N=1 p=2 k=3. */
const GROVE_TAKES_EMBER = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
/** Ember knight c3 (White) takes the Grove pawns d5 and then f6 (Poisoned Meat). Ids: K=0 N=1 p(d5)=2 p(f6)=3 k=4. */
const EMBER_TAKES_TWO = '4k3/8/5p2/3p4/8/2N5/8/4K3 w - - 0 1';

describe("duelist's gauntlet (R-LOAD-002, DD-126)", () => {
  it("R-LOAD-002 Duelist's Gauntlet costs 1 slot at min level 10", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(10);
    expect(def?.capacity).toBeUndefined();
    expect(def?.hooks.silenceOverride).toBeTypeOf('function');
    expect(def?.hooks.triggerFilter).toBeTypeOf('function');
  });

  it('R-LOAD-002 R-LOAD-004 the Gauntlet validates at level 10 and is rejected at level 9 (rule 2)', () => {
    const l: Loadout = { elements: ['grove'], items: [ID], sets: [['pierce']] };
    expect(engine.validateLoadout(l, { level: 10 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 9 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it("R-ELEM-002 DD-126 the wearer's When-capturing ability is not silenced by the foil: Pierce fires, negates Poisoned Meat, the knight lives and the Gauntlet is revealed", () => {
    const r = scenario({
      fen: GROVE_TAKES_EMBER,
      white: { elements: ['grove'], items: [ID], abilities: ['pierce'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(silenced(r.events)).toEqual([]);
    expect(negated(r.events)).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'd5')).toBe(1);
    expect(itemReveals(r.events, 'white')).toHaveLength(1);
    expect(r.state.reveals.white.items).toContain(ID);
  });

  it('R-ELEM-002 control: without the Gauntlet the same Pierce is silenced and Poisoned Meat takes the knight', () => {
    const r = scenario({
      fen: GROVE_TAKES_EMBER,
      white: { elements: ['grove'], abilities: ['pierce'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(silenced(r.events)).toEqual(['pierce']);
    expect(negated(r.events)).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(-1);
  });

  it('R-ELEM-002 DD-126 After-capturing abilities are not spared: a Grove Hit and Run taking an Ember pawn is still silenced', () => {
    const r = scenario({
      fen: GROVE_TAKES_EMBER,
      white: { elements: ['grove'], items: [ID], abilities: ['hit_and_run'] },
      black: { elements: ['ember'] },
      moves: ['c3d5'],
    });
    expect(silenced(r.events)).toEqual(['hit_and_run']);
    expect(idAt(r.state, 'd5')).toBe(1);
    expect(itemReveals(r.events, 'white')).toHaveLength(0);
  });

  it("R-ELEM-002 DD-108 DD-126 under ONCE_PER_ABILITY the wearer's When-captured ability is silenced every time the foil captures it, and the Gauntlet is revealed when the once is already spent", () => {
    const caps = { SILENCE_SCOPE: 'ONCE_PER_ABILITY' as const };
    const control = scenario({
      fen: EMBER_TAKES_TWO,
      caps,
      white: { elements: ['ember'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5f6'],
    });
    // The once: the first Poisoned Meat is silenced, the second fires and takes the knight.
    expect(silenced(control.steps[0]?.events ?? [])).toEqual(['poisoned_meat']);
    expect(silenced(control.steps[2]?.events ?? [])).toEqual([]);
    expect(idAt(control.state, 'f6')).toBe(-1);

    const r = scenario({
      fen: EMBER_TAKES_TWO,
      caps,
      white: { elements: ['ember'] },
      black: { elements: ['grove'], items: [ID], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5f6'],
    });
    expect(silenced(r.steps[0]?.events ?? [])).toEqual(['poisoned_meat']);
    expect(silenced(r.steps[2]?.events ?? [])).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'f6')).toBe(1);
    // Observable only at the second capture, where the plain rule would have let it fire.
    expect(itemReveals(r.steps[0]?.events ?? [], 'black')).toHaveLength(0);
    expect(itemReveals(r.steps[2]?.events ?? [], 'black')).toHaveLength(1);
    expect(r.state.reveals.black.items).toContain(ID);
  });

  it('R-ELEM-002 DD-126 under ALL_TRIGGERS the When-captured silence coincides with the element rule: both captures are silenced and the Gauntlet stays hidden', () => {
    const r = scenario({
      fen: EMBER_TAKES_TWO,
      white: { elements: ['ember'] },
      black: { elements: ['grove'], items: [ID], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5f6'],
    });
    expect(silenced(r.events)).toEqual(['poisoned_meat', 'poisoned_meat']);
    expect(itemReveals(r.events, 'black')).toHaveLength(0);
  });

  it('R-ELEM-002 DD-126 under REACTIONS_ONLY the Capturing half is moot (no silence, no reveal) and under OFF the item does nothing', () => {
    const reactionsOnly = scenario({
      fen: GROVE_TAKES_EMBER,
      caps: { SILENCE_SCOPE: 'REACTIONS_ONLY' },
      white: { elements: ['grove'], items: [ID], abilities: ['pierce'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(silenced(reactionsOnly.events)).toEqual([]);
    expect(negated(reactionsOnly.events)).toEqual(['poisoned_meat']);
    expect(itemReveals(reactionsOnly.events, 'white')).toHaveLength(0);

    const off = scenario({
      fen: EMBER_TAKES_TWO,
      caps: { SILENCE_SCOPE: 'OFF' },
      white: { elements: ['ember'] },
      black: { elements: ['grove'], items: [ID], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(silenced(off.events)).toEqual([]);
    expect(eventsOf(off.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'poisoned_meat',
    ]);
    expect(idAt(off.state, 'd5')).toBe(-1);
    expect(itemReveals(off.events, 'black')).toHaveLength(0);
  });

  it("R-ELEM-002 DD-126 the opponent's pieces are untouched: White's Gauntlet neither spares Black's silenced Pierce nor silences anything of Black's", () => {
    // Black Grove knight d5 (Pierce) takes the white Ember pawn c3 (Poisoned Meat). Ids: K=0 P=1 n=2 k=3.
    const r = scenario({
      fen: '4k3/8/8/3n4/8/2P5/8/4K3 b - - 0 1',
      white: { elements: ['ember'], items: [ID], abilities: ['poisoned_meat'] },
      black: { elements: ['grove'], abilities: ['pierce'] },
      moves: ['d5c3'],
    });
    expect(silenced(r.events)).toEqual(['pierce']);
    expect(negated(r.events)).toEqual([]);
    expect(idAt(r.state, 'c3')).toBe(-1);
    expect(itemReveals(r.events, 'white')).toHaveLength(0);
  });

  it('DD-30 DD-126 Resonance Crystal still spares its one silence: the first Poisoned Meat fires through the Crystal, the second is silenced (by the element and the Gauntlet alike)', () => {
    // Ember knights c3 and g4 take the Grove pawns d5 and f6. Ids: K=0 N(c3)=1 N(g4)=2 p(d5)=3 p(f6)=4 k=5.
    const r = scenario({
      fen: '4k3/8/5p2/3p4/6N1/2N5/8/4K3 w - - 0 1',
      caps: { SILENCE_SCOPE: 'ONCE_PER_ABILITY' },
      white: { elements: ['ember'] },
      black: {
        elements: ['grove'],
        items: [ID, 'resonance_crystal'],
        abilities: ['poisoned_meat'],
      },
      moves: ['c3d5', 'e8d8', 'g4f6'],
    });
    const first = r.steps[0]?.events ?? [];
    expect(silenced(first)).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(-1);
    expect(itemReveals(first, 'black', 'resonance_crystal')).toHaveLength(1);
    const third = r.steps[2]?.events ?? [];
    expect(silenced(third)).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'f6')).toBe(2);
    // The Crystal's spare came before the once was recorded, so the element's own once silences the
    // second capture: the Gauntlet's silence coincides with the plain rule and stays unobserved.
    expect(r.state.reveals.black.items).toContain('resonance_crystal');
    expect(r.state.reveals.black.items).not.toContain(ID);
  });

  it('DD-36 DD-126 a negation is not a silence: Pierce still negates the wearer’s Poisoned Meat and the Gauntlet is not revealed', () => {
    const r = scenario({
      fen: GROVE_TAKES_EMBER,
      white: { abilities: ['pierce'] },
      black: { items: [ID], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(negated(r.events)).toEqual(['poisoned_meat']);
    expect(silenced(r.events)).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(1);
    expect(itemReveals(r.events, 'black')).toHaveLength(0);
  });
});
