/**
 * Typed database errors. Driver errors differ per engine (better-sqlite3 codes, PostgreSQL SQLSTATE,
 * D1 message text), so repositories and `atomic()` translate constraint violations into one
 * `DbConstraintError` that callers can branch on (DD-15).
 */
import type { z } from 'zod';

export type ConstraintKind = 'unique' | 'check' | 'foreign_key' | 'not_null';

/** A write violated a constraint; the whole statement (or atomic list) was rolled back. */
export class DbConstraintError extends Error {
  override readonly name = 'DbConstraintError';
  readonly kind: ConstraintKind;
  /** Table name when the engine reports it (PostgreSQL always; SQLite for unique and not-null). */
  readonly table: string | undefined;
  /** Constraint name when the engine reports it (PostgreSQL always; SQLite for named CHECKs). */
  readonly constraint: string | undefined;

  constructor(
    kind: ConstraintKind,
    message: string,
    detail: { table?: string | undefined; constraint?: string | undefined; cause?: unknown },
  ) {
    super(message, { cause: detail.cause });
    this.kind = kind;
    this.table = detail.table;
    this.constraint = detail.constraint;
  }
}

/** A stored JSON column failed Zod validation (or was not JSON at all). */
export class DbDataError extends Error {
  override readonly name = 'DbDataError';
  readonly column: string;
  readonly issues: z.core.$ZodIssue[];

  constructor(column: string, message: string, issues: z.core.$ZodIssue[] = [], cause?: unknown) {
    super(`${column}: ${message}`, { cause });
    this.column = column;
    this.issues = issues;
  }
}

const PG_CODES: Record<string, ConstraintKind> = {
  '23505': 'unique',
  '23514': 'check',
  '23503': 'foreign_key',
  '23502': 'not_null',
};

function field(err: object, key: string): string | undefined {
  const value = (err as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Converts a driver error into a `DbConstraintError` when it is a constraint violation; any other
 * error is returned unchanged.
 */
export function mapDbError(err: unknown): unknown {
  if (err instanceof DbConstraintError || typeof err !== 'object' || err === null) return err;
  const message = err instanceof Error ? err.message : String(err);

  // PostgreSQL (node-postgres DatabaseError): SQLSTATE class 23.
  const code = field(err, 'code');
  if (code !== undefined && PG_CODES[code] !== undefined) {
    return new DbConstraintError(PG_CODES[code], message, {
      table: field(err, 'table'),
      constraint: field(err, 'constraint'),
      cause: err,
    });
  }

  // SQLite (better-sqlite3 codes SQLITE_CONSTRAINT_*, D1 "D1_ERROR: ...: SQLITE_CONSTRAINT").
  const unique = /UNIQUE constraint failed: ([A-Za-z0-9_]+)\./.exec(message);
  if (unique) return new DbConstraintError('unique', message, { table: unique[1], cause: err });
  const notNull = /NOT NULL constraint failed: ([A-Za-z0-9_]+)\./.exec(message);
  if (notNull) return new DbConstraintError('not_null', message, { table: notNull[1], cause: err });
  const check = /CHECK constraint failed: ([A-Za-z0-9_]+)/.exec(message);
  if (check) return new DbConstraintError('check', message, { constraint: check[1], cause: err });
  if (/FOREIGN KEY constraint failed/.test(message)) {
    return new DbConstraintError('foreign_key', message, { cause: err });
  }
  return err;
}

/** True when `err` is a unique violation, optionally on a given table. */
export function isUniqueViolation(err: unknown, table?: string): err is DbConstraintError {
  return (
    err instanceof DbConstraintError &&
    err.kind === 'unique' &&
    (table === undefined || err.table === table)
  );
}
