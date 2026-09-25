import type { CompiledQuery, Kysely } from 'kysely';
import type { JsonCodec } from './json.ts';
import type { Schema } from './schema.ts';

/** Which engine a `Db` talks to. `d1` is SQLite without interactive transactions (DD-15). */
export type DbDialect = 'sqlite' | 'd1' | 'postgres';

/**
 * Runs an ordered list of compiled statements atomically and returns each statement's affected-row
 * count. A constraint violation rolls back every statement and rejects with `DbConstraintError`.
 */
export type AtomicRunner = (statements: readonly CompiledQuery[]) => Promise<number[]>;

/** What every repository is built from. */
export interface RepoContext {
  kysely: Kysely<Schema>;
  dialect: DbDialect;
  json: JsonCodec;
  atomic: AtomicRunner;
  /** Clock for created/updated timestamps (epoch ms); injectable for tests. */
  now: () => number;
}

/** Affected-row count from a Kysely result's bigint. */
export function rows(n: bigint | undefined): number {
  return Number(n ?? 0n);
}
