/**
 * Trade and wager routes (M6 6.1; spec 10.4, 9.5, 14.4). A trade or wager starts as an invitation
 * to a player in the world: the TradeSession is created, the invitee is told through their zone
 * channel (`tradeIn`), and each player opens the session socket with a 60 s ticket bound to them and
 * `trade:<id>` (R-SEC-006). Only subscribers trade or wager: trial accounts cannot, so they cannot
 * farm items for other accounts (14.4, R-COST-005); the TradeSession checks again when it runs.
 *
 * | Method and path                   | Body         | Answer                                     |
 * | --------------------------------- | ------------ | ------------------------------------------ |
 * | `GET /api/trades/access`          | —            | `TradeAccess { allowed, reason }`          |
 * | `POST /api/trades`                | `StartTrade` | `TradeTicket { id, mode, url }` (inviter)  |
 * | `POST /api/trades/:id/ticket`     | —            | `TradeTicket` (either player; reconnects)  |
 * | `POST /api/trades/:id/decline`    | —            | `204` (either player ends the session)     |
 *
 * M6 6.4: one invitation waiting for an answer per inviter and a small per-minute cap (config
 * `TRADE_INVITES`; 429 `too_many_invites`), counted from the `trade.invite` audit entries (each
 * invitation is logged for both players, for support and fraud review, 10.4). A blocked pair (either
 * way) is refused exactly like an offline invitee (409 `not_online`, R-SEC-011).
 */
import { TRADE_INVITES } from '@chain-theorem/content';
import type { Db, Player } from '@chain-theorem/db';
import {
  StartTrade,
  type TradeAccess,
  type TradeMode,
  type TradeTicket,
} from '@chain-theorem/protocol';
import { signTicket } from '../auth/tickets.ts';
import { access, canTrade } from '../billing/entitlement.ts';
import type { Env } from '../env.ts';
import { HttpError, body, json, noContent, type Router } from '../http.ts';
import type { TradeInfo } from '../rooms/trade-session.ts';
import { callPlayer } from '../world/routing.ts';
import type { Ctx } from './context.ts';

const OPEN: ReadonlySet<TradeInfo['status']> = new Set(['invited', 'open', 'executing']);

/** Audit kinds of a trade or wager invitation: the inviter's and the invitee's entry. */
export const TRADE_INVITE = 'trade.invite';
export const TRADE_INVITED = 'trade.invited';
/** How long an unanswered invitation can wait (TradeCore INVITE_TTL_MS, with a margin). */
const INVITE_WINDOW_MS = 3 * 60_000;
const MINUTE_MS = 60_000;

/**
 * 429 `too_many_invites` when the inviter already has `TRADE_INVITES.open` invitations waiting for
 * an answer, or sent `TRADE_INVITES.perMinute` in the last minute (M6 6.4).
 */
async function checkInviteLimits(env: Env, db: Db, inviter: string, now: number): Promise<void> {
  const recent = await db.audit.listKinds(inviter, [TRADE_INVITE], now - INVITE_WINDOW_MS, 50);
  if (recent.filter((e) => e.at > now - MINUTE_MS).length >= TRADE_INVITES.perMinute)
    throw new HttpError(429, 'too_many_invites');
  let waiting = 0;
  for (const e of recent) {
    const id = e.payload.trade;
    if (typeof id === 'string' && (await info(env, id)).status === 'invited') waiting++;
    if (waiting >= TRADE_INVITES.open) throw new HttpError(429, 'too_many_invites');
  }
}

function session(env: Env, id: string): DurableObjectStub {
  return env.TRADE_SESSION.get(env.TRADE_SESSION.idFromName(id));
}

/** Why a player may not trade (null when they may). */
export function tradeAccess(p: Player, now: number): TradeAccess {
  if (canTrade(p, now)) return { allowed: true, reason: null };
  return { allowed: false, reason: access(p, now) === 'trial' ? 'trial' : 'expired' };
}

function requireTrader(p: Player, now: number): void {
  const a = tradeAccess(p, now);
  if (!a.allowed)
    throw new HttpError(403, a.reason === 'trial' ? 'trial_account' : 'no_subscription');
}

async function ticket(
  ctx: Ctx,
  playerId: string,
  id: string,
  mode: TradeMode,
): Promise<TradeTicket> {
  const token = await signTicket(ctx.env.AUTH_SECRET, playerId, `trade:${id}`, ctx.now);
  return { id, mode, url: `/ws/trade/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}` };
}

async function info(env: Env, id: string): Promise<TradeInfo> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { status: 'empty' };
  const res = await session(env, id).fetch('https://trade/info');
  return (await res.json()) as TradeInfo;
}

export function tradeRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/trades/access', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json(tradeAccess(me, ctx.now));
  });

  r.add('POST', '/api/trades', async (req, ctx) => {
    const me = await ctx.requireMe();
    const input = await body(req, StartTrade);
    requireTrader(me, ctx.now);
    const them = await ctx.db.players.getById(input.with);
    if (!them || them.id === me.id) throw new HttpError(404, 'not_found');
    if (!canTrade(them, ctx.now)) throw new HttpError(409, 'partner_cannot_trade');
    await checkInviteLimits(ctx.env, ctx.db, me.id, ctx.now);
    const id = crypto.randomUUID();
    // R-SEC-011 (M6 6.4): a blocked pair looks exactly like an invitee who is not online, down to
    // the inviter's audit entry that the per-minute limit counts.
    if (await ctx.db.safety.blockedEither(me.id, them.id)) {
      await ctx.db.audit.append({
        playerId: me.id,
        kind: TRADE_INVITE,
        payload: { trade: id, to: them.id, mode: input.mode },
        at: ctx.now,
      });
      throw new HttpError(409, 'not_online');
    }
    const res = await session(ctx.env, id).fetch('https://trade/init', {
      method: 'POST',
      body: JSON.stringify({
        id,
        mode: input.mode,
        ...(input.format ? { format: input.format } : {}),
        a: { id: me.id, name: me.displayName, level: me.level },
        b: { id: them.id, name: them.displayName, level: them.level },
      }),
    });
    if (!res.ok) throw new HttpError(409, 'try_again');
    // Logged for both players (support and fraud review, 10.4; the invitation limits above).
    await ctx.db.atomic([
      ctx.db.audit.appendStatement({
        playerId: me.id,
        kind: TRADE_INVITE,
        payload: { trade: id, to: them.id, mode: input.mode },
        at: ctx.now,
      }),
      ctx.db.audit.appendStatement({
        playerId: them.id,
        kind: TRADE_INVITED,
        payload: { trade: id, from: me.id, mode: input.mode },
        at: ctx.now,
      }),
    ]);
    // The invitation travels through the invitee's zone channel (they must be in the world).
    const told = await callPlayer(ctx.env, ctx.db, them.id, 'notify', {
      id: them.id,
      msg: { t: 'tradeIn', d: { id, from: me.id, name: me.displayName, mode: input.mode } },
    });
    if (!told) {
      await session(ctx.env, id).fetch('https://trade/cancel', {
        method: 'POST',
        body: JSON.stringify({ playerId: me.id }),
      });
      throw new HttpError(409, 'not_online');
    }
    return json(await ticket(ctx, me.id, id, input.mode));
  });

  r.add('POST', '/api/trades/:id/ticket', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    requireTrader(me, ctx.now);
    const id = params.id ?? '';
    const i = await info(ctx.env, id);
    if (i.status === 'empty' || (i.a !== me.id && i.b !== me.id) || !i.mode)
      throw new HttpError(404, 'not_found');
    if (!OPEN.has(i.status)) throw new HttpError(409, 'closed');
    return json(await ticket(ctx, me.id, id, i.mode));
  });

  r.add('POST', '/api/trades/:id/decline', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const id = params.id ?? '';
    const i = await info(ctx.env, id);
    if (i.status === 'empty' || (i.a !== me.id && i.b !== me.id))
      throw new HttpError(404, 'not_found');
    await session(ctx.env, id).fetch('https://trade/cancel', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id }),
    });
    return noContent();
  });
}
