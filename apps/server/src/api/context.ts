/** Per-request context for REST handlers: bindings, database, the signed-in player, the clock. */
import type { Db, Player } from '@chain-theorem/db';
import {
  parseCookies,
  serializeCookie,
  sessionCookieName,
  SESSION_TTL_MS,
} from '../auth/cookies.ts';
import type { Env } from '../env.ts';
import { HttpError } from '../http.ts';

export interface Ctx {
  env: Env;
  db: Db;
  now: number;
  /** ISO country of the request (Cloudflare `cf.country`), for the sign-up age (DD-06). */
  country: string | null;
  /** The session token from the cookie, if any. */
  token: string | null;
  /** The signed-in player, resolved lazily. */
  me(): Promise<Player | null>;
  /** The signed-in player or 401. */
  requireMe(): Promise<Player>;
}

export function secureCookies(env: Env): boolean {
  return env.APP_ORIGIN.startsWith('https://');
}

export function sessionCookie(env: Env, token: string, maxAgeMs = SESSION_TTL_MS): string {
  return serializeCookie(sessionCookieName(secureCookies(env)), token, {
    maxAgeMs,
    secure: secureCookies(env),
  });
}

export function makeCtx(req: Request, env: Env, db: Db, now: number): Ctx {
  const cookies = parseCookies(req.headers.get('cookie'));
  const token = cookies.get(sessionCookieName(secureCookies(env))) ?? null;
  const cf = (req as Request & { cf?: { country?: string } }).cf;
  let cached: Promise<Player | null> | null = null;
  const me = () => {
    cached ??= (async () => {
      if (!token || token.length > 128) return null;
      const s = await db.sessions.getValid(token, now);
      return s ? db.players.getById(s.playerId) : null;
    })();
    return cached;
  };
  return {
    env,
    db,
    now,
    country: cf?.country ?? null,
    token,
    me,
    async requireMe() {
      const p = await me();
      if (!p) throw new HttpError(401, 'signed_out');
      return p;
    },
  };
}

export function publicMe(p: Player): {
  id: string;
  name: string;
  level: number;
  xp: number;
  adult: boolean;
} {
  return {
    id: p.id,
    name: p.displayName,
    level: p.level,
    xp: p.xp,
    adult: Date.now() >= p.adultFrom,
  };
}
