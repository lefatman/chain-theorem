/**
 * Warden's Stopwatch scenario tests (R-LOAD-002, D-39, spec 7.2): 1 slot, min level 18. Negates
 * every replay and revive ability (Momentum, Riposte, Reinforce, Rebirth) for both players for the
 * whole battle, and is revealed when its effect is observable (8.2).
 *
 * Expected behaviour comes from spec 5.2 (NEGATE), 5.7, 7.2, 8.2 and DD-02, DD-17, DD-18, not
 * from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, Loadout } from '@chain-theorem/rules';
import { abilityById, engine, itemById } from '../index.ts';
import { eventsOf, idAt, pieceAt, scenario } from '../src/testing.ts';

const ID = 'wardens_stopwatch';
const itemSource = (side: 'white' | 'black') => ({ kind: 'item', id: ID, side });

function itemReveals(events: readonly BattleEvent[], side: 'white' | 'black') {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === ID,
  );
}

// Knight c3 takes d5; the black pawn d5 sits in front of an empty board so Momentum has moves.
const KNIGHT_FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
// E6 shape: bishop b5 takes the knight c6; the black pawn d7 could recapture on c6 (Riposte).
const RIPOSTE_FEN = '7k/3p4/2n5/1B6/8/8/8/4K3 w - - 0 1';
// White b2-b3, black Ba4xb3, white Ne4xf6 (a non-pawn victim): Reinforce revives the pawn on b2.
const REINFORCE_FEN = '7k/8/5n2/8/b3N3/8/1P6/7K w - - 0 1';
// Black Nb8-c6, white Bb5xc6: Rebirth returns the knight to its starting square b8.
const REBIRTH_FEN = '1n5k/8/8/1B6/8/8/8/4K3 b - - 0 1';

describe("warden's stopwatch (R-LOAD-002)", () => {
  it("R-LOAD-002 D-39 Warden's Stopwatch costs 1 slot at min level 18", () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(18);
    expect(def?.capacity).toBeUndefined();
  });

  it('R-LOAD-002 DD-02 Momentum and Riposte carry the replay tag; Reinforce and Rebirth carry the revive tag', () => {
    expect(abilityById.get('momentum')?.tags).toContain('replay');
    expect(abilityById.get('riposte')?.tags).toContain('replay');
    expect(abilityById.get('reinforce')?.tags).toContain('revive');
    expect(abilityById.get('rebirth')?.tags).toContain('revive');
  });

  it('R-LOAD-002 R-LOAD-004 the Stopwatch validates at level 18 and is rejected at level 17 (rule 2)', () => {
    const l: Loadout = { elements: ['grove'], items: [ID], sets: [['scout']] };
    expect(engine.validateLoadout(l, { level: 18 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 17 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 D-39 control: without the Stopwatch Momentum offers a bonus move', () => {
    const r = scenario({ fen: KNIGHT_FEN, white: { abilities: ['momentum'] }, moves: ['c3d5'] });
    expect(r.prompts).toHaveLength(1);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['momentum']);
  });

  it("R-LOAD-002 D-39 R-INFO-002 the Stopwatch negates the opponent's Momentum and is revealed when it does", () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { abilities: ['momentum'] },
      black: { items: [ID] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'white',
        piece: knight,
        ability: 'momentum',
        category: 'CAPTURES',
        source: itemSource('black'),
      }),
    ]);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    // DD-17: a negated activation spends no charge.
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(2);
    // 8.2: the item is revealed because its effect was observable.
    expect(itemReveals(r.events, 'black')).toHaveLength(1);
    expect(r.state.reveals.black.items).toEqual([ID]);
    expect(r.engine.project(r.state, 'white').armies.black.revealed.items).toEqual([ID]);
  });

  it("R-LOAD-002 D-39 the Stopwatch also negates its owner's own replay ability (both players)", () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { items: [ID], abilities: ['momentum'] },
      black: {},
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => [e.side, e.ability, e.source])).toEqual([
      ['white', 'momentum', itemSource('white')],
    ]);
    expect(itemReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 D-39 control: without the Stopwatch Riposte prompts the victim’s owner', () => {
    const r = scenario({ fen: RIPOSTE_FEN, black: { abilities: ['riposte'] }, moves: ['b5c6'] });
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.chooser).toBe('black');
  });

  it('R-LOAD-002 D-39 the Stopwatch negates Riposte (replay): no prompt, no recapture', () => {
    const r = scenario({
      fen: RIPOSTE_FEN,
      white: { items: [ID] },
      black: { abilities: ['riposte'] },
      moves: ['b5c6'],
    });
    const bishop = idAt(r.initial, 'b5');
    const knight = idAt(r.initial, 'c6');
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'black',
        piece: knight,
        ability: 'riposte',
        category: 'CAPTURED',
        source: itemSource('white'),
      }),
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => e.victim)).toEqual([knight]);
    expect(pieceAt(r.state, 'c6')?.id).toBe(bishop);
    expect(itemReveals(r.events, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 D-39 control: without the Stopwatch Reinforce revives the pawn', () => {
    const r = scenario({
      fen: REINFORCE_FEN,
      white: { abilities: ['reinforce'] },
      moves: ['b2b3', 'a4b3', 'e4f6'],
    });
    const pawn = idAt(r.initial, 'b2');
    expect(pieceAt(r.state, 'b2')?.id).toBe(pawn);
  });

  it('R-LOAD-002 D-39 the Stopwatch negates Reinforce (revive): the captured pawn stays off the board', () => {
    const r = scenario({
      fen: REINFORCE_FEN,
      white: { abilities: ['reinforce'] },
      black: { items: [ID] },
      moves: ['b2b3', 'a4b3', 'e4f6'],
    });
    const pawn = idAt(r.initial, 'b2');
    const knight = idAt(r.initial, 'e4');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'white',
        piece: knight,
        ability: 'reinforce',
        source: itemSource('black'),
      }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toEqual([]);
    expect(eventsOf(last, 'ChargeSpent')).toEqual([]);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(pieceAt(r.state, 'b2')).toBeUndefined();
    expect(itemReveals(last, 'black')).toHaveLength(1);
  });

  it('R-LOAD-002 D-39 control: without the Stopwatch Rebirth returns the knight at chain end', () => {
    const r = scenario({
      fen: REBIRTH_FEN,
      black: { abilities: ['rebirth'] },
      moves: ['b8c6', 'b5c6'],
    });
    const knight = idAt(r.initial, 'b8');
    expect(pieceAt(r.state, 'b8')?.id).toBe(knight);
  });

  it('R-LOAD-002 D-39 the Stopwatch negates Rebirth (revive): the knight does not return', () => {
    const r = scenario({
      fen: REBIRTH_FEN,
      white: { items: [ID] },
      black: { abilities: ['rebirth'] },
      moves: ['b8c6', 'b5c6'],
    });
    const knight = idAt(r.initial, 'b8');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'black',
        piece: knight,
        ability: 'rebirth',
        source: itemSource('white'),
      }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toEqual([]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'b8')).toBeUndefined();
    expect(itemReveals(last, 'white')).toHaveLength(1);
  });

  it('R-LOAD-002 D-39 R-INFO-002 abilities without the replay or revive tag are untouched and the Stopwatch stays hidden', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { abilities: ['hit_and_run'] },
      black: { items: [ID], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'last_word',
      'hit_and_run',
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(r.state.reveals.black.items).toEqual([]);
    expect(JSON.stringify(r.engine.project(r.state, 'white'))).not.toContain(ID);
    expect(JSON.stringify(r.engine.projectEvents(r.state, r.events, 'white'))).not.toContain(ID);
  });

  it('R-LOAD-002 D-39 R-INFO-005 once revealed, the opponent’s projected negation names the Stopwatch as its source', () => {
    const r = scenario({
      fen: KNIGHT_FEN,
      white: { abilities: ['momentum'] },
      black: { items: [ID] },
      moves: ['c3d5'],
    });
    const seen = eventsOf(r.engine.projectEvents(r.state, r.events, 'white'), 'AbilityNegated');
    expect(seen.map((e) => [e.ability, e.source])).toEqual([['momentum', itemSource('black')]]);
  });

  it('R-LOAD-002 D-39 the Stopwatch keeps negating for the whole battle and is revealed only once', () => {
    // Knight c3 takes d5 (Momentum negated), black king moves, knight d5 takes f6 (negated again).
    const r = scenario({
      fen: 'k7/8/5p2/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['momentum'] },
      black: { items: [ID] },
      moves: ['c3d5', 'a8b8', 'd5f6'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual([
      'momentum',
      'momentum',
    ]);
    expect(itemReveals(r.events, 'black')).toHaveLength(1);
    expect(pieceAt(r.state, 'f6')?.type).toBe('knight');
  });
});
