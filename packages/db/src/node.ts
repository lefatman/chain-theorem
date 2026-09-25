/**
 * `@chain-theorem/db/node`: Node-only drivers. better-sqlite3 is native code, so this entry must never
 * be imported by the Worker bundle (use `@chain-theorem/db/d1` or `@chain-theorem/db/pg` there).
 */
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { createDb, type CreateDbOptions, type Db } from './db.ts';
import type { Schema } from './schema.ts';

export { postgresDb, type PostgresOptions } from './pg.ts';

/**
 * A `Db` on SQLite through better-sqlite3 (unit and repository tests, tools). Defaults to a fresh
 * in-memory database. Foreign keys are enforced, as they are on D1.
 */
export function sqliteDb(
  filename = ':memory:',
  options: Omit<CreateDbOptions, 'runAtomic'> = {},
): Db {
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  if (filename !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
  }
  const kysely = new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return createDb(kysely, 'sqlite', options);
}
