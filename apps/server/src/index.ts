/**
 * Worker entry (M4, ARCHITECTURE 6): REST under /api, WebSocket upgrades under /ws (ticket-checked,
 * R-SEC-006), everything else is the static client (Workers Static Assets). Durable Object classes
 * are exported from here.
 */
import { engine } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import { makeCtx, type Ctx } from './api/context.ts';
import { authRoutes } from './api/auth.ts';
import { accountRoutes, viewLoadouts } from './api/account.ts';
import { battleRoutes } from './api/battles.ts';
import { spectateRoutes } from './api/spectate.ts';
import { socialRoutes } from './api/social.ts';
import { worldRoutes, zoneSocket } from './api/world.ts';
import { guildRoutes } from './api/guilds.ts';
import { rankedRoutes, rankedSocket } from './api/ranked.ts';
import { tradeRoutes } from './api/trades.ts';
import { safetyRoutes } from './api/safety.ts';
import { adminRoutes } from './api/admin.ts';
import { tournamentRoutes } from './api/tournaments.ts';
import { isSuspended } from './moderation/sanctions.ts';
import { refusePlay } from './billing/gate.ts';
import { billingRoutes } from './billing/routes.ts';
import { verifyTicket } from './auth/tickets.ts';
import { getDb, releaseDb } from './db.ts';
import type { Env } from './env.ts';
import { HttpError, Router, checkOrigin, errorResponse, json } from './http.ts';

export { BattleRoom } from './rooms/battle-room.ts';
export { Matchmaker } from './rooms/matchmaker.ts';
export { Metrics } from './rooms/metrics.ts';
export { ZoneRoom } from './rooms/zone-room.ts';
export { GuildRoom } from './rooms/guild-room.ts';
export { TradeSession } from './rooms/trade-session.ts';
export { TournamentRoom } from './rooms/tournament-room.ts';

const router = new Router<Ctx>();
authRoutes(router);
accountRoutes(router);
battleRoutes(router);
spectateRoutes(router);
socialRoutes(router);
worldRoutes(router);
rankedRoutes(router);
guildRoutes(router);
tradeRoutes(router);
billingRoutes(router);
safetyRoutes(router);
adminRoutes(router);
tournamentRoutes(router);

const FORMATS = new Set(Object.keys(engine.caps.FORMATS));

async function api(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const db = await getDb(env);
  try {
    checkOrigin(req, env.APP_ORIGIN);
    const m = router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, 'not_found');
    return await m.h(req, makeCtx(req, env, db, Date.now()), m.params);
  } catch (e) {
    return errorResponse(e);
  } finally {
    await releaseDb(env, db);
  }
}

/**
 * A suspended player's socket upgrade is refused even with a ticket issued before the suspension
 * (tickets live 60 s; M6 6.4, R-SEC-006). The zone, queue and ranked upgrades check it with the
 * entitlement (`refusePlay`).
 */
async function refuseSuspended(env: Env, playerId: string, now: number): Promise<Response | null> {
  const db = await getDb(env);
  try {
    const p = await db.players.getById(playerId);
    if (!p) return json({ error: 'not_found' }, 404);
    return isSuspended(p, now) ? json({ error: 'suspended' }, 403) : null;
  } finally {
    await releaseDb(env, db);
  }
}

/**
 * `/ws/battle/:id?t=`, `/ws/queue/:format/:loadoutId?t=`, `/ws/ranked/:format/:loadoutId?t=` (M6),
 * `/ws/zone/:zone?t=`, `/ws/trade/:id?t=` and `/ws/spectate/:id?t=` (M7): check the ticket, then hand
 * over.
 */
async function socket(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'expected_websocket' }, 426);
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const token = url.searchParams.get('t') ?? '';
  const now = Date.now();
  if (parts[1] === 'battle' && parts.length === 3) {
    const battleId = parts[2] as string;
    const player = await verifyTicket(env.AUTH_SECRET, token, `battle:${battleId}`, now);
    if (!player) return json({ error: 'bad_ticket' }, 403);
    const refused = await refuseSuspended(env, player, now);
    if (refused) return refused;
    const headers = new Headers(req.headers);
    headers.set('x-player-id', player);
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
    return stub.fetch(new Request('https://room/ws', { headers }));
  }
  if (parts[1] === 'spectate' && parts.length === 3) {
    // M7 7.2: a read-only spectator socket (R-SEC-006: the ticket is bound to the player and battle).
    const battleId = parts[2] as string;
    const player = await verifyTicket(env.AUTH_SECRET, token, `spectate:${battleId}`, now);
    if (!player) return json({ error: 'bad_ticket' }, 403);
    const refused = await refuseSuspended(env, player, now);
    if (refused) return refused;
    const headers = new Headers(req.headers);
    headers.set('x-player-id', player);
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
    return stub.fetch(new Request('https://room/spectate', { headers }));
  }
  if (parts[1] === 'trade' && parts.length === 3) {
    // M6 6.1: a trade or wager session (R-SEC-006: the ticket is bound to the player and trade).
    const tradeId = parts[2] as string;
    const player = await verifyTicket(env.AUTH_SECRET, token, `trade:${tradeId}`, now);
    if (!player) return json({ error: 'bad_ticket' }, 403);
    const refused = await refuseSuspended(env, player, now);
    if (refused) return refused;
    const headers = new Headers(req.headers);
    headers.set('x-player-id', player);
    const stub = env.TRADE_SESSION.get(env.TRADE_SESSION.idFromName(tradeId));
    return stub.fetch(new Request('https://trade/ws', { headers }));
  }
  if (parts[1] === 'zone' && parts.length === 3) {
    const db = await getDb(env);
    try {
      return await zoneSocket(req, env, db, parts[2] as string, token, now);
    } finally {
      await releaseDb(env, db);
    }
  }
  if (parts[1] === 'ranked' && parts.length === 4) {
    // M6 6.2: `/ws/ranked/:format/:loadoutId?t=` (R-FMT-004).
    const db = await getDb(env);
    try {
      return await rankedSocket(req, env, db, parts[2] as string, parts[3] as string, token, now);
    } finally {
      await releaseDb(env, db);
    }
  }
  if (parts[1] === 'queue' && parts.length === 4) {
    const format = parts[2] as string;
    const loadoutId = parts[3] as string;
    if (!FORMATS.has(format)) return json({ error: 'not_found' }, 404);
    const player = await verifyTicket(env.AUTH_SECRET, token, `queue:${format}:${loadoutId}`, now);
    if (!player) return json({ error: 'bad_ticket' }, 403);
    // Re-check the loadout at connect time: the ticket is 60 s old at most, but the collection is live.
    const db = await getDb(env);
    try {
      const me = await db.players.getById(player);
      const row = me ? (await db.loadouts.list(me.id)).find((l) => l.id === loadoutId) : undefined;
      if (!me || !row) return json({ error: 'not_found' }, 404);
      // Entitlement is re-read at connect too (14.4, R-SEC-007): the trial may have just ended.
      const refused = refusePlay(me, now);
      if (refused) return refused;
      const ctx = makeCtx(req, env, db, now);
      const [view] = await viewLoadouts(ctx, me.id, me.level, [row]);
      if (!view?.valid) return json({ error: 'invalid_loadout' }, 400);
      const headers = new Headers(req.headers);
      headers.set(
        'x-waiter',
        JSON.stringify({
          id: me.id,
          name: me.displayName,
          level: me.level,
          loadout: view.loadout as Loadout,
          format,
        }),
      );
      const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(format));
      return stub.fetch(new Request('https://queue/ws', { headers }));
    } finally {
      await releaseDb(env, db);
    }
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req, env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/') || path === '/admin' || path.startsWith('/admin/'))
      return api(req, env);
    if (path.startsWith('/ws/')) return socket(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
