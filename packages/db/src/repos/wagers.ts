/**
 * Item wagers (spec 9.5 R-FMT-006, 13.3; R-SEC-004).
 *
 * - `escrow()` runs when both players confirmed, right before the BattleRoom is created: ONE atomic
 *   list writes the `wager_escrows` row (UNIQUE id and battle), takes both stakes out of the
 *   players' inventories (CHECK (qty >= 0) aborts the list if either no longer owns a stake) and
 *   logs both players. The battle still uses each player's loadout snapshot, staked items included.
 * - `settle()` runs when the battle ends: ONE atomic list raises `releases` (CHECK (releases <= 1),
 *   so a second settlement aborts whole: exactly once, even racing itself), gives the winner both
 *   stakes (a draw, or a battle that never started, returns each stake to its owner), records the
 *   wager in `wagers` against its battle and logs both players.
 * - `create()`, `get()` and `getByBattle()` read and write the `wagers` record itself (M4).
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { DbConstraintError, isUniqueViolation } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { ItemBundle } from '../json.ts';
import type { WagerEscrowsTable, WagersTable } from '../schema.ts';
import { auditRepo } from './audit.ts';
import { inventoryRepo } from './inventory.ts';
import {
  isEmptyBundle,
  mergeBundles,
  moveStatements,
  normalizeBundle,
  withLockRetry,
} from './moves.ts';

export type WagerStatus = 'pending' | 'escrowed' | 'settled' | 'returned';

export interface Wager {
  id: string;
  battleId: string;
  whiteStake: ItemBundle;
  blackStake: ItemBundle;
  status: string;
  createdAt: number;
  settledAt: number | null;
}

export type EscrowStatus = 'escrowed' | 'settled' | 'returned';
/** Who got the stakes: side a or b (the winner), each their own back (draw), or back (aborted). */
export type EscrowOutcome = 'a' | 'b' | 'draw' | 'aborted';

/** The stakes held by the server for one wager battle. */
export interface WagerEscrow {
  id: string;
  battleId: string;
  format: string;
  /** Inviter and invitee; null after that account was deleted (R-SEC-010). */
  aId: string | null;
  bId: string | null;
  aStake: ItemBundle;
  bStake: ItemBundle;
  status: EscrowStatus;
  outcome: EscrowOutcome | null;
  createdAt: number;
  settledAt: number | null;
}

export interface EscrowInput {
  /** The wager id (the negotiating TradeSession's id). */
  id: string;
  /** The BattleRoom about to be created for this wager. */
  battleId: string;
  format: string;
  aId: string;
  bId: string;
  aStake: ItemBundle;
  bStake: ItemBundle;
  at?: number;
}

export type EscrowResult =
  | { status: 'escrowed'; escrow: WagerEscrow }
  /** A stake is no longer owned: nothing changed. */
  | { status: 'insufficient' }
  /** This wager (or its battle) was already escrowed: nothing changed. */
  | { status: 'duplicate' };

export interface SettleInput {
  /** The winning player (abandonment counts as a loss), or null for a draw. */
  winnerId: string | null;
  /** The battle never started: return both stakes (nothing is recorded in `wagers`). */
  aborted?: boolean;
  /** The battle's seats, to record the wager in `wagers` (the battle row exists by then). */
  seats?: { whiteId: string | null; blackId: string | null };
  at?: number;
}

export interface Payout {
  playerId: string;
  bundle: ItemBundle;
}

export type SettleResult =
  | { status: 'settled' | 'returned'; escrow: WagerEscrow; paid: Payout[] }
  /** Already settled (a retry, a replay, a race): nothing changed. */
  | { status: 'duplicate' }
  | { status: 'not_found' };

const ESCROW_STATUSES: readonly EscrowStatus[] = ['escrowed', 'settled', 'returned'];
const OUTCOMES: readonly EscrowOutcome[] = ['a', 'b', 'draw', 'aborted'];

export function toWager(ctx: Pick<RepoContext, 'json'>, row: Selectable<WagersTable>): Wager {
  return {
    id: row.id,
    battleId: row.battle_id,
    whiteStake: ctx.json.decode('wagers.white_stake_json', ItemBundle, row.white_stake_json),
    blackStake: ctx.json.decode('wagers.black_stake_json', ItemBundle, row.black_stake_json),
    status: row.status,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

export function toEscrow(
  ctx: Pick<RepoContext, 'json'>,
  row: Selectable<WagerEscrowsTable>,
): WagerEscrow {
  if (!(ESCROW_STATUSES as readonly string[]).includes(row.status))
    throw new Error(`unknown escrow status in database: ${row.status}`);
  if (row.outcome !== null && !(OUTCOMES as readonly string[]).includes(row.outcome))
    throw new Error(`unknown escrow outcome in database: ${row.outcome}`);
  return {
    id: row.id,
    battleId: row.battle_id,
    format: row.format,
    aId: row.a_id,
    bId: row.b_id,
    aStake: ctx.json.decode('wager_escrows.a_stake_json', ItemBundle, row.a_stake_json),
    bStake: ctx.json.decode('wager_escrows.b_stake_json', ItemBundle, row.b_stake_json),
    status: row.status as EscrowStatus,
    outcome: row.outcome as EscrowOutcome | null,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

export function wagerRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  const inventory = inventoryRepo(ctx);
  const audit = auditRepo(ctx);

  async function getEscrow(id: string): Promise<WagerEscrow | null> {
    const row = await k
      .selectFrom('wager_escrows')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toEscrow(ctx, row) : null;
  }

  function wagerInsert(input: {
    id: string;
    battleId: string;
    whiteStake: ItemBundle;
    blackStake: ItemBundle;
    status: WagerStatus;
    createdAt: number;
    settledAt: number | null;
  }): CompiledQuery {
    return k
      .insertInto('wagers')
      .values({
        id: input.id,
        battle_id: input.battleId,
        white_stake_json: ctx.json.encode('wagers.white_stake_json', ItemBundle, input.whiteStake),
        black_stake_json: ctx.json.encode('wagers.black_stake_json', ItemBundle, input.blackStake),
        status: input.status,
        created_at: input.createdAt,
        settled_at: input.settledAt,
      })
      .compile();
  }

  /** Which side the winner is on; a deleted account's side when the winner is gone (R-SEC-010). */
  function winnerSide(e: WagerEscrow, winnerId: string): 'a' | 'b' {
    if (winnerId === e.aId) return 'a';
    if (winnerId === e.bId) return 'b';
    if (e.aId === null && e.bId !== null) return 'a';
    if (e.bId === null && e.aId !== null) return 'b';
    throw new RangeError(`${winnerId} is not a party of wager ${e.id}`);
  }

  return {
    /** One wager per battle (UNIQUE battle_id). */
    async create(input: {
      battleId: string;
      whiteStake: ItemBundle;
      blackStake: ItemBundle;
      status?: WagerStatus;
      now?: number;
    }): Promise<Wager> {
      const now = input.now ?? ctx.now();
      const id = uuidv7(now);
      await k.executeQuery(
        wagerInsert({
          id,
          battleId: input.battleId,
          whiteStake: input.whiteStake,
          blackStake: input.blackStake,
          status: input.status ?? 'pending',
          createdAt: now,
          settledAt: null,
        }),
      );
      const row = await k
        .selectFrom('wagers')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toWager(ctx, row);
    },

    async get(id: string): Promise<Wager | null> {
      const row = await k.selectFrom('wagers').selectAll().where('id', '=', id).executeTakeFirst();
      return row ? toWager(ctx, row) : null;
    },

    async getByBattle(battleId: string): Promise<Wager | null> {
      const row = await k
        .selectFrom('wagers')
        .selectAll()
        .where('battle_id', '=', battleId)
        .executeTakeFirst();
      return row ? toWager(ctx, row) : null;
    },

    getEscrow,

    async escrowByBattle(battleId: string): Promise<WagerEscrow | null> {
      const row = await k
        .selectFrom('wager_escrows')
        .selectAll()
        .where('battle_id', '=', battleId)
        .executeTakeFirst();
      return row ? toEscrow(ctx, row) : null;
    },

    /** Escrows the player staked in, newest first. */
    async escrowsForPlayer(playerId: string, limit = 50): Promise<WagerEscrow[]> {
      const list = await k
        .selectFrom('wager_escrows')
        .selectAll()
        .where((eb) => eb.or([eb('a_id', '=', playerId), eb('b_id', '=', playerId)]))
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(200, Math.floor(limit))))
        .execute();
      return list.map((r) => toEscrow(ctx, r));
    },

    /**
     * Moves both stakes into escrow in one atomic list (9.5: at battle start). Both stakes must be
     * non-empty. `insufficient` and `duplicate` change nothing (a failed attempt is audited).
     */
    async escrow(input: EscrowInput): Promise<EscrowResult> {
      if (input.aId === input.bId) throw new RangeError('a player cannot wager against themselves');
      if (input.id.length === 0 || input.id.length > 64) throw new RangeError('wager id: 1..64');
      const aStake = normalizeBundle(input.aStake);
      const bStake = normalizeBundle(input.bStake);
      if (isEmptyBundle(aStake) || isEmptyBundle(bStake))
        throw new RangeError('both players must stake something');
      const at = input.at ?? ctx.now();
      const staked = (playerId: string, other: string, stake: ItemBundle, kind: string) =>
        audit.appendStatement({
          playerId,
          kind,
          payload: { wager: input.id, battle: input.battleId, with: other, staked: stake },
          at,
        });
      const list: CompiledQuery[] = [
        k
          .insertInto('wager_escrows')
          .values({
            id: input.id,
            battle_id: input.battleId,
            format: input.format,
            a_id: input.aId,
            b_id: input.bId,
            a_stake_json: ctx.json.encode('wager_escrows.a_stake_json', ItemBundle, aStake),
            b_stake_json: ctx.json.encode('wager_escrows.b_stake_json', ItemBundle, bStake),
            status: 'escrowed',
            releases: 0,
            outcome: null,
            created_at: at,
            settled_at: null,
          })
          .compile(),
        ...moveStatements(inventory, [
          { playerId: input.aId, op: 'spend', bundle: aStake },
          { playerId: input.bId, op: 'spend', bundle: bStake },
        ]),
        staked(input.aId, input.bId, aStake, 'wager_escrow'),
        staked(input.bId, input.aId, bStake, 'wager_escrow'),
      ];
      try {
        await withLockRetry(() => ctx.atomic(list));
      } catch (err) {
        if (isUniqueViolation(err, 'wager_escrows')) return { status: 'duplicate' };
        if (err instanceof DbConstraintError && err.kind === 'check') {
          await ctx.atomic([
            staked(input.aId, input.bId, aStake, 'wager_failed'),
            staked(input.bId, input.aId, bStake, 'wager_failed'),
          ]);
          return { status: 'insufficient' };
        }
        throw err;
      }
      const escrow = await getEscrow(input.id);
      if (!escrow) throw new Error(`escrow ${input.id} vanished after commit`);
      return { status: 'escrowed', escrow };
    },

    /**
     * Pays out an escrow exactly once (9.5): the winner receives both stakes in one transaction; a
     * draw (or `aborted`) returns each stake. A second call reports `duplicate` and changes nothing.
     */
    async settle(id: string, input: SettleInput): Promise<SettleResult> {
      const e = await getEscrow(id);
      if (!e) return { status: 'not_found' };
      if (e.status !== 'escrowed') return { status: 'duplicate' };
      const at = input.at ?? ctx.now();
      const outcome: EscrowOutcome = input.aborted
        ? 'aborted'
        : input.winnerId === null
          ? 'draw'
          : winnerSide(e, input.winnerId);
      const status: EscrowStatus = outcome === 'a' || outcome === 'b' ? 'settled' : 'returned';
      const pot = mergeBundles(e.aStake, e.bStake);
      const shares: { playerId: string | null; bundle: ItemBundle }[] =
        outcome === 'a'
          ? [{ playerId: e.aId, bundle: pot }]
          : outcome === 'b'
            ? [{ playerId: e.bId, bundle: pot }]
            : [
                { playerId: e.aId, bundle: e.aStake },
                { playerId: e.bId, bundle: e.bStake },
              ];
      // A deleted account's share goes with the account (R-SEC-010).
      const paid = shares.filter((s): s is Payout => s.playerId !== null);
      const list: CompiledQuery[] = [
        k
          .updateTable('wager_escrows')
          .set((eb) => ({
            releases: eb('releases', '+', 1),
            status,
            outcome,
            settled_at: at,
          }))
          .where('id', '=', id)
          .compile(),
        ...moveStatements(
          inventory,
          paid.map((p) => ({ playerId: p.playerId, op: 'grant' as const, bundle: p.bundle })),
        ),
      ];
      const seats = input.seats;
      if (seats && !input.aborted) {
        const stakeOf = (playerId: string | null, otherId: string | null): ItemBundle | null => {
          if (playerId !== null && playerId === e.aId) return e.aStake;
          if (playerId !== null && playerId === e.bId) return e.bStake;
          if (otherId !== null && otherId === e.aId) return e.bStake;
          if (otherId !== null && otherId === e.bId) return e.aStake;
          return null;
        };
        const white = stakeOf(seats.whiteId, seats.blackId);
        const black = stakeOf(seats.blackId, seats.whiteId);
        if (white && black)
          list.push(
            wagerInsert({
              id: e.id,
              battleId: e.battleId,
              whiteStake: white,
              blackStake: black,
              status,
              createdAt: e.createdAt,
              settledAt: at,
            }),
          );
      }
      for (const side of ['a', 'b'] as const) {
        const playerId = side === 'a' ? e.aId : e.bId;
        if (playerId === null) continue;
        const got = paid.find((p) => p.playerId === playerId)?.bundle ?? { items: [], cards: [] };
        const result =
          outcome === 'aborted'
            ? 'returned'
            : outcome === 'draw'
              ? 'draw'
              : outcome === side
                ? 'won'
                : 'lost';
        list.push(
          audit.appendStatement({
            playerId,
            kind: 'wager_settled',
            payload: { wager: e.id, battle: e.battleId, result, got },
            at,
          }),
        );
      }
      try {
        await withLockRetry(() => ctx.atomic(list));
      } catch (err) {
        if (
          (err instanceof DbConstraintError && err.kind === 'check') ||
          isUniqueViolation(err, 'wagers')
        )
          return { status: 'duplicate' };
        throw err;
      }
      const after = await getEscrow(id);
      if (!after) throw new Error(`escrow ${id} vanished after settlement`);
      return { status: status === 'settled' ? 'settled' : 'returned', escrow: after, paid };
    },
  };
}

export type WagerRepo = ReturnType<typeof wagerRepo>;
