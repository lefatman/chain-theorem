/**
 * Settling an item wager (M6 6.1; spec 9.5 R-FMT-006, R-SEC-004). When the wager's battle ends the
 * BattleRoom's `settleBattle` calls `settleWager`: the winner receives both stakes in one atomic list
 * (abandonment is a loss: the battle core already scored it), a draw returns them, and the database
 * makes a repeat a no-op (`wagers.settle`, CHECK (releases <= 1)). The TradeSession that created the
 * battle keeps a slow alarm until the escrow is settled and, should the room's settlement have failed,
 * settles it from the finished `battles` row (`settleFromRecord`), so stakes are never stranded.
 * Both players are told through their zone channel (`wagerEnd`) and their saved loadouts are
 * re-checked (10.4).
 */
import type { Db, SettleInput, SettleResult } from '@chain-theorem/db';
import type { Side } from '@chain-theorem/rules';
import type { BattleArchive, BattleSummary } from '../battle/index.ts';
import type { Env } from '../env.ts';
import { revalidateLoadouts } from '../trade/loadouts.ts';
import { callPlayer } from './routing.ts';

const playerOf = (seat: BattleArchive['seats'][Side]): string | null =>
  'playerId' in seat ? seat.playerId : null;

/** Settle the escrow once, then tell both players and re-check their loadouts. */
async function settleAndTell(
  env: Env,
  db: Db,
  wagerId: string,
  input: SettleInput,
  now: number,
): Promise<SettleResult> {
  const r = await db.wagers.settle(wagerId, input);
  if (r.status !== 'settled' && r.status !== 'returned') return r;
  const e = r.escrow;
  for (const side of ['a', 'b'] as const) {
    const playerId = side === 'a' ? e.aId : e.bId;
    if (!playerId) continue;
    const got = r.paid.find((p) => p.playerId === playerId)?.bundle ?? { items: [], cards: [] };
    const result =
      e.outcome === 'aborted'
        ? 'returned'
        : e.outcome === 'draw'
          ? 'draw'
          : e.outcome === side
            ? 'won'
            : 'lost';
    try {
      const invalid = await revalidateLoadouts(db, playerId, now);
      await callPlayer(env, db, playerId, 'notify', {
        id: playerId,
        msg: {
          t: 'wagerEnd',
          d: {
            id: e.id,
            result,
            items: got.items.map((i) => ({ id: i.itemId, qty: i.qty })),
            cards: got.cards.map((c) => ({ id: c.abilityId, qty: c.qty })),
            invalid: invalid.slice(0, 5),
          },
        },
      });
    } catch (err) {
      // The stakes moved; only the notice failed (the player sees the inventory anyway).
      console.error(`wager ${e.id}: notifying ${playerId} failed: ${String(err)}`);
    }
  }
  return r;
}

/**
 * Who takes the stakes: the winning seat's player, or null for a draw. The battle core scores
 * resignation, flag fall and abandonment (a seat that never came back within the grace) as a loss
 * for that side, so abandonment is a loss here too (9.5).
 */
export function wagerSettlement(
  summary: Pick<BattleSummary, 'result'>,
  archive: Pick<BattleArchive, 'seats'>,
): Pick<SettleInput, 'winnerId' | 'seats'> {
  const whiteId = playerOf(archive.seats.white);
  const blackId = playerOf(archive.seats.black);
  const w = summary.result.winner;
  return {
    winnerId: w === null ? null : w === 'white' ? whiteId : blackId,
    seats: { whiteId, blackId },
  };
}

/** The battle of wager `wagerId` ended (called from `settleBattle`). */
export async function settleWager(
  env: Env,
  db: Db,
  wagerId: string,
  summary: BattleSummary,
  archive: BattleArchive,
  now: number,
): Promise<SettleResult> {
  return settleAndTell(env, db, wagerId, { ...wagerSettlement(summary, archive), at: now }, now);
}

/**
 * The TradeSession's safety net: settle from the `battles` row once the battle has a result. Resolves
 * to true when the escrow is settled (by this call or earlier), false while the battle still runs.
 */
export async function settleFromRecord(
  env: Env,
  db: Db,
  wagerId: string,
  now: number,
): Promise<boolean> {
  const e = await db.wagers.getEscrow(wagerId);
  if (!e) return true;
  if (e.status !== 'escrowed') return true;
  const b = await db.battles.get(e.battleId);
  if (!b) {
    // The battle never started: return the stakes.
    await settleAndTell(env, db, wagerId, { winnerId: null, aborted: true, at: now }, now);
    return true;
  }
  if (b.result === null) return false;
  const seats = { whiteId: b.whiteId, blackId: b.blackId };
  // A winner whose account was deleted since has a null seat: name nobody, which `settle` maps to
  // the escrow side whose player is gone (their share goes with the account, R-SEC-010).
  const winner = (id: string | null) => id ?? '';
  const input: SettleInput =
    b.result === 'aborted'
      ? { winnerId: null, aborted: true, at: now }
      : {
          winnerId:
            b.result === 'draw' ? null : winner(b.result === 'white' ? b.whiteId : b.blackId),
          seats,
          at: now,
        };
  const r = await settleAndTell(env, db, wagerId, input, now);
  return r.status !== 'not_found';
}
