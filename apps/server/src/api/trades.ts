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
 */
import type { Player } from '@chain-theorem/db';
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
    const id = crypto.randomUUID();
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
