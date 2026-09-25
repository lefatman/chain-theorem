/**
 * The WebSocket envelope (13.4, R-NET-001): `{ t: type, s?: clientSeq, d?: data }`. Keys are short
 * because zone steps are the most frequent message. Every message is validated with its Zod schema
 * on arrival; invalid ones are dropped and counted by the receiver.
 */
import { z } from 'zod';

/** Largest frame a server accepts from a client (bytes of UTF-16 text). */
export const MAX_CLIENT_FRAME = 4096;

export const Envelope = z.object({
  t: z.string().min(1).max(16),
  s: z.number().int().nonnegative().optional(),
  d: z.unknown().optional(),
});
export type Envelope = z.infer<typeof Envelope>;

/** Messages as a discriminated union keyed by `t`, each with its own data schema. */
export type MessageMap = Record<string, z.ZodType>;

export type Msg<M extends MessageMap> = {
  [K in keyof M & string]: { t: K; s?: number; d: z.infer<M[K]> };
}[keyof M & string];

/**
 * Decode one frame against a message map. Returns null for anything invalid: not JSON, too large,
 * unknown type or data that fails its schema. The caller counts the drop (R-SEC-005).
 */
export function decode<M extends MessageMap>(
  map: M,
  raw: unknown,
  maxBytes = MAX_CLIENT_FRAME,
): Msg<M> | null {
  if (typeof raw !== 'string' || raw.length > maxBytes) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const env = Envelope.safeParse(json);
  if (!env.success) return null;
  const schema = Object.hasOwn(map, env.data.t) ? map[env.data.t] : undefined;
  if (!schema) return null;
  const data = schema.safeParse(env.data.d ?? {});
  if (!data.success) return null;
  const out = { t: env.data.t, d: data.data } as Msg<M>;
  if (env.data.s !== undefined) out.s = env.data.s;
  return out;
}

/** Encode a message; the type is checked at compile time against the map. */
export function encode<M extends MessageMap>(_map: M, msg: Msg<M>): string {
  return JSON.stringify(msg);
}
