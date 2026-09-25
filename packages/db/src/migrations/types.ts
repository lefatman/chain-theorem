import type { ColumnDataType, CompiledQuery, SchemaModule } from 'kysely';
import type { DbDialect } from '../db-types.ts';

/** Column types that differ by engine; the only thing a migration may branch on (spec 13.6). */
export interface ColumnTypes {
  /** Epoch milliseconds: BIGINT on PostgreSQL, INTEGER on SQLite. */
  ts: ColumnDataType;
  /** JSON: JSONB on PostgreSQL, TEXT on SQLite. */
  json: ColumnDataType;
  /** Floating point: DOUBLE PRECISION on PostgreSQL, REAL on SQLite. */
  real: ColumnDataType;
}

export interface MigrationContext {
  dialect: DbDialect;
  schema: SchemaModule;
  t: ColumnTypes;
}

/** A forward-only migration: an ordered statement list applied atomically with its ledger row. */
export interface Migration {
  /** Sortable, unique, never renamed: `NNNN_name`. */
  id: string;
  up(ctx: MigrationContext): CompiledQuery[];
}

export function columnTypes(dialect: DbDialect): ColumnTypes {
  return dialect === 'postgres'
    ? { ts: 'bigint', json: 'jsonb', real: 'double precision' }
    : { ts: 'integer', json: 'text', real: 'real' };
}
