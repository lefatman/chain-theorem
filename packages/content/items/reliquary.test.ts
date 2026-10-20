/**
 * Reliquary scenario tests (R-LOAD-002, spec 7.2; plan item C7, DD-127): 1 slot, min level 12. The
 * first piece the owner loses returns to its starting square at the end of the opponent's next turn,
 * if that square is empty; one payout, spent whether it returns or fizzles, armed while the piece is
 * back by other means. The return is the hook-level revive (`ctx.revive`) through the revive
 * intercepts: INV-03 for the acting player's king, Warden's Stopwatch (reason `negated`), occupancy.
 *
 * A burning start square (Hot Foot) would fizzle `burning` through the same intercept, but no
 * sequence reaches it for a first loss: the Ember capture that ignites the start square is itself
 * the first loss, and the payout resolves at the end of that same turn, while the captor still stands
 * there (`occupied`). Expected behaviour comes from spec 5.4, 7.2, 8.2, D-39 and DD-127, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type GameState,
  type Loadout,
  type Side,
  squareName,
  uciToMove,
} from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import type { ReliquaryState } from './reliquary.ts';
import { eventsOf, idAt, scenario, setup } from '../src/testing.ts';

const ID = 'reliquary';
const slice = (state: GameState): ReliquaryState => state.slices[ID] as ReliquaryState;
const revived = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'PieceRevived').map(
    (e) =>
      `${e.piece}@${squareName(e.square)}:${e.source.kind}:${(e.source as { id?: string }).id}`,
  );
const fizzled = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'EffectFizzled').map((e) => ({
    item: e.item,
    reason: e.reason,
    target: e.target,
    source: e.source,
  }));
const itemReveals = (events: readonly BattleEvent[], side: Side, item = ID) =>
  eventsOf(events, 'Revealed').filter(
    (e) => e.side === side && e.info.kind === 'item' && e.info.item === item,
  );

/** White knight c3 goes to d5 and the black rook d8 takes it. Ids: K=0 N=1 r=2 k=3. */
const KNIGHT_TAKEN = '3rk3/8/8/8/8/2N5/8/4K3 w - - 0 1';
const KNIGHT_TAKEN_MOVES = ['c3d5', 'd8d5'];

describe('reliquary (R-LOAD-002, DD-127)', () => {
  it('R-LOAD-002 Reliquary costs 1 slot at min level 12 and declares its slice', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(12);
    expect(def?.capacity).toBeUndefined();
    expect(def?.hooks.stateSlice?.id).toBe(ID);
    expect(def?.hooks.onTurnEnd).toBeTypeOf('function');
    expect(def?.hooks.onEvent).toBeTypeOf('function');
  });

  it('R-LOAD-002 R-LOAD-004 the Reliquary validates at level 12 and is rejected at level 11 (rule 2)', () => {
    const l: Loadout = { elements: ['tide'], items: [ID], sets: [['scout']] };
    expect(engine.validateLoadout(l, { level: 12 }).errors).toEqual([]);
    const v = engine.validateLoadout(l, { level: 11 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it("R-INFO-002 DD-127 the first lost piece returns to its start at the end of the opponent's turn, before the turn passes; the Reliquary is revealed and spent", () => {
    const r = scenario({
      fen: KNIGHT_TAKEN,
      white: { items: [ID] },
      moves: KNIGHT_TAKEN_MOVES,
    });
    const step = r.steps[1]?.events ?? [];
    expect(eventsOf(step, 'Captured').map((e) => [e.victim, e.by])).toEqual([[1, 'move']]);
    expect(revived(step)).toEqual(['1@c3:item:reliquary']);
    const iRevived = step.findIndex((e) => e.k === 'PieceRevived');
    const iPassed = step.findIndex((e) => e.k === 'TurnPassed');
    expect(iRevived).toBeGreaterThan(-1);
    expect(iRevived).toBeLessThan(iPassed);
    expect(idAt(r.state, 'c3')).toBe(1);
    expect(itemReveals(step, 'white')).toHaveLength(1);
    expect(r.state.reveals.white.items).toContain(ID);
    expect(slice(r.state)).toEqual({
      lost: { white: 1, black: null },
      used: { white: true, black: false },
    });
  });

  it("DD-127 a piece lost during the owner's own turn (Poisoned Meat) returns at the end of the opponent's following turn", () => {
    // Ids: K=0 N=1 p=2 k=3. The knight takes the Poisoned Meat pawn and dies on White's turn.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8'],
    });
    expect(revived(r.steps[0]?.events ?? [])).toEqual([]);
    expect(slice(r.steps[0] ? r.state : r.state).lost.white).toBe(1);
    expect(revived(r.steps[1]?.events ?? [])).toEqual(['1@c3:item:reliquary']);
    expect(idAt(r.state, 'c3')).toBe(1);
  });

  it('DD-127 R-SEC-001 an occupied start square spends the payout: the fizzle names the item and the reason, is hidden from the opponent, and nothing is retried later', () => {
    // The knight dies on d5 (Poisoned Meat); the black rook then sits on c3. Ids: K=0 N=1 p=2 r=3 k=4.
    const r = scenario({
      fen: '2r1k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'c8c3', 'e1d1', 'e8d8'],
    });
    const step = r.steps[1]?.events ?? [];
    expect(fizzled(step)).toEqual([{ item: ID, reason: 'occupied', target: 1, source: undefined }]);
    expect(slice(r.state).used.white).toBe(true);
    expect(revived(r.events)).toEqual([]);
    expect(r.state.pieces[1]?.square).toBe(-1);
    // The owner sees its item's fizzle; the opponent, who does not know the item, does not.
    expect(engine.projectEvents(r.state, step, 'white').some((e) => e.k === 'EffectFizzled')).toBe(
      true,
    );
    expect(engine.projectEvents(r.state, step, 'black').some((e) => e.k === 'EffectFizzled')).toBe(
      false,
    );
    expect(r.state.reveals.white.items).not.toContain(ID);
  });

  it('DD-127 only the first loss is covered: a second piece lost later stays off the board', () => {
    // Knight c3 (returns), then the bishop c1 takes the Poisoned Meat pawn g5 and dies. Ids: B=0 K=1 N=2 p=3 r=4 k=5.
    const r = scenario({
      fen: '3rk3/8/8/6p1/8/2N5/8/2B1K3 w - - 0 1',
      white: { items: [ID] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'd8d5', 'c1g5', 'e8f8'],
    });
    expect(revived(r.events)).toEqual(['2@c3:item:reliquary']);
    expect(r.state.pieces[0]?.square).toBe(-1);
    expect(slice(r.state).used.white).toBe(true);
    expect(fizzled(r.events)).toEqual([]);
  });

  it('DD-127 Rebirth interplay: a first loss that returns by its own Rebirth leaves the payout armed for that piece, which the Reliquary returns when it is lost again', () => {
    // White knight c3 (Rebirth). The queen takes it (Rebirth brings it back), it takes the queen,
    // the rook h5 takes it again (Rebirth spent) and the Reliquary returns it. Ids: K=0 N=1 r=2 q=3 k=4.
    const r = scenario({
      fen: '3qk3/8/8/7r/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID], abilities: ['rebirth'] },
      moves: ['c3d5', 'd8d5', 'c3d5', 'h5d5'],
    });
    expect(revived(r.steps[1]?.events ?? [])).toEqual(['1@c3:ability:rebirth']);
    expect(itemReveals(r.steps[1]?.events ?? [], 'white')).toHaveLength(0);
    expect(revived(r.steps[3]?.events ?? [])).toEqual(['1@c3:item:reliquary']);
    expect(itemReveals(r.steps[3]?.events ?? [], 'white')).toHaveLength(1);
    expect(slice(r.state).used.white).toBe(true);
    expect(idAt(r.state, 'c3')).toBe(1);
  });

  it("INV-03 DD-127 a return that would check the acting player's king fizzles inv03 and spends the payout", () => {
    // Knight g1-f3 checks the king h4, which steps to h3; the rook f8 takes f3; the knight's return to
    // g1 would attack h3, Black's own king at the end of Black's turn. Ids: K=0 N=1 k=2 r=3.
    const r = scenario({
      fen: '5r2/8/8/8/7k/8/8/4K1N1 w - - 0 1',
      white: { items: [ID] },
      moves: ['g1f3', 'h4h3', 'e1d1', 'f8f3'],
    });
    const step = r.steps[3]?.events ?? [];
    expect(fizzled(step).map((f) => [f.item, f.reason, f.target])).toEqual([[ID, 'inv03', 1]]);
    expect(revived(r.events)).toEqual([]);
    expect(slice(r.state).used.white).toBe(true);
    expect(r.state.pieces[1]?.square).toBe(-1);
  });

  it('DD-127 throwaway drafts change nothing: legal-move generation after a loss leaves the slice as it is and the payout happens once, at the real turn end', () => {
    const s = setup({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID] },
      black: { abilities: ['poisoned_meat'] },
    });
    let r = engine.applyAction(s.state, { kind: 'move', side: 'white', move: uciToMove('c3d5') });
    expect(r.kind).toBe('done');
    const after = r.state;
    expect(slice(after)).toEqual({
      lost: { white: 1, black: null },
      used: { white: false, black: false },
    });
    const before = JSON.stringify(slice(after));
    engine.legalMoves(after, 'black');
    engine.legalMoves(after, 'black');
    engine.legalMoves(after, 'white');
    expect(JSON.stringify(slice(after))).toBe(before);
    expect(after.pieces[1]?.square).toBe(-1);
    r = engine.applyAction(after, { kind: 'move', side: 'black', move: uciToMove('e8d8') });
    expect(revived(r.events)).toEqual(['1@c3:item:reliquary']);
    expect(slice(r.state).used.white).toBe(true);
  });

  it('R-INFO-002 R-SEC-001 after the payout both players see the return with its source, since the item is revealed by it', () => {
    const r = scenario({ fen: KNIGHT_TAKEN, white: { items: [ID] }, moves: KNIGHT_TAKEN_MOVES });
    const step = r.steps[1]?.events ?? [];
    for (const viewer of ['white', 'black'] as const) {
      const seen = engine
        .projectEvents(r.state, step, viewer)
        .filter((e) => e.k === 'PieceRevived');
      expect(seen).toHaveLength(1);
      expect(seen[0] && 'source' in seen[0] ? seen[0].source : null).toEqual({
        kind: 'item',
        id: ID,
        side: 'white',
      });
    }
  });
});

describe("Warden's Stopwatch v2 stops an item's revive (D-39, DD-127)", () => {
  it.each([
    ['the opponent', 'black'],
    ['the owner', 'white'],
  ] as const)(
    "D-39 DD-127 a Stopwatch held by %s negates the Reliquary's return: fizzle negated, the Stopwatch revealed, the payout spent",
    (_who, holder) => {
      const r = scenario({
        fen: KNIGHT_TAKEN,
        white: { items: holder === 'white' ? [ID, 'wardens_stopwatch'] : [ID] },
        black: { items: holder === 'black' ? ['wardens_stopwatch'] : [] },
        moves: KNIGHT_TAKEN_MOVES,
      });
      const step = r.steps[1]?.events ?? [];
      expect(fizzled(step)).toEqual([
        {
          item: ID,
          reason: 'negated',
          target: 1,
          source: { kind: 'item', id: 'wardens_stopwatch', side: holder },
        },
      ]);
      expect(revived(r.events)).toEqual([]);
      expect(r.state.pieces[1]?.square).toBe(-1);
      expect(slice(r.state).used.white).toBe(true);
      expect(r.state.reveals[holder].items).toContain('wardens_stopwatch');
    },
  );
});
