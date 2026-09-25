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
import { verifyTicket } from './auth/tickets.ts';
import { getDb, releaseDb } from './db.ts';
import type { Env } from './env.ts';
import { HttpError, Router, checkOrigin, errorResponse, json } from './http.ts';

export { BattleRoom } from './rooms/battle-room.ts';
export { Matchmaker } from './rooms/matchmaker.ts';

const router = new Router<Ctx>();
authRoutes(router);
accountRoutes(router);
battleRoutes(router);

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

/** `/ws/battle/:id?t=` and `/ws/queue/:format/:loadoutId?t=`: check the ticket, then hand over. */
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
    const headers = new Headers(req.headers);
    headers.set('x-player-id', player);
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
    return stub.fetch(new Request('https://room/ws', { headers }));
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
    if (path.startsWith('/api/')) return api(req, env);
    if (path.startsWith('/ws/')) return socket(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
