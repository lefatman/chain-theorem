/**
 * Resonance Crystal scenario tests (R-LOAD-002, spec 7.2): 1 slot, min level 6. The first time one
 * of your pieces would be silenced this battle, it is not: none of that piece's triggers in that
 * capture are silenced, and the Crystal is revealed when it fires. A trigger that is negated
 * (Pierce, Stillness, Stopwatch) is never "silenced" and does not consume it (DD-30). Later
 * silences happen normally.
 *
 * Expected behaviour comes from spec 5.3, 6.2, 7.2, 8.2 and DD-30, DD-36, not from the engine's
 * current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const ID = 'resonance_crystal';
const sq = parseSquare;

function crystalReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );
}

describe('resonance crystal (R-LOAD-002)', () => {
  it('R-LOAD-002 Resonance Crystal costs 1 slot at min level 6', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(6);
    expect(def?.capacity).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-004 the Crystal validates at level 6 and is rejected at level 5 (rule 2)', () => {
    const l: Loadout = { elements: ['grove'], items: [ID], sets: [['scout']] };
    expect(engine.validateLoadout(l, { level: 6 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 5 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-ELEM-002 DD-30 the first silence of an own captor does not happen and the Crystal is revealed; a later silence happens normally', () => {
    // Grove knight vs Ember pawns: Ember beats Grove, so the knight's Hit and Run would be silenced.
    const r = scenario({
      fen: '7k/8/8/1p1p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['grove'], items: [ID], abilities: ['hit_and_run'] },
      black: { elements: ['ember'] },
      moves: ['c3d5', 'h8g8', 'c3b5'],
    });
    const knight = idAt(r.initial, 'c3');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(first, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [knight, 'hit_and_run'],
    ]);
    expect(eventsOf(first, 'PieceMoved').map((e) => [e.piece, e.to])).toEqual([[knight, sq('c3')]]);
    expect(crystalReveals(first, 'white')).toHaveLength(1);
    expect(r.state.reveals.white.items).toContain(ID);

    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'AbilitySilenced').map((e) => [e.piece, e.ability])).toEqual([
      [knight, 'hit_and_run'],
    ]);
    expect(eventsOf(third, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'b5')?.id).toBe(knight);
    expect(crystalReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-30 none of the piece’s triggers in that capture are silenced: its Capturing and Captures abilities both resolve', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['grove'], items: [ID], abilities: ['scout', 'hit_and_run'] },
      black: { elements: ['ember'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [knight, 'scout'],
      [knight, 'hit_and_run'],
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(crystalReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 DD-30 after the Crystal is spent, a later Capturing ability of the same piece is silenced normally', () => {
    // Grove knight with Scout: c3xd5 (spared by the Crystal), black waits, d5xf6 (silenced).
    const r = scenario({
      fen: 'k7/8/5p2/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['grove'], items: [ID], abilities: ['scout'] },
      black: { elements: ['ember'] },
      moves: ['c3d5', 'a8b8', 'd5f6'],
    });
    const knight = idAt(r.initial, 'c3');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilityTriggered').map((e) => e.ability)).toEqual(['scout']);
    expect(eventsOf(first, 'AbilitySilenced')).toEqual([]);
    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'AbilitySilenced').map((e) => [e.piece, e.ability])).toEqual([
      [knight, 'scout'],
    ]);
    expect(eventsOf(third, 'AbilityTriggered')).toEqual([]);
  });

  it('R-LOAD-002 R-ELEM-002 DD-30 the Crystal spares an own victim: Poisoned Meat resolves against an advantaged captor', () => {
    // Ember knight takes a Grove pawn: Ember beats Grove, so Poisoned Meat would be silenced.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['grove'], items: [ID], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toContainEqual([
      knight,
      'effect',
    ]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(crystalReveals(r.events, 'black')).toHaveLength(1);
    expect(r.engine.project(r.state, 'white').armies.black.revealed.items).toContain(ID);
  });

  it('R-LOAD-002 DD-30 DD-36 a trigger negated by Pierce is not silenced and does not consume the Crystal', () => {
    // 1. Ember knight (Pierce) takes a Grove pawn: its Poisoned Meat would be silenced, but Pierce
    //    negates it first. 2. The Grove pawn e6 takes the Ember knight: its Hit and Run would be
    //    silenced, and now the Crystal fires, so the pawn returns to e6.
    const r = scenario({
      fen: '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['pierce'] },
      black: { elements: ['grove'], items: [ID], abilities: ['poisoned_meat', 'hit_and_run'] },
      moves: ['c3d5', 'e6d5'],
    });
    const pawnE6 = idAt(r.initial, 'e6');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilityNegated').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(eventsOf(first, 'AbilitySilenced')).toEqual([]);
    expect(crystalReveals(first, 'black')).toEqual([]);

    const second = r.steps[1]?.events ?? [];
    expect(eventsOf(second, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(second, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [pawnE6, 'hit_and_run'],
    ]);
    expect(crystalReveals(second, 'black')).toHaveLength(1);
    expect(pieceAt(r.state, 'e6')?.id).toBe(pawnE6);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it("R-LOAD-002 DD-30 D-39 a trigger negated by Warden's Stopwatch does not consume the Crystal", () => {
    // 1. Ember knight takes a Grove pawn: Rebirth (revive) is negated by the Stopwatch, not
    //    silenced. 2. The Grove pawn e6 takes the knight: the Crystal spares its Hit and Run.
    const r = scenario({
      fen: '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'], items: ['wardens_stopwatch'] },
      black: { elements: ['grove'], items: [ID], abilities: ['rebirth', 'hit_and_run'] },
      moves: ['c3d5', 'e6d5'],
    });
    const pawnE6 = idAt(r.initial, 'e6');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilityNegated').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'rebirth'],
    ]);
    expect(eventsOf(first, 'AbilitySilenced')).toEqual([]);
    expect(crystalReveals(first, 'black')).toEqual([]);

    const second = r.steps[1]?.events ?? [];
    expect(eventsOf(second, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(second, 'AbilityTriggered').map((e) => [e.piece, e.ability])).toEqual([
      [pawnE6, 'hit_and_run'],
    ]);
    expect(crystalReveals(second, 'black')).toHaveLength(1);
    expect(pieceAt(r.state, 'e6')?.id).toBe(pawnE6);
  });

  it("R-LOAD-002 DD-30 the Crystal never spares the opponent's pieces, and their silence does not consume it", () => {
    // White: Blended Family, Ember knights/pawns/bishops and a Tide rook, Antidote army-wide.
    // 1. Ember knight takes a Grove pawn: Black's Poisoned Meat is silenced (the Crystal is White's).
    // 2. Black waits. 3. The Tide rook takes a Grove pawn: its Antidote would be silenced, and now
    //    the Crystal fires; Antidote then stops Poisoned Meat, so the rook survives.
    const r = scenario({
      fen: '7k/8/8/p2p4/8/2N5/8/R3K3 w - - 0 1',
      white: {
        elements: ['ember', 'tide'],
        items: ['blended_family', ID],
        abilities: ['antidote'],
      },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'h8g8', 'a1a5'],
    });
    const rook = idAt(r.initial, 'a1');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilitySilenced').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(crystalReveals(first, 'white')).toEqual([]);

    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(third, 'AbilityTriggered').map((e) => [e.side, e.ability])).toEqual([
      ['white', 'antidote'],
      ['black', 'poisoned_meat'],
    ]);
    expect(eventsOf(third, 'EffectFizzled').map((e) => [e.ability, e.reason, e.target])).toEqual([
      ['poisoned_meat', 'protected', rook],
    ]);
    expect(crystalReveals(third, 'white')).toHaveLength(1);
    expect(pieceAt(r.state, 'a5')?.id).toBe(rook);
  });
});
