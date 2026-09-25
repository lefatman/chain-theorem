/**
 * Attunement Charm scenario tests (R-LOAD-002, spec 7.2, 6.3): 1 slot, min level 4, one module with
 * an element parameter chosen in the loadout (DD-29). Abilities of the chosen affinity count as
 * Attuned on all of the owner's pieces, so they run their attuned version on off-element pieces;
 * the Charm is revealed when that happens (8.2: an item is revealed when its effect is observable).
 *
 * Expected behaviour comes from spec 5.7, 6.3, 7.2, 8.2 and DD-13, DD-17, DD-20, DD-29, not from
 * the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, ElementId, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { type ArmySpec, eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const ID = 'attunement_charm';
const sq = parseSquare;

function charmed(element: ElementId, charm: ElementId, abilities: string[]): ArmySpec {
  return { elements: [element], items: [ID], itemParams: { [ID]: { element: charm } }, abilities };
}

function charmReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );
}

// Knight c3 takes d5; a second black pawn e6 is diagonally adjacent to d5.
const KNIGHT_FEN = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';

describe('attunement charm (R-LOAD-002)', () => {
  it('R-LOAD-002 DD-13 DD-29 Attunement Charm costs 1 slot at min level 4 and needs an element parameter', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(4);
    expect(def?.param).toEqual({ element: 'required' });
  });

  it('R-LOAD-002 R-LOAD-004 DD-29 the Charm validates at level 4 with an enabled element; no element, a disabled element or level 3 are rejected', () => {
    const base: Loadout = { elements: ['grove'], items: [ID], sets: [['hit_and_run']] };
    const ok: Loadout = { ...base, itemParams: { [ID]: { element: 'tide' } } };
    expect(engine.validateLoadout(ok, { level: 4 }).errors).toEqual([]);
    expect(engine.validateLoadout(base, { level: 4 }).errors).toContainEqual(
      expect.objectContaining({ code: 'item_param', ref: ID }),
    );
    const storm: Loadout = { ...base, itemParams: { [ID]: { element: 'storm' } } };
    expect(engine.validateLoadout(storm, { level: 4 }).errors).toContainEqual(
      expect.objectContaining({ code: 'item_param', ref: ID }),
    );
    expect(engine.validateLoadout(ok, { level: 3 }).errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-LOAD-004 DD-29 one Charm module covers every element but cannot be equipped twice', () => {
    for (const element of ['ember', 'tide', 'grove'] as const) {
      const l: Loadout = {
        elements: ['grove'],
        items: [ID],
        itemParams: { [ID]: { element } },
        sets: [['scout']],
      };
      expect(engine.validateLoadout(l, { level: 4 }).errors, element).toEqual([]);
    }
    const twice: Loadout = {
      elements: ['grove'],
      items: [ID, ID],
      itemParams: { [ID]: { element: 'tide' } },
      sets: [['scout']],
    };
    expect(engine.validateLoadout(twice, { level: 10 }).errors).toContainEqual(
      expect.objectContaining({ rule: 3, code: 'duplicate_item' }),
    );
  });

  it('R-LOAD-002 R-ELEM-003 control: without the Charm, Hit and Run on a Grove knight is not attuned and simply returns', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { elements: ['grove'], abilities: ['hit_and_run'] },
      black: {},
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.attuned)).toEqual([false]);
    expect(r.prompts).toEqual([]);
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
  });

  it('R-LOAD-002 R-ELEM-003 DD-20 a Tide Charm runs attuned Hit and Run on an off-element Grove knight and reveals the Charm', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: charmed('grove', 'tide', ['hit_and_run']),
      black: {},
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('d4') }],
    });
    const knight = idAt(r.initial, 'c3');
    expect(
      eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability, e.attuned]),
    ).toEqual([[knight, 'hit_and_run', true]]);
    // Attuned: the origin square c3 or any empty square adjacent to it (DD-20).
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('white');
    expect(req?.kind).toBe('square');
    const offered = (req?.options ?? []).map((o) => (o.kind === 'square' ? o.square : -1));
    expect([...offered].sort((a, b) => a - b)).toEqual(
      ['b2', 'c2', 'd2', 'b3', 'c3', 'd3', 'b4', 'c4', 'd4'].map(sq).sort((a, b) => a - b),
    );
    expect(pieceAt(r.state, 'd4')?.id).toBe(knight);
    expect(charmReveals(r.events, 'white')).toHaveLength(1);
    expect(r.state.reveals.white.items).toEqual([ID]);
    expect(r.engine.project(r.state, 'black').armies.white.revealed.items).toEqual([ID]);
  });

  it('R-LOAD-002 R-ELEM-003 the Charm attunes only its chosen affinity: an Ember ability on the same Grove knight stays unattuned', () => {
    // Cleave (Ember) resolves in its base form; Hit and Run (Tide) is attuned by the Tide Charm.
    const r = scenario({
      fen: KNIGHT_FEN,
      white: charmed('grove', 'tide', ['cleave', 'hit_and_run']),
      black: {},
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('c3') }],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.ability, e.attuned])).toEqual([
      ['cleave', false],
      ['hit_and_run', true],
    ]);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
  });

  it('R-LOAD-002 R-INFO-002 an on-element bearer is attuned anyway, so the Charm has no observable effect and stays hidden', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: charmed('tide', 'tide', ['hit_and_run']),
      black: {},
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('c3') }],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.attuned)).toEqual([true]);
    expect(charmReveals(r.events, 'white')).toEqual([]);
    expect(r.state.reveals.white.items).toEqual([]);
  });

  it("R-LOAD-002 R-ELEM-003 the Charm attunes only its owner's pieces: the opponent's Tide ability stays unattuned", () => {
    // Black Grove knight c6 with Hit and Run takes the white pawn d4; White carries the Tide Charm.
    const r = scenario({
      fen: '4k3/8/2n5/8/3P4/8/8/4K3 b - - 0 1',
      white: charmed('grove', 'tide', []),
      black: { elements: ['grove'], abilities: ['hit_and_run'] },
      moves: ['c6d4'],
    });
    const knight = idAt(r.initial, 'c6');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.side, e.attuned])).toEqual([
      ['black', false],
    ]);
    expect(r.prompts).toEqual([]);
    expect(pieceAt(r.state, 'c6')?.id).toBe(knight);
    expect(charmReveals(r.events, 'white')).toEqual([]);
  });

  it('R-LOAD-002 R-ELEM-003 DD-17 a Grove Charm gives an Ember piece attuned Reinforce, which triggers on a pawn victim', () => {
    // 1. b2-b3 2. Ba4xb3 (the white pawn is captured) 3. Ne4xf6 takes a pawn: base Reinforce needs
    // a non-pawn victim, attuned Reinforce triggers on any victim and revives the pawn on b2.
    const fen = '7k/8/5p2/8/b3N3/8/1P6/7K w - - 0 1';
    const moves = ['b2b3', 'a4b3', 'e4f6'];
    const control = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['reinforce'] },
      moves,
    });
    expect(eventsOf(control.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(control.state, 'b2')).toBeUndefined();

    const r = scenario({ fen, white: charmed('ember', 'grove', ['reinforce']), moves });
    const pawn = idAt(r.initial, 'b2');
    const knight = idAt(r.initial, 'e4');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered').map((e) => [e.piece, e.ability, e.attuned])).toEqual([
      [knight, 'reinforce', true],
    ]);
    expect(eventsOf(last, 'PieceRevived').map((e) => [e.piece, e.square])).toEqual([
      [pawn, sq('b2')],
    ]);
    expect(eventsOf(last, 'ChargeSpent').map((e) => [e.ability, e.remaining])).toEqual([
      ['reinforce', 0],
    ]);
    expect(pieceAt(r.state, 'b2')?.id).toBe(pawn);
    expect(charmReveals(last, 'white')).toHaveLength(1);
  });
});
