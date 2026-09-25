/**
 * Forward-only migrations (spec 13.6, R-DATA-004). Each migration's DDL and its `schema_migrations`
 * ledger row run as one atomic list (a transaction, or one D1 batch), so a migration is applied
 * completely or not at all. Every statement is also IF NOT EXISTS, and a runner that loses a race to
 * another runner moves on: running `migrate()` again, or twice at once, is a no-op.
 */
import type { CompiledQuery } from 'kysely';
import type { Db } from './db.ts';
import { m0001Initial } from './migrations/0001_initial.ts';
import { m0002World } from './migrations/0002_world.ts';
import { m0003Economy } from './migrations/0003_economy.ts';
import { m0004Billing } from './migrations/0004_billing.ts';
import { m0005GuildsRanked } from './migrations/0005_guilds_ranked.ts';
import { columnTypes, type Migration } from './migrations/types.ts';

/** All migrations in order. Append only; never edit or reorder an applied migration. */
export const MIGRATIONS: readonly Migration[] = [
  m0001Initial,
  m0002World,
  m0003Economy,
  m0004Billing,
  m0005GuildsRanked,
];

/** Applied migration ids, or null when the ledger table does not exist (yet). */
async function readLedger(db: Db): Promise<Set<string> | null> {
  try {
    const list = await db.kysely.selectFrom('schema_migrations').select('id').execute();
    return new Set(list.map((r) => r.id));
  } catch {
    return null;
  }
}

/**
 * Applies pending migrations; resolves to the ids applied by this call (empty when up to date).
 * When a statement list fails, the ledger is read again: if another runner committed the same
 * migration meanwhile (on PostgreSQL the loser of two concurrent CREATE TABLE IF NOT EXISTS gets a
 * catalog unique violation), this runner moves on; any other failure rejects.
 */
export async function migrate(db: Db): Promise<string[]> {
  const t = columnTypes(db.dialect);
  const schema = db.kysely.schema;
  try {
    await db.atomic([
      schema
        .createTable('schema_migrations')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('applied_at', t.ts, (c) => c.notNull())
        .compile(),
    ]);
  } catch (err) {
    if ((await readLedger(db)) === null) throw err;
  }
  let done = await readLedger(db);
  if (done === null) throw new Error('schema_migrations is missing after creation');
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    const statements: CompiledQuery[] = [
      ...migration.up({ dialect: db.dialect, schema, t }),
      db.kysely
        .insertInto('schema_migrations')
        .values({ id: migration.id, applied_at: db.now() })
        .compile(),
    ];
    try {
      await db.atomic(statements);
      applied.push(migration.id);
    } catch (err) {
      const after = await readLedger(db);
      if (!after?.has(migration.id)) throw err;
      done = after;
    }
  }
  return applied;
}

/** Ids recorded in the ledger, in order. */
export async function appliedMigrations(db: Db): Promise<string[]> {
  const list = await db.kysely.selectFrom('schema_migrations').select('id').orderBy('id').execute();
  return list.map((r) => r.id);
}
