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

/** The Mask dropped: the true elements were revealed (the item may already be known, e.g. Last Word). */
function maskDrops(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter((e) => e.side === side && e.info.kind === 'elements');
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
    // Tide vs Tide: nothing is silenced; Poisoned Meat takes the knight, and the Mask stays. (White
    // carries no ability: an attuned Tide activation under an Ember mask would drop it, DD-44.)
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember'),
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
    // negates it first (negation takes precedence over silence). Veil keeps Pierce unnamed, so its
    // attuned flag is not observable either (DD-44).
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'grove', { abilities: ['veil', 'pierce'] }),
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

  it('R-LOAD-002 DD-44 a named attuned activation off the shown element drops the Mask', () => {
    // Hit and Run (Tide) is attuned on the true Tide knight; shown Ember predicts it is not.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { abilities: ['hit_and_run'] }),
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    const trig = eventsOf(r.events, 'AbilityTriggered').find((e) => e.ability === 'hit_and_run');
    expect(trig?.attuned).toBe(true);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['tide']);
  });

  it('R-LOAD-002 DD-44 an unattuned activation of the shown affinity drops the Mask', () => {
    // Cleave (Ember) on a true Tide knight is not attuned; shown Ember predicts that it is.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'ember', { abilities: ['cleave'] }),
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    const trig = eventsOf(r.events, 'AbilityTriggered').find((e) => e.ability === 'cleave');
    expect(trig?.attuned).toBe(false);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-44 an attunement explained by an Attunement Charm keeps the Mask', () => {
    // True Grove knight, shown Ember, Attunement Charm (Tide): Hit and Run is attuned by the charm,
    // which the shown element plus the charm explains.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['grove'], 'ember', {
        abilities: ['hit_and_run'],
        items: ['attunement_charm'],
        itemParams: { attunement_charm: { element: 'tide' } },
      }),
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    const trig = eventsOf(r.events, 'AbilityTriggered').find((e) => e.ability === 'hit_and_run');
    expect(trig?.attuned).toBe(true);
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['ember']);
  });

  it('R-LOAD-002 DD-26 DD-30 a silence prevented by Resonance Crystal does not happen, so the Mask stays up', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'grove', { items: ['resonance_crystal'], abilities: ['cleave'] }),
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['cleave']);
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['grove']);
  });

  // ---- M7 7.3: the Storm, Stone and Frost traits (6.1) under the Mask ----------------------------

  it('R-LOAD-002 DD-44 R-ELEM-001 Bulwark: a Stone piece’s fizzle drops a Mask showing another element', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['stone'], 'ember'),
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'bulwark' }),
    ]);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['stone']);
  });

  it('R-LOAD-002 DD-44 R-ELEM-001 shown Stone: an effect capture of a piece with no spent Bulwark drops the Mask', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'stone'),
      black: { elements: ['storm'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move', 'effect']);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(r.engine.project(r.state, 'black').armies.white.elements).toEqual(['tide']);
  });

  it('R-LOAD-002 DD-44 R-ELEM-001 Stillness: negating the captor’s After-capturing ability drops a Mask showing another element', () => {
    const r = scenario({
      fen: '4k3/8/2n5/8/3P4/8/8/4K3 b - - 0 1',
      white: masked(['frost'], 'ember'),
      black: { elements: ['grove'], abilities: ['cleave'] },
      moves: ['c6d4'],
    });
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        ability: 'cleave',
        source: expect.objectContaining({ id: 'stillness' }),
      }),
    ]);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-44 R-ELEM-001 shown Frost: the captor’s After-capturing ability firing drops the Mask', () => {
    const r = scenario({
      fen: '4k3/8/2n5/8/3P4/8/8/4K3 b - - 0 1',
      white: masked(['tide'], 'frost'),
      black: { elements: ['storm'], abilities: ['hit_and_run'] },
      moves: ['c6d4'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['hit_and_run']);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-44 R-ELEM-001 Always First: a Storm captor resolving first drops the Mask, even with its abilities Veiled', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['storm'], 'grove', { abilities: ['veil', 'hit_and_run'] }),
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const pub = eventsOf(r.engine.projectEvents(r.state, r.events, 'black'), 'AbilityTriggered');
    // Black sees an unnamed white activation before its own Poisoned Meat.
    expect(pub.map((e) => [e.side, e.ability])).toEqual([
      ['white', null],
      ['black', 'poisoned_meat'],
    ]);
    expect(maskReveals(r.events, 'white')).toHaveLength(1);
    expect(maskDrops(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-44 R-ELEM-001 shown Storm: a captor resolving after a non-Storm victim drops the Mask; after a Storm victim it holds', () => {
    const drops = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'storm', { abilities: ['cleave'] }),
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(drops.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'last_word',
      'cleave',
    ]);
    // Attuned Last Word already named the Mask; the drop shows the true element.
    expect(maskDrops(drops.events, 'white')).toEqual([
      expect.objectContaining({ info: { kind: 'elements', elements: ['tide'] } }),
    ]);
    const holds = scenario({
      fen: KNIGHT_FEN,
      white: masked(['storm'], 'storm', { abilities: ['cleave'] }),
      black: { elements: ['storm'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(maskDrops(holds.events, 'white')).toEqual([]);
  });

  it('R-LOAD-002 DD-44 the capture bookkeeping is cleared when the turn passes, so it never changes the repetition hash', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: masked(['tide'], 'grove', { abilities: ['veil', 'cleave'] }),
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    expect(maskReveals(r.events, 'white')).toEqual([]);
    expect((r.state.slices[ID] as { cap: unknown }).cap).toBeNull();
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
