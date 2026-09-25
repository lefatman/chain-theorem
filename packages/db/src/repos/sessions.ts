/**
 * Sessions (R-SEC-006). The cookie carries a random 32-byte token; the database stores only its
 * SHA-256 hash, so a database leak does not leak live sessions.
 */
import { randomToken, sha256Hex, uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';

export interface Session {
  id: string;
  playerId: string;
  createdAt: number;
  expiresAt: number;
}

export function sessionRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  return {
    /** Creates a session and returns the raw token (for the cookie) once; only its hash is stored. */
    async create(
      playerId: string,
      opts: { ttlMs: number; now?: number },
    ): Promise<{ token: string; session: Session }> {
      if (!(opts.ttlMs > 0)) throw new RangeError('ttlMs must be positive');
      const now = opts.now ?? ctx.now();
      const token = randomToken(32);
      const session: Session = {
        id: uuidv7(now),
        playerId,
        createdAt: now,
        expiresAt: now + opts.ttlMs,
      };
      await k
        .insertInto('sessions')
        .values({
          id: session.id,
          player_id: playerId,
          token_hash: await sha256Hex(token),
          created_at: now,
          expires_at: session.expiresAt,
        })
        .execute();
      return { token, session };
    },

    /** The session for a token if it exists and has not expired at `now`. */
    async getValid(token: string, now: number = ctx.now()): Promise<Session | null> {
      const row = await k
        .selectFrom('sessions')
        .select(['id', 'player_id', 'created_at', 'expires_at'])
        .where('token_hash', '=', await sha256Hex(token))
        .where('expires_at', '>', now)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            playerId: row.player_id,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          }
        : null;
    },

    /** Sign-out: deletes the session for this token. */
    async delete(token: string): Promise<boolean> {
      const r = await k
        .deleteFrom('sessions')
        .where('token_hash', '=', await sha256Hex(token))
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },

    /** Signs the player out everywhere. */
    async deleteForPlayer(playerId: string): Promise<number> {
      const r = await k.deleteFrom('sessions').where('player_id', '=', playerId).executeTakeFirst();
      return rows(r.numDeletedRows);
    },

    async deleteExpired(now: number = ctx.now()): Promise<number> {
      const r = await k.deleteFrom('sessions').where('expires_at', '<=', now).executeTakeFirst();
      return rows(r.numDeletedRows);
    },
  };
}

export type SessionRepo = ReturnType<typeof sessionRepo>;
