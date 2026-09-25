/**
 * Masquerade Mask scenario tests (R-LOAD-002, spec 7.2, 8.1): 1 slot, min level 14, an element
 * parameter chosen in the loadout (DD-29). The opponent sees the chosen element for all of the
 * wearer's pieces (hiding Blended Family too) until the first silence event that involves any of
 * the wearer's pieces in either direction; then the true elements show and the Mask is revealed
 * (DD-26). The wearer always sees its own true elements.
 *
 * Expected behaviour comes from spec 6.2, 7.2, 8.1, 8.2, 8.5 and DD-13, DD-26, DD-29, DD-30,
 * DD-36, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, ElementId, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { type ArmySpec, eventsOf, idAt, pieceAt, scenario, setup } from '../src/testing.ts';

const ID = 'masquerade_mask';

/** A masked army: true element(s) `elements`, shown as `shown` to the opponent. */
function masked(elements: ElementId[], shown: ElementId, extra: ArmySpec = {}): ArmySpec {
  return {
    ...extra,
    elements,
    items: [...(extra.items ?? []), ID],
    itemParams: { ...extra.itemParams, [ID]: { element: shown } },
  };
}

function maskReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );
}

// Knight c3 takes the pawn d5.
const KNIGHT_FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('masquerade mask (R-LOAD-002)', () => {
  it('R-LOAD-002 DD-13 DD-29 Masquerade Mask costs 1 slot at min level 14 and needs an element parameter', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(14);
    expect(def?.param).toEqual({ element: 'required' });
  });

  it('R-LOAD-002 R-LOAD-004 DD-29 the Mask validates at level 14 with a chosen element; without one, or below level 14, it is rejected', () => {
    const base: Loadout = { elements: ['tide'], items: [ID], sets: [['scout']] };
    const withParam: Loadout = { ...base, itemParams: { [ID]: { element: 'grove' } } };
    expect(engine.validateLoadout(withParam, { level: 14 }).errors).toEqual([]);
    const noParam = engine.validateLoadout(base, { level: 14 });
    expect(noParam.ok).toBe(false);
    expect(noParam.errors).toContainEqual(expect.objectContaining({ code: 'item_param', ref: ID }));
    const low = engine.validateLoadout(withParam, { level: 13 });
    expect(low.ok).toBe(false);
    expect(low.errors).toContainEqual(expect.objectContaining({ rule: 2, code: 'item_level' }));
  });

  it('R-LOAD-002 DD-26 R-INFO-001 the opponent sees the chosen element on every wearer piece; the wearer sees the truth', () => {
    const { engine: e, state } = setup({
      white: masked(['tide'], 'ember'),
      black: { elements: ['grove'] },
    });
    const opp = e.project(state, 'black');
    expect(opp.armies.white.elements).toEqual(['ember']);
    const whiteSeenByBlack = opp.pieces.filter((p) => p.side === 'white');
    expect(whiteSeenByBlack).toHaveLength(16);
    expect(whiteSeenByBlack.every((p) => p.element === 'ember')).toBe(true);
    // Black's own pieces are unaffected.
    expect(opp.pieces.filter((p) => p.side === 'black').every((p) => p.element === 'grove')).toBe(
      true,
    );
    expect(opp.armies.white.revealed.items).toEqual([]);

    const own = e.project(state, 'white');
    expect(own.armies.white.elements).toEqual(['tide']);
    expect(own.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'tide')).toBe(
      true,
    );
    // The true state is untouched: silence and traits use the real element.
    expect(state.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'tide')).toBe(
      true,
    );
  });

  it('R-LOAD-002 DD-26 R-ELEM-004 the Mask shows one element for all pieces, hiding Blended Family', () => {
    const { engine: e, state } = setup({
      white: masked(['tide', 'ember'], 'grove', { items: ['blended_family'] }),
      black: {},
    });
    const opp = e.project(state, 'black');
    expect(opp.armies.white.elements).toEqual(['grove']);
    expect(opp.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'grove')).toBe(
      true,
    );
    expect(e.project(state, 'white').armies.white.elements).toEqual(['tide', 'ember']);
  });

  it('R-LOAD-002 DD-26 R-ELEM-002 a silence of the wearer’s piece drops the Mask: true elements show and the Mask is revealed', () => {
    // True Tide knight (shown as Ember) takes a Grove pawn: Grove beats Tide, so Hit and Run is
    // silenced. (Were the displayed Ember real, nothing would be silenced.)
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { abilities: ['hit_and_run'] }),
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(r.engine.project(r.initial, 'black').armies.white.elements).toEqual(['ember']);
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.side, e.ability])).toEqual([
      ['white', 'hit_and_run'],
    ]);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(r.state.reveals.white.items).toContain(ID);
    const opp = r.engine.project(r.state, 'black');
    expect(opp.armies.white.elements).toEqual(['tide']);
    expect(opp.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'tide')).toBe(
      true,
    );
    expect(opp.armies.white.revealed.items).toContain(ID);
  });

  it("R-LOAD-002 DD-26 R-ELEM-002 a silence the wearer's piece inflicts on the opponent drops the Mask too (either direction)", () => {
    // True Tide knight takes an Ember pawn: Tide beats Ember, so Poisoned Meat is silenced.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'grove'),
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.side, e.ability, e.by])).toEqual([
      ['black', 'poisoned_meat', knight],
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['tide']);
  });

  it('R-LOAD-002 DD-26 a black wearer’s Mask drops on the first silence involving its pieces', () => {
    // White Ember knight takes a black true-Grove pawn (shown as Tide): Poisoned Meat is silenced.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { elements: ['ember'] },
      black: masked(['grove'], 'tide', { abilities: ['poisoned_meat'] }),
      moves: ['c3d5'],
    });
    expect(r.engine.project(r.initial, 'white').armies.black.elements).toEqual(['tide']);
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(maskReveals(r.events, 'black')).toHaveLength(1);
    const opp = r.engine.project(r.state, 'white');
    expect(opp.armies.black.elements).toEqual(['grove']);
    expect(opp.pieces.filter((p) => p.side === 'black').every((p) => p.element === 'grove')).toBe(
      true,
    );
  });

  it('R-LOAD-002 DD-26 one silence involves both sides, so it drops both players’ Masks', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { abilities: ['hit_and_run'] }),
      black: masked(['grove'], 'tide'),
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toHaveLength(1);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(maskReveals(r.events, 'black')).toHaveLength(1);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['tide']);
    expect(r.engine.project(r.state, 'white').armies.black.elements).toEqual(['grove']);
  });

  it('R-LOAD-002 DD-26 a capture without any silence keeps the Mask up and hidden', () => {
    // Tide vs Tide: nothing is silenced; Poisoned Meat takes the knight, and the Mask stays.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { abilities: ['hit_and_run'] }),
      black: { elements: ['tide'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').length).toBeGreaterThan(0);
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect(r.state.reveals.white.items).toEqual([]);
    const opp = r.engine.project(r.state, 'black');
    expect(opp.armies.white.elements).toEqual(['ember']);
    expect(opp.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'ember')).toBe(
      true,
    );
    expect(JSON.stringify(opp)).not.toContain(ID);
  });

  it('R-LOAD-002 DD-26 DD-36 a negated trigger is not a silence event, so the Mask stays up', () => {
    // True Tide knight with Pierce takes an Ember pawn: Poisoned Meat would be silenced, but Pierce
    // negates it first (negation takes precedence over silence).
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'grove', { abilities: ['pierce'] }),
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['grove']);
  });

  it('R-LOAD-002 DD-26 DD-30 a silence prevented by Resonance Crystal does not happen, so the Mask stays up', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { items: ['resonance_crystal'], abilities: ['cleave'] }),
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['cleave']);
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['ember']);
  });

  it('R-LOAD-002 DD-26 R-INFO-005 R-SEC-001 a masked promotion does not leak the true element through projected events', () => {
    const r = scenario({
      fen: '8/1P6/8/8/8/8/8/K6k w - - 0 1',
      white: masked(['tide'], 'ember'),
      black: {},
      moves: ['b7b8q'],
    });
    const pawn = idAt(r.initial, 'b7');
    expect(r.state.pieces[pawn]?.element).toBe('tide');
    const shown = r.engine.project(r.state, 'black').pieces[pawn]?.element;
    expect(shown).toBe('ember');
    const promoted = eventsOf(r.engine.projectEvents(r.state, r.events, 'black'), 'Promoted');
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.element).toBe(shown);
    // The wearer's own view keeps the truth.
    const ownPromoted = eventsOf(r.engine.projectEvents(r.state, r.events, 'white'), 'Promoted');
    expect(ownPromoted[0]?.element).toBe('tide');
  });
});
