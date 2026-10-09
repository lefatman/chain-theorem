/**
 * Alpha guest play (spec 9.6, R-FMT-007; DD-107): one-time-code battles between people without
 * accounts, at a level the creator picks, with every card and item at or below that level allowed.
 * Enabled by `ALPHA_GUEST_PLAY=on`; every route answers 404 otherwise.
 *
 * - `GET  /api/alpha/me`            who the alpha routes see (a guest from the cookie, or a player)
 * - `POST /api/alpha/guest`         a new guest identity, 24 hours, in an HttpOnly cookie (rate-limited)
 * - `POST /api/alpha/battles`       open a lobby `a-<code>` at a level with a loadout legal there
 * - `GET  /api/alpha/:code`         the lobby's format, level and creator, and whether it is open
 * - `POST /api/alpha/:code/accept`  join with a loadout legal at the lobby's level; colours random
 * - `POST /api/alpha/battles/:id/ticket`  a fresh socket ticket for a seated identity (rejoin)
 *
 * An alpha battle leaves nothing behind: no `battles` row, no XP, rewards, rating, drops or zone
 * marker (origin kind `alpha`, BattleRoom); it is never listed for spectators. A code is single use:
 * the lobby becomes the battle on the first accept and closes after ALPHA_LOBBY_TTL_MS unused.
 */
import { CAPS, engine } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import {
  AlphaAccept,
  AlphaCreate,
  type AlphaCreated,
  type AlphaIdentity,
  type AlphaInfo,
  type AlphaMe,
} from '@chain-theorem/protocol';
import type { SeatInit } from '../battle/index.ts';
import {
  ALPHA_LOBBY_TTL_MS,
  GUEST_TTL_MS,
  GUEST_WINDOW_MS,
  GUESTS_PER_WINDOW,
  WindowLimiter,
  alphaCookieName,
  alphaEnabled,
  guestName,
  isAlphaBattleId,
  newGuestId,
  signGuest,
  verifyGuest,
} from '../alpha/guest.ts';
import { parseCookies, serializeCookie } from '../auth/cookies.ts';
import type { Env } from '../env.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import type { LobbyInit } from '../rooms/init.ts';
import { battleTicket, info, newCode, room } from './battles.ts';
import { secureCookies, type Ctx } from './context.ts';

const CODE = /^[A-Za-z0-9]{6,16}$/;
/** Guest creations per address (per isolate; DD-107). */
const guestLimiter = new WindowLimiter(GUESTS_PER_WINDOW, GUEST_WINDOW_MS);

function requireAlpha(env: Env): void {
  if (!alphaEnabled(env)) throw new HttpError(404, 'not_found');
}

/** The guest of the alpha cookie, else the signed-in player, else null. */
async function identity(req: Request, ctx: Ctx): Promise<AlphaIdentity | null> {
  const token = parseCookies(req.headers.get('cookie')).get(
    alphaCookieName(secureCookies(ctx.env)),
  );
  if (token && token.length <= 1024) {
    const id = await verifyGuest(ctx.env.AUTH_SECRET, token, ctx.now);
    if (id) return { id, name: guestName(id), guest: true };
  }
  const me = await ctx.me();
  return me ? { id: me.id, name: me.displayName, guest: false } : null;
}

async function requireIdentity(req: Request, ctx: Ctx): Promise<AlphaIdentity> {
  const who = await identity(req, ctx);
  if (!who) throw new HttpError(401, 'signed_out');
  return who;
}

/**
 * A loadout legal at `level` with the whole catalogue available: R-LOAD-004 without the ownership
 * rule (no collection to check; the level requirements, slot costs, capacities and exclusions still
 * apply, and so does the retired check).
 */
function legalAt(loadout: Loadout, level: number): Loadout {
  const v = engine.validateLoadout(loadout, { level });
  if (!v.ok) throw new HttpError(400, 'invalid_loadout');
  return loadout;
}

function clientKey(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'local';
}

export function alphaRoutes(r: Router<Ctx>): void {
  // Before `/api/alpha/:code`: the router takes the first route whose segments match.
  r.add('GET', '/api/alpha/me', async (req, ctx) => {
    const enabled = alphaEnabled(ctx.env);
    return json({ enabled, me: enabled ? await identity(req, ctx) : null } satisfies AlphaMe);
  });

  r.add('POST', '/api/alpha/guest', async (req, ctx) => {
    requireAlpha(ctx.env);
    if (!guestLimiter.hit(clientKey(req), ctx.now)) throw new HttpError(429, 'rate_limited');
    const id = newGuestId();
    const token = await signGuest(ctx.env.AUTH_SECRET, id, ctx.now);
    const secure = secureCookies(ctx.env);
    return json({ me: { id, name: guestName(id), guest: true } satisfies AlphaIdentity }, 200, {
      'set-cookie': serializeCookie(alphaCookieName(secure), token, {
        maxAgeMs: GUEST_TTL_MS,
        secure,
      }),
    });
  });

  r.add('POST', '/api/alpha/battles', async (req, ctx) => {
    requireAlpha(ctx.env);
    const who = await requireIdentity(req, ctx);
    const input = await body(req, AlphaCreate);
    if (input.level > CAPS.LEVEL_CAP) throw new HttpError(400, 'bad_level');
    const loadout = legalAt(input.loadout as Loadout, input.level);
    const code = newCode();
    const battleId = `a-${code}`;
    const lobby: LobbyInit = {
      battleId,
      format: input.format,
      code,
      creator: { playerId: who.id, name: who.name, level: input.level, loadout },
      alpha: { level: input.level, expiresAt: ctx.now + ALPHA_LOBBY_TTL_MS },
    };
    const res = await room(ctx.env, battleId).fetch('https://room/lobby', {
      method: 'POST',
      body: JSON.stringify(lobby),
    });
    if (!res.ok) throw new HttpError(409, 'try_again');
    return json({
      code,
      url: `${ctx.env.APP_ORIGIN}/#/alpha?c=${code}`,
      ticket: await battleTicket(ctx, who.id, battleId),
    } satisfies AlphaCreated);
  });

  r.add('POST', '/api/alpha/battles/:id/ticket', async (req, ctx, params) => {
    requireAlpha(ctx.env);
    const who = await requireIdentity(req, ctx);
    const battleId = params.id ?? '';
    if (!isAlphaBattleId(battleId)) throw new HttpError(404, 'not_found');
    const i = await info(ctx.env, battleId);
    const seated =
      i.creator?.playerId === who.id ||
      i.players?.white.playerId === who.id ||
      i.players?.black.playerId === who.id;
    if (!seated) throw new HttpError(404, 'not_found');
    return json(await battleTicket(ctx, who.id, battleId));
  });

  r.add('GET', '/api/alpha/:code', async (_req, ctx, params) => {
    requireAlpha(ctx.env);
    const code = params.code ?? '';
    if (!CODE.test(code)) throw new HttpError(404, 'not_found');
    const i = await info(ctx.env, `a-${code}`);
    if (i.status === 'empty' || !i.format || !i.alpha) throw new HttpError(404, 'not_found');
    const from = i.creator ?? (i.players ? i.players.white : null);
    return json({
      format: i.format as AlphaInfo['format'],
      level: i.level ?? from?.level ?? 1,
      from: { name: from?.name ?? '?' },
      open: i.status === 'lobby',
    } satisfies AlphaInfo);
  });

  r.add('POST', '/api/alpha/:code/accept', async (req, ctx, params) => {
    requireAlpha(ctx.env);
    const who = await requireIdentity(req, ctx);
    const input = await body(req, AlphaAccept);
    const code = params.code ?? '';
    if (!CODE.test(code)) throw new HttpError(404, 'not_found');
    const battleId = `a-${code}`;
    const i = await info(ctx.env, battleId);
    if (i.status !== 'lobby' || !i.alpha || i.level === undefined)
      throw new HttpError(409, 'challenge_closed');
    // The lobby's level is the battle's level for both sides (9.6).
    const loadout = legalAt(input.loadout as Loadout, i.level);
    const res = await room(ctx.env, battleId).fetch('https://room/join', {
      method: 'POST',
      body: JSON.stringify({
        playerId: who.id,
        name: who.name,
        level: i.level,
        loadout,
      } satisfies SeatInit),
    });
    if (!res.ok)
      throw new HttpError(
        res.status,
        ((await res.json()) as { error?: string }).error ?? 'challenge_closed',
      );
    return json(await battleTicket(ctx, who.id, battleId));
  });
}
