/**
 * JSON columns (spec 13.6, R-DATA-004): JSONB on PostgreSQL, TEXT on SQLite. Values are validated
 * with Zod on the way in and on the way out, so a corrupt or hand-edited row surfaces as a
 * `DbDataError` instead of flowing into game code.
 *
 * `db` depends on nothing inside the repo (R-DATA-001), so these are structural schemas; game rules
 * (for example loadout legality, R-LOAD-004) are checked by the rules engine, not here.
 */
import { z } from 'zod';
import { DbDataError } from './errors.ts';
import type { DbDialect } from './db-types.ts';

const ContentId = z.string().min(1).max(64);
const Qty = z.number().int().positive().max(1_000_000);

/** A saved loadout, structurally (mirrors the rules `Loadout` type; legality is R-LOAD-004's job). */
export const LoadoutJson = z.object({
  elements: z.array(z.string().min(1).max(16)).min(1).max(2),
  items: z.array(ContentId).max(6),
  itemParams: z
    .record(ContentId, z.object({ element: z.string().min(1).max(16).optional() }))
    .optional(),
  sets: z.array(z.array(ContentId).max(8)).min(1).max(6),
});
export type LoadoutJson = z.infer<typeof LoadoutJson>;

/** Items and ability cards with quantities: wager stakes, trade offers, reward payloads. */
export const ItemBundle = z.object({
  items: z
    .array(z.object({ itemId: ContentId, qty: Qty }))
    .max(64)
    .default([]),
  cards: z
    .array(z.object({ abilityId: ContentId, qty: Qty }))
    .max(64)
    .default([]),
});
export type ItemBundle = z.infer<typeof ItemBundle>;

/** What one reward grant gave (R-SEC-003). */
export const RewardPayload = ItemBundle.extend({
  xp: z.number().int().min(0).max(1_000_000).default(0),
  coins: z.number().int().min(0).max(1_000_000).default(0),
  keyItems: z.array(ContentId).max(16).default([]),
  flags: z.array(z.string().min(1).max(120)).max(16).default([]),
});
export type RewardPayload = z.infer<typeof RewardPayload>;

/**
 * Pending sign-up data carried by a login token. Never a birth date (R-SEC-011). `oauth` lets a new
 * OAuth account finish sign-up through a 'signup' token and then be linked.
 */
export const LoginTokenData = z.object({
  displayName: z.string().min(1).max(64).optional(),
  adultFrom: z.number().int().optional(),
  oauth: z
    .object({
      provider: z.string().min(1).max(16),
      providerUserId: z.string().min(1).max(128),
    })
    .optional(),
});
export type LoginTokenData = z.infer<typeof LoginTokenData>;

/** Free-form JSON object (audit payloads, quest data). */
export const JsonObject = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof JsonObject>;

/** Encodes and decodes JSON columns for one dialect. */
export interface JsonCodec {
  /** Validates `value` with `schema` and returns the JSON text to bind. */
  encode<S extends z.ZodType>(column: string, schema: S, value: z.input<S>): string;
  /** Parses a column value read from the driver and validates it with `schema`. */
  decode<S extends z.ZodType>(column: string, schema: S, raw: unknown): z.output<S>;
}

export function jsonCodec(dialect: DbDialect): JsonCodec {
  return {
    encode(column, schema, value) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new DbDataError(column, 'invalid value', parsed.error.issues, parsed.error);
      }
      return JSON.stringify(parsed.data);
    },
    decode(column, schema, raw) {
      let value: unknown = raw;
      // node-postgres parses JSONB itself; SQLite and D1 return the TEXT as written.
      if (dialect !== 'postgres') {
        if (typeof raw !== 'string') throw new DbDataError(column, 'expected JSON text');
        try {
          value = JSON.parse(raw);
        } catch (err) {
          throw new DbDataError(column, 'not valid JSON', [], err);
        }
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new DbDataError(
          column,
          'stored value failed validation',
          parsed.error.issues,
          parsed.error,
        );
      }
      return parsed.data;
    },
  };
}
