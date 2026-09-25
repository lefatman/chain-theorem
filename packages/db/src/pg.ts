/**
 * `@chain-theorem/db/pg`: PostgreSQL through node-postgres (spec 13.6). Production reaches Neon
 * through Hyperdrive with this driver (the Worker needs `nodejs_compat`); CI and `pnpm test:db:pg`
 * use a local server. Imports no native code, so it is safe in the Worker bundle.
 */
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createDb, type CreateDbOptions, type Db } from './db.ts';
import type { Schema } from './schema.ts';

const INT8_OID = 20;

/**
 * Per-pool type parsers: BIGINT (epoch-ms timestamps, COUNT(*)) comes back as a JS number instead of
 * a string, matching SQLite. Epoch milliseconds are far below 2^53. Nothing global is mutated.
 */
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === INT8_OID
      ? (value: string) => Number(value)
      : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig['getTypeParser'],
};

export interface PostgresOptions extends Omit<CreateDbOptions, 'runAtomic'> {
  /** Pool size (default 10). With Hyperdrive, Hyperdrive pools; keep this small. */
  max?: number;
}

/** A `Db` on PostgreSQL; `connectionString` is a postgres:// URL (or Hyperdrive's). */
export function postgresDb(connectionString: string, options: PostgresOptions = {}): Db {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, types });
  const kysely = new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
  return createDb(kysely, 'postgres', options);
}
