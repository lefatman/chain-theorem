/**
 * The database for this isolate (13.6): D1 locally and in Worker tests, PostgreSQL through Hyperdrive
 * in production. D1 databases are migrated on first use (forward-only, idempotent); production runs
 * migrations from the CLI before deploy (DEPLOY.md 3).
 */
import { migrate, type Db } from '@chain-theorem/db';
import { d1Db } from '@chain-theorem/db/d1';
import type { Env } from './env.ts';

let d1: { binding: D1Database; db: Promise<Db> } | null = null;

export function getDb(env: Env): Promise<Db> {
  if (env.DB_KIND === 'postgres') {
    if (!env.HYPERDRIVE) throw new Error('DB_KIND=postgres needs the HYPERDRIVE binding');
    // Hyperdrive pools connections; one small client pool per request is the recommended pattern.
    // pg is loaded only here, so D1-only builds and tests never evaluate it.
    const url = env.HYPERDRIVE.connectionString;
    return import('@chain-theorem/db/pg').then(({ postgresDb }) => postgresDb(url, { max: 1 }));
  }
  if (!env.DB) throw new Error('DB_KIND=d1 needs the DB binding');
  if (!d1 || d1.binding !== env.DB) {
    const db = d1Db(env.DB);
    d1 = { binding: env.DB, db: migrate(db).then(() => db) };
  }
  return d1.db;
}

/** Release a per-request PostgreSQL pool (no-op for D1). */
export async function releaseDb(env: Env, db: Db): Promise<void> {
  if (env.DB_KIND === 'postgres') await db.destroy();
}
