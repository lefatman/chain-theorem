/**
 * Veil scenario tests (R-ABIL-005, R-INFO-002, spec 5.7, 8.2, 8.5): Passive, neutral, all pieces.
 * This piece's abilities are not named when they activate; only the effect is shown. DD-28: Veil
 * hides the name for activation, silence, negation and fizzle reveals; explicit REVEAL effects still
 * name veiled abilities; the first time Veil hides a name the opponent learns that piece type is
 * veiled.
 *
 * Projection assertions use engine.projectEvents(state, events, viewer), the only form a client
 * ever receives (R-INFO-005). Expected behaviour comes from the spec, not the engine's output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, ChoiceOption, Engine, GameState, Side } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, play, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
const VEILED_PM = ['poisoned_meat', 'veil'];

function projected(engine: Engine, state: GameState, events: BattleEvent[], viewer: Side) {
  return engine.projectEvents(state, events, viewer);
}

function abilityReveals(events: readonly BattleEvent[], side: Side) {
  return eventsOf(events, 'Revealed').filter((e) => e.side === side && e.info.kind === 'ability');
}

describe('veil (R-ABIL-005, R-INFO-002)', () => {
  it("R-ABIL-005 R-INFO-002 DD-28 veil: the opponent sees a veiled activation's board effect but not the ability name", () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      black: { abilities: VEILED_PM },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawn = idAt(r.initial, 'd5');
    // The effect happens: Poisoned Meat removes the knight.
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'black', piece: pawn, ability: 'poisoned_meat' }),
    ]);
    // No name is revealed; the opponent learns only that pawns are veiled.
    expect(abilityReveals(r.events, 'black')).toHaveLength(0);
    expect(r.state.reveals.black.abilities.pawn ?? []).not.toContain('poisoned_meat');
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'black', info: { kind: 'veiled', pieceType: 'pawn' } }),
    );
    expect(r.state.reveals.black.veiled).toEqual(['pawn']);
    expect(r.engine.project(r.state, 'white').armies.black.revealed.veiled).toEqual(['pawn']);

    const white = projected(r.engine, r.state, r.events, 'white');
    expect(white.find((e) => e.k === 'AbilityTriggered')).toMatchObject({
      side: 'black',
      piece: pawn,
      ability: null,
    });
    const effect = white.find((e) => e.k === 'Captured' && e.by === 'effect');
    expect(effect).toMatchObject({ victim: knight, source: { kind: 'hidden' } });
    const json = JSON.stringify(white);
    expect(json).not.toContain('"poisoned_meat"');
    expect(json).not.toContain('"veil"');

    // The owner still sees its own ability named.
    const black = projected(r.engine, r.state, r.events, 'black');
    expect(black.find((e) => e.k === 'AbilityTriggered')).toMatchObject({
      ability: 'poisoned_meat',
    });
  });

  it('R-ABIL-005 DD-28 veil: the veiled marker is emitted only the first time a piece type is veiled', () => {
    // 1. Nc3xd5 (veiled Poisoned Meat) Ke8-f8 2. Ne3xf5 (veiled Poisoned Meat again).
    const r = scenario({
      fen: '4k3/8/8/3p1p2/8/2N1N3/8/4K3 w - - 0 1',
      black: { abilities: VEILED_PM },
      moves: ['c3d5', 'e8f8', 'e3f5'],
    });
    const veiled = eventsOf(r.events, 'Revealed').filter((e) => e.info.kind === 'veiled');
    expect(veiled).toHaveLength(1);
    expect(eventsOf(r.steps[2]?.events ?? [], 'Revealed')).toHaveLength(0);
    const third = projected(r.engine, r.state, r.steps[2]?.events ?? [], 'white');
    expect(third.find((e) => e.k === 'AbilityTriggered')).toMatchObject({ ability: null });
    expect(pieceAt(r.state, 'f5')).toBeUndefined();
    expect(r.state.reveals.black.veiled).toEqual(['pawn']);
  });

  it('R-ABIL-005 R-ELEM-002 DD-28 veil: a silenced veiled ability is not named', () => {
    // An Ember knight takes a Grove pawn: the pawn's Captured abilities are silenced (6.2).
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['grove'], abilities: VEILED_PM },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'poisoned_meat' }),
    ]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
    expect(abilityReveals(r.events, 'black')).toHaveLength(0);
    expect(r.state.reveals.black.veiled).toEqual(['pawn']);
    const white = projected(r.engine, r.state, r.events, 'white');
    expect(white.find((e) => e.k === 'AbilitySilenced')).toMatchObject({ ability: null });
    expect(JSON.stringify(white)).not.toContain('"poisoned_meat"');
  });

  it('R-ABIL-005 DD-28 veil: a negated veiled ability is not named, while the negating ability is', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['pierce'] },
      black: { abilities: VEILED_PM },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'poisoned_meat' }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(abilityReveals(r.events, 'black')).toHaveLength(0);
    const white = projected(r.engine, r.state, r.events, 'white');
    expect(white.find((e) => e.k === 'AbilityNegated')).toMatchObject({
      ability: null,
      source: { kind: 'ability', id: 'pierce', side: 'white' },
    });
    expect(white.find((e) => e.k === 'AbilityTriggered')).toMatchObject({ ability: 'pierce' });
    expect(JSON.stringify(white)).not.toContain('"poisoned_meat"');
  });

  it('R-ABIL-005 R-RULES-004 DD-28 veil: a fizzled veiled ability is not named (E3 under Veil)', () => {
    const r = scenario({
      fen: '4k3/8/8/8/3p4/3K4/8/8 w - - 0 1',
      black: { abilities: VEILED_PM },
      moves: ['d3d4'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'royal_immunity' }),
    ]);
    expect(pieceAt(r.state, 'd4')?.type).toBe('king');
    expect(abilityReveals(r.events, 'black')).toHaveLength(0);
    const white = projected(r.engine, r.state, r.events, 'white');
    expect(white.find((e) => e.k === 'EffectFizzled')).toMatchObject({
      ability: null,
      reason: 'royal_immunity',
    });
    expect(JSON.stringify(white)).not.toContain('"poisoned_meat"');
  });

  it('R-ABIL-005 DD-28 veil: an explicit REVEAL effect (Scout) still names veiled abilities', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['scout'] },
      black: { abilities: VEILED_PM },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'set', pieceType: 'pawn', abilities: VEILED_PM },
        cause: 'effect',
      }),
    );
    expect(r.state.reveals.black.abilities.pawn).toEqual(expect.arrayContaining(VEILED_PM));
    expect(r.state.reveals.black.complete).toContain('pawn');
    const white = projected(r.engine, r.state, r.events, 'white');
    const triggered = white.filter((e) => e.k === 'AbilityTriggered');
    expect(triggered).toContainEqual(
      expect.objectContaining({ side: 'black', ability: 'poisoned_meat' }),
    );
  });

  it('R-ABIL-005 DD-28 veil: an explicit REVEAL effect (Last Word) names the veiled captor’s abilities', () => {
    // A veiled Hit and Run knight takes a Last Word pawn: Last Word resolves first (5.3) and
    // reveals the knight's whole set, so the knight's activation is named afterwards.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['hit_and_run', 'veil'] },
      black: { abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(r.state.reveals.white.abilities.knight).toEqual(
      expect.arrayContaining(['hit_and_run', 'veil']),
    );
    const black = projected(r.engine, r.state, r.events, 'black');
    expect(black.filter((e) => e.k === 'AbilityTriggered')).toContainEqual(
      expect.objectContaining({ side: 'white', ability: 'hit_and_run' }),
    );
  });

  it("R-ABIL-005 DD-28 R-INFO-005 veil hides the acting side's own activations and effect sources from the opponent", () => {
    // A veiled Cleave knight takes d5 and cuts the pawn c6.
    const r = scenario({
      fen: '4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['cleave', 'veil'] },
      moves: ['c3d5'],
    });
    expect(pieceAt(r.state, 'c6')).toBeUndefined();
    expect(abilityReveals(r.events, 'white')).toHaveLength(0);
    expect(r.state.reveals.white.veiled).toEqual(['knight']);
    const black = projected(r.engine, r.state, r.events, 'black');
    expect(black.find((e) => e.k === 'AbilityTriggered')).toMatchObject({
      side: 'white',
      ability: null,
    });
    expect(black.find((e) => e.k === 'Captured' && e.by === 'effect')).toMatchObject({
      square: sq('c6'),
      source: { kind: 'hidden' },
    });
    expect(JSON.stringify(black)).not.toContain('"cleave"');
  });

  it('R-ABIL-005 DD-28 R-INFO-005 veil: charges spent by a veiled consumable are hidden from the opponent', () => {
    const bonus: ChoiceOption = { kind: 'move', from: sq('d5'), to: sq('e3') };
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['momentum', 'veil'] },
      moves: ['c3d5'],
      answers: [bonus],
    });
    const knight = idAt(r.initial, 'c3');
    expect(pieceAt(r.state, 'e3')?.id).toBe(knight);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'momentum', remaining: 1 }),
    ]);
    const black = projected(r.engine, r.state, r.events, 'black');
    expect(black.find((e) => e.k === 'ChargeSpent')).toMatchObject({
      ability: null,
      remaining: -1,
    });
    expect(black.find((e) => e.k === 'MoveMade' && e.bonus)).toMatchObject({
      from: sq('d5'),
      to: sq('e3'),
    });
    expect(r.engine.project(r.state, 'black').usage[`${knight}:momentum`]).toBeUndefined();
    expect(JSON.stringify(black)).not.toContain('"momentum"');
  });

  it('R-ABIL-005 DD-28 veil only affects pieces that carry it (per-type sets)', () => {
    // Black pawns carry [Poisoned Meat, Veil]; black knights carry [Poisoned Meat] only.
    // 1. Ne3xf5 (veiled pawn) Ke8-f8 2. Nc3xd5 (unveiled knight), projected move by move.
    const { engine, state: s0 } = setup({
      fen: '4k3/8/8/3n1p2/8/2N1N3/8/4K3 w - - 0 1',
      black: { sets: [VEILED_PM, ['poisoned_meat'], [], [], [], []] },
    });
    const a = play(engine, s0, 'e3f5');
    const pawnView = projected(engine, a.state, a.step.events, 'white');
    expect(pawnView.find((e) => e.k === 'AbilityTriggered')).toMatchObject({ ability: null });
    expect(a.state.reveals.black.veiled).toEqual(['pawn']);

    const b = play(engine, a.state, 'e8f8');
    const c = play(engine, b.state, 'c3d5');
    const knightView = projected(engine, c.state, c.step.events, 'white');
    expect(knightView.find((e) => e.k === 'AbilityTriggered')).toMatchObject({
      pieceType: 'knight',
      ability: 'poisoned_meat',
    });
    expect(c.state.reveals.black.abilities.knight).toContain('poisoned_meat');
    expect(c.state.reveals.black.abilities.pawn ?? []).not.toContain('poisoned_meat');
    expect(c.state.reveals.black.veiled).toEqual(['pawn']);
  });

  it("R-ABIL-005 R-INFO-002 DD-28 veil: a veiled piece's activation stays unnamed even after the same ability was revealed on an unveiled piece type", () => {
    // 1. Nc3xd5 (unveiled knight: Poisoned Meat revealed on knights) Ke8-f8 2. Ne3xf5 (veiled
    // pawn). The pawn's activation must not be named: nothing explicitly revealed the pawn set.
    const r = scenario({
      fen: '4k3/8/8/3n1p2/8/2N1N3/8/4K3 w - - 0 1',
      black: { sets: [VEILED_PM, ['poisoned_meat'], [], [], [], []] },
      moves: ['c3d5', 'e8f8', 'e3f5'],
    });
    expect(r.state.reveals.black.abilities.knight).toContain('poisoned_meat');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ pieceType: 'pawn', ability: 'poisoned_meat' }),
    ]);
    expect(r.state.reveals.black.abilities.pawn ?? []).not.toContain('poisoned_meat');
    const white = projected(r.engine, r.state, last, 'white');
    expect(white.find((e) => e.k === 'AbilityTriggered')).toMatchObject({
      pieceType: 'pawn',
      ability: null,
    });
    expect(white.find((e) => e.k === 'Captured' && e.by === 'effect')).toMatchObject({
      source: { kind: 'hidden' },
    });
  });
});
