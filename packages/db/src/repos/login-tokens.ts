/**
 * Magic-link tokens (passwordless sign-in, R-SEC-006). Only the SHA-256 hash is stored. A token is
 * consumed by one conditional UPDATE (`used_at IS NULL AND expires_at > now`) whose affected-row
 * count decides the winner, so concurrent clicks sign in exactly once on every engine.
 */
import { randomToken, sha256Hex, uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import { LoginTokenData } from '../json.ts';
import { normalizeEmail } from './players.ts';

export interface ConsumedLoginToken {
  email: string;
  purpose: string;
  data: LoginTokenData;
}

export function loginTokenRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  return {
    /** Issues a token for `email`; returns the raw token once (it goes into the emailed link). */
    async issue(input: {
      email: string;
      purpose: string;
      ttlMs: number;
      data?: LoginTokenData;
      now?: number;
    }): Promise<{ token: string; expiresAt: number }> {
      if (!(input.ttlMs > 0)) throw new RangeError('ttlMs must be positive');
      const now = input.now ?? ctx.now();
      const token = randomToken(32);
      const expiresAt = now + input.ttlMs;
      await k
        .insertInto('login_tokens')
        .values({
          id: uuidv7(now),
          token_hash: await sha256Hex(token),
          email: normalizeEmail(input.email),
          purpose: input.purpose,
          data_json:
            input.data === undefined
              ? null
              : ctx.json.encode('login_tokens.data_json', LoginTokenData, input.data),
          created_at: now,
          expires_at: expiresAt,
          used_at: null,
        })
        .execute();
      return { token, expiresAt };
    },

    /**
     * Marks the token used and returns what it was issued for. Succeeds exactly once per token, and
     * never for an expired token or one issued for a different `purpose`.
     */
    async consume(
      token: string,
      now: number,
      purpose?: string,
    ): Promise<ConsumedLoginToken | null> {
      const hash = await sha256Hex(token);
      let update = k
        .updateTable('login_tokens')
        .set({ used_at: now })
        .where('token_hash', '=', hash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', now);
      if (purpose !== undefined) update = update.where('purpose', '=', purpose);
      const r = await update.executeTakeFirst();
      if (rows(r.numUpdatedRows) !== 1) return null;
      const row = await k
        .selectFrom('login_tokens')
        .select(['email', 'purpose', 'data_json'])
        .where('token_hash', '=', hash)
        .executeTakeFirstOrThrow();
      return {
        email: row.email,
        purpose: row.purpose,
        data:
          row.data_json === null
            ? {}
            : ctx.json.decode('login_tokens.data_json', LoginTokenData, row.data_json),
      };
    },

    /** Tokens issued to `email` since `since` (for per-address rate limiting of magic links). */
    async countIssuedSince(email: string, since: number): Promise<number> {
      const row = await k
        .selectFrom('login_tokens')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('email', '=', normalizeEmail(email))
        .where('created_at', '>=', since)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    /** Deletes expired tokens (used or not). */
    async deleteExpired(now: number = ctx.now()): Promise<number> {
      const r = await k
        .deleteFrom('login_tokens')
        .where('expires_at', '<=', now)
        .executeTakeFirst();
      return rows(r.numDeletedRows);
    },
  };
}

export type LoginTokenRepo = ReturnType<typeof loginTokenRepo>;
