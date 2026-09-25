/**
 * Direct trades between two players (spec 10.4, R-WORLD-004, R-SEC-004). A trade is ONE atomic
 * list: the `trades` row (its id is the TradeSession's, so a session completes at most once), both
 * players' spends (CHECK (qty >= 0) aborts an over-spend on every engine), both grants, and an
 * `audit_log` row per player for support and fraud review. Parallel trades on the same inventory
 * rows can neither duplicate nor lose an item: each list either commits whole or changes nothing.
 * A trade that could not be paid (someone no longer owns what they offered) is logged too.
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { z } from 'zod';
import { DbConstraintError, isUniqueViolation } from '../errors.ts';
import type { RepoContext } from '../db-types.ts';
import { ItemBundle } from '../json.ts';
import type { TradesTable } from '../schema.ts';
import { auditRepo } from './audit.ts';
import { inventoryRepo } from './inventory.ts';
import { isEmptyBundle, moveStatements, normalizeBundle, withLockRetry } from './moves.ts';

/** `trades.offer_json` of a trade written by this repository: what each side gave. */
export const TradeOffer = z.object({ a: ItemBundle, b: ItemBundle });
export type TradeOffer = z.infer<typeof TradeOffer>;

export interface Trade {
  id: string;
  /** Null after that account was deleted (R-SEC-010). */
  aId: string | null;
  bId: string | null;
  status: string;
  /** What A gave (B received). */
  a: ItemBundle;
  /** What B gave (A received). */
  b: ItemBundle;
  createdAt: number;
  completedAt: number | null;
}

export interface TradeInput {
  /** The TradeSession id: UNIQUE, so the same session can never pay out twice. */
  id: string;
  aId: string;
  bId: string;
  /** What A gives. */
  a: ItemBundle;
  /** What B gives. */
  b: ItemBundle;
  at?: number;
}

export type TradeOutcome =
  | { status: 'completed'; trade: Trade }
  /** Someone no longer owns what they offered: nothing changed. */
  | { status: 'insufficient' }
  /** A trade with this id already completed: nothing changed. */
  | { status: 'duplicate' };

export function toTrade(ctx: Pick<RepoContext, 'json'>, row: Selectable<TradesTable>): Trade {
  const offer = ctx.json.decode('trades.offer_json', TradeOffer, row.offer_json);
  return {
    id: row.id,
    aId: row.a_id,
    bId: row.b_id,
    status: row.status,
    a: offer.a,
    b: offer.b,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function tradeRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  const inventory = inventoryRepo(ctx);
  const audit = auditRepo(ctx);

  function check(input: TradeInput): { a: ItemBundle; b: ItemBundle; at: number } {
    if (input.id.length === 0 || input.id.length > 64) throw new RangeError('trade id: 1..64');
    if (input.aId === input.bId) throw new RangeError('a player cannot trade with themselves');
    const a = normalizeBundle(input.a);
    const b = normalizeBundle(input.b);
    if (isEmptyBundle(a) && isEmptyBundle(b)) throw new RangeError('an empty trade');
    return { a, b, at: input.at ?? ctx.now() };
  }

  /** The atomic list of one trade (the trade row first: a duplicate aborts before anything else). */
  function statements(input: TradeInput): CompiledQuery[] {
    const { a, b, at } = check(input);
    return [
      k
        .insertInto('trades')
        .values({
          id: input.id,
          a_id: input.aId,
          b_id: input.bId,
          status: 'completed',
          offer_json: ctx.json.encode('trades.offer_json', TradeOffer, { a, b }),
          created_at: at,
          completed_at: at,
        })
        .compile(),
      ...moveStatements(inventory, [
        { playerId: input.aId, op: 'spend', bundle: a },
        { playerId: input.bId, op: 'spend', bundle: b },
        { playerId: input.bId, op: 'grant', bundle: a },
        { playerId: input.aId, op: 'grant', bundle: b },
      ]),
      audit.appendStatement({
        playerId: input.aId,
        kind: 'trade',
        payload: { trade: input.id, with: input.bId, gave: a, got: b },
        at,
      }),
      audit.appendStatement({
        playerId: input.bId,
        kind: 'trade',
        payload: { trade: input.id, with: input.aId, gave: b, got: a },
        at,
      }),
    ];
  }

  async function get(id: string): Promise<Trade | null> {
    const row = await k.selectFrom('trades').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toTrade(ctx, row) : null;
  }

  return {
    statements,

    /**
     * Executes the trade in one atomic list (R-SEC-004). `insufficient` and `duplicate` change
     * nothing; an insufficient attempt is still written to the audit log of both players.
     */
    async execute(input: TradeInput): Promise<TradeOutcome> {
      const list = statements(input);
      const { a, b, at } = check(input);
      try {
        await withLockRetry(() => ctx.atomic(list));
      } catch (err) {
        if (isUniqueViolation(err, 'trades')) return { status: 'duplicate' };
        if (err instanceof DbConstraintError && err.kind === 'check') {
          const failed = (playerId: string, other: string, gave: ItemBundle, got: ItemBundle) =>
            audit.appendStatement({
              playerId,
              kind: 'trade_failed',
              payload: { trade: input.id, with: other, gave, got, reason: 'insufficient' },
              at,
            });
          await ctx.atomic([
            failed(input.aId, input.bId, a, b),
            failed(input.bId, input.aId, b, a),
          ]);
          return { status: 'insufficient' };
        }
        throw err;
      }
      const trade = await get(input.id);
      if (!trade) throw new Error(`trade ${input.id} vanished after commit`);
      return { status: 'completed', trade };
    },

    get,

    /** The player's trades, newest first. */
    async listForPlayer(playerId: string, limit = 50): Promise<Trade[]> {
      const list = await k
        .selectFrom('trades')
        .selectAll()
        .where((eb) => eb.or([eb('a_id', '=', playerId), eb('b_id', '=', playerId)]))
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(200, Math.floor(limit))))
        .execute();
      return list.map((r) => toTrade(ctx, r));
    },
  };
}

export type TradeRepo = ReturnType<typeof tradeRepo>;
