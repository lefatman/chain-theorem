/**
 * `@chain-theorem/db/d1`: Cloudflare D1 (local `wrangler dev` and Worker integration tests, spec
 * 13.6). Queries go through kysely-d1; D1 has no interactive transactions, so atomic statement lists
 * run as one `batch()`, which D1 executes as a single transaction and rolls back on any error (DD-15).
 */
import type { D1Database } from '@cloudflare/workers-types';
import { Kysely, type CompiledQuery } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { createDb, type CreateDbOptions, type Db } from './db.ts';
import type { AtomicRunner } from './db-types.ts';
import { mapDbError } from './errors.ts';
import type { Schema } from './schema.ts';

/** Atomic lists on D1: one `batch()`; returns each statement's `meta.changes`. */
export function d1BatchRunner(binding: D1Database): AtomicRunner {
  return async (statements: readonly CompiledQuery[]) => {
    if (statements.length === 0) return [];
    try {
      const results = await binding.batch(
        statements.map((q) => binding.prepare(q.sql).bind(...q.parameters)),
      );
      return results.map((r) => Number(r.meta.changes ?? 0));
    } catch (err) {
      throw mapDbError(err);
    }
  };
}

/** A `Db` on a D1 binding (`env.DB`). */
export function d1Db(binding: D1Database, options: Omit<CreateDbOptions, 'runAtomic'> = {}): Db {
  const kysely = new Kysely<Schema>({ dialect: new D1Dialect({ database: binding }) });
  return createDb(kysely, 'd1', { ...options, runAtomic: d1BatchRunner(binding) });
}
