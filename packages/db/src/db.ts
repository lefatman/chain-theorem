/**
 * The `Db` object (ARCHITECTURE 7): one Kysely query layer over PostgreSQL, better-sqlite3 or D1
 * (spec 13.6, R-DATA-004), the atomic statement-list runner (DD-15) and the repositories.
 */
import type { CompiledQuery, Kysely } from 'kysely';
import { mapDbError } from './errors.ts';
import { jsonCodec } from './json.ts';
import type { AtomicRunner, DbDialect, RepoContext } from './db-types.ts';
import { rows } from './db-types.ts';
import type { Schema } from './schema.ts';
import { auditRepo } from './repos/audit.ts';
import { battleRepo } from './repos/battles.ts';
import { inventoryRepo } from './repos/inventory.ts';
import { loadoutRepo } from './repos/loadouts.ts';
import { loginTokenRepo } from './repos/login-tokens.ts';
import { oauthAccountRepo } from './repos/oauth.ts';
import { playerRepo } from './repos/players.ts';
import { ratingRepo } from './repos/ratings.ts';
import { rewardRepo } from './repos/rewards.ts';
import { sessionRepo } from './repos/sessions.ts';
import { wagerRepo } from './repos/wagers.ts';
import { worldRepo } from './repos/world.ts';
import { socialRepo } from './repos/social.ts';

export interface CreateDbOptions {
  /** Clock for created/updated timestamps (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  /**
   * How to run atomic statement lists. Defaults to a Kysely transaction (BEGIN ... COMMIT on one
   * connection), which PostgreSQL and better-sqlite3 support. D1 must pass a `batch()` runner.
   */
  runAtomic?: AtomicRunner;
}

/**
 * Atomic lists through a Kysely transaction: every statement runs on one connection between BEGIN
 * and COMMIT; any error rolls back all of them. Affected-row counts come back in order.
 */
export function transactionRunner(kysely: Kysely<Schema>): AtomicRunner {
  return async (statements: readonly CompiledQuery[]) => {
    if (statements.length === 0) return [];
    try {
      return await kysely.transaction().execute(async (trx) => {
        const counts: number[] = [];
        for (const statement of statements) {
          const r = await trx.executeQuery(statement);
          counts.push(rows(r.numAffectedRows));
        }
        return counts;
      });
    } catch (err) {
      throw mapDbError(err);
    }
  };
}

export function createDb(
  kysely: Kysely<Schema>,
  dialect: DbDialect,
  options: CreateDbOptions = {},
) {
  if (dialect === 'd1' && options.runAtomic === undefined) {
    throw new Error(
      'D1 has no interactive transactions: pass a batch() runner (use d1Db from @chain-theorem/db/d1)',
    );
  }
  const atomic = options.runAtomic ?? transactionRunner(kysely);
  const ctx: RepoContext = {
    kysely,
    dialect,
    json: jsonCodec(dialect),
    atomic,
    now: options.now ?? (() => Date.now()),
  };
  return {
    kysely,
    dialect,
    /**
     * Runs an ordered list of compiled statements atomically (DD-15): BEGIN/COMMIT on PostgreSQL and
     * better-sqlite3, one `batch()` on D1. Resolves to each statement's affected-row count. Any
     * error rolls back every statement; constraint violations reject with `DbConstraintError`.
     */
    atomic,
    now: ctx.now,
    players: playerRepo(ctx),
    sessions: sessionRepo(ctx),
    loginTokens: loginTokenRepo(ctx),
    oauthAccounts: oauthAccountRepo(ctx),
    inventory: inventoryRepo(ctx),
    loadouts: loadoutRepo(ctx),
    ratings: ratingRepo(ctx),
    battles: battleRepo(ctx),
    wagers: wagerRepo(ctx),
    rewards: rewardRepo(ctx),
    audit: auditRepo(ctx),
    world: worldRepo(ctx),
    social: socialRepo(ctx),
    /** Closes the pool or database handle. */
    async destroy(): Promise<void> {
      await kysely.destroy();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
