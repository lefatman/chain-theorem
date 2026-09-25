/**
 * The engines every repository test runs against (spec 13.6, R-DATA-004):
 * - sqlite:   in-memory better-sqlite3 (`@chain-theorem/db/node`)
 * - d1:       `@chain-theorem/db/d1` over an in-process D1 stand-in backed by better-sqlite3. It
 *             mimics D1's surface (prepare/bind/all/run, batch() as one transaction, D1_ERROR
 *             messages) so kysely-d1, the batch runner and D1 error mapping are exercised here; the
 *             real D1 binding is covered by the Workers integration tests (`pnpm test:workers`).
 * - postgres: node-postgres against TEST_PG_URL, one throwaway schema per test; skipped (reported
 *             as skipped) when TEST_PG_URL is unset. `pnpm test:db:pg` provides one.
 */
import Database from 'better-sqlite3';
import type { D1Database } from '@cloudflare/workers-types';
import { sql } from 'kysely';
import pg from 'pg';
import { afterEach, beforeEach } from 'vitest';
import { migrate, uuidv7, type Db } from '../src/index.ts';
import { d1Db } from '../src/d1.ts';
import { postgresDb, sqliteDb } from '../src/node.ts';

export interface EngineHandle {
  db: Db;
  close(): Promise<void>;
}

export interface Engine {
  name: 'sqlite' | 'd1' | 'postgres';
  available: boolean;
  open(): Promise<EngineHandle>;
}

export const PG_URL = process.env.TEST_PG_URL;

type SqliteDb = InstanceType<typeof Database>;

interface FakeResult {
  success: true;
  results: unknown[];
  meta: { changes: number; last_row_id: number; duration: number };
}

/**
 * D1's error text, as workerd produces it (checked against wrangler's local D1), e.g.
 * `D1_ERROR: UNIQUE constraint failed: players.email: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`.
 */
function d1Error(err: unknown): Error {
  const e = err as { message?: string; code?: string };
  const code = e.code ?? 'SQLITE_ERROR';
  const primary = code.replace(/^(SQLITE_[A-Z]+)_.*$/, '$1');
  const extended = primary === code ? '' : ` (extended: ${code})`;
  return new Error(`D1_ERROR: ${e.message ?? String(err)}: ${primary}${extended}`);
}

class FakeD1Statement {
  readonly #db: SqliteDb;
  readonly #sql: string;
  readonly #params: unknown[];

  constructor(db: SqliteDb, sql: string, params: unknown[] = []) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...values: unknown[]): FakeD1Statement {
    for (const v of values) {
      if (v === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported');
    }
    return new FakeD1Statement(this.#db, this.#sql, values);
  }

  /** Synchronous execution (used by batch inside one SQLite transaction). */
  execute(): FakeResult {
    const stmt = this.#db.prepare(this.#sql);
    if (stmt.reader) {
      return {
        success: true,
        results: stmt.all(...this.#params),
        meta: { changes: 0, last_row_id: 0, duration: 0 },
      };
    }
    const r = stmt.run(...this.#params);
    return {
      success: true,
      results: [],
      meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid), duration: 0 },
    };
  }

  async all(): Promise<FakeResult> {
    try {
      return this.execute();
    } catch (err) {
      throw d1Error(err);
    }
  }

  async run(): Promise<FakeResult> {
    return this.all();
  }

  async first(column?: string): Promise<unknown> {
    const row = (await this.all()).results[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return column === undefined ? row : row[column];
  }

  async raw(): Promise<unknown[][]> {
    return (await this.all()).results.map((r) => Object.values(r as Record<string, unknown>));
  }
}

/** In-process stand-in for a D1 binding, backed by better-sqlite3 (foreign keys on, as in D1). */
export class FakeD1 {
  readonly sqlite: SqliteDb;

  constructor() {
    this.sqlite = new Database(':memory:');
    this.sqlite.pragma('foreign_keys = ON');
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.sqlite, sql);
  }

  /** Like D1: all statements in one transaction; any failure rolls back the whole batch. */
  async batch(statements: FakeD1Statement[]): Promise<FakeResult[]> {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s.execute());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw d1Error(err);
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  asBinding(): D1Database {
    return this as unknown as D1Database;
  }
}

async function adminQuery(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** A connection string whose sessions use `schema` as their search_path. */
export function pgUrlForSchema(schema: string): string {
  const url = new URL(PG_URL ?? 'postgres://localhost/none');
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

export const ENGINES: Engine[] = [
  {
    name: 'sqlite',
    available: true,
    async open() {
      const db = sqliteDb(':memory:');
      return { db, close: () => db.destroy() };
    },
  },
  {
    name: 'd1',
    available: true,
    async open() {
      const fake = new FakeD1();
      const db = d1Db(fake.asBinding());
      return {
        db,
        async close() {
          await db.destroy();
          fake.sqlite.close();
        },
      };
    },
  },
  {
    name: 'postgres',
    available: PG_URL !== undefined && PG_URL !== '',
    async open() {
      const schema = `ct_${uuidv7().replace(/-/g, '')}`;
      await adminQuery(`CREATE SCHEMA "${schema}"`);
      const db = postgresDb(pgUrlForSchema(schema), { max: 8 });
      return {
        db,
        async close() {
          await db.destroy();
          await adminQuery(`DROP SCHEMA "${schema}" CASCADE`);
        },
      };
    },
  },
];

/**
 * Registers hooks that open a fresh, migrated database before each test and close it after.
 * Returns a getter for the current `Db`.
 */
export function useDb(engine: Engine, opts: { migrate?: boolean } = {}): () => Db {
  let handle: EngineHandle | undefined;
  beforeEach(async () => {
    handle = await engine.open();
    if (opts.migrate !== false) await migrate(handle.db);
  });
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });
  return () => {
    if (!handle) throw new Error('database not open');
    return handle.db;
  };
}

/** A player with sensible defaults. */
export async function makePlayer(
  db: Db,
  email = `p${uuidv7().slice(-12)}@example.com`,
  name = 'Tester',
) {
  return db.players.create({ email, displayName: name, adultFrom: Date.UTC(2000, 0, 1) });
}

export interface TableInfo {
  name: string;
  columns: { name: string; dataType: string }[];
}

/**
 * Tables of this test's database. On PostgreSQL only the test's own schema, read straight from
 * pg_catalog: Kysely's introspector scans every schema and calls pg_get_serial_sequence() on each
 * table, which fails when a parallel test file drops its schema at the same moment.
 */
export async function schemaTables(db: Db): Promise<TableInfo[]> {
  if (db.dialect !== 'postgres') {
    const tables = await db.kysely.introspection.getTables();
    return tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
    }));
  }
  const r = await sql<{ table_name: string; column_name: string; data_type: string }>`
    select c.relname as table_name, a.attname as column_name, t.typname as data_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    join pg_catalog.pg_type t on t.oid = a.atttypid
    where n.nspname = current_schema() and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`.execute(db.kysely);
  const byName = new Map<string, TableInfo>();
  for (const row of r.rows) {
    let table = byName.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      byName.set(row.table_name, table);
    }
    table.columns.push({ name: row.column_name, dataType: row.data_type });
  }
  return [...byName.values()];
}

export async function columnNames(db: Db, table: string): Promise<string[]> {
  const tables = await schemaTables(db);
  return tables.find((t) => t.name === table)?.columns.map((c) => c.name) ?? [];
}
