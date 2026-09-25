/**
 * Spectating routes (M7 7.2; spec 10.4 "delayed, public-projection-only view of live battles").
 *
 * | Method and path                  | Body          | Answer                                          |
 * | -------------------------------- | ------------- | ----------------------------------------------- |
 * | `GET /api/battles/live`          | —             | `LiveBattles { battles, delay }`                |
 * | `POST /api/battles/:id/spectate` | —             | `SpectateTicket`; 404 `not_found`, 409 `full`   |
 * | `GET /api/settings/spectate`     | —             | `SpectateSetting { allow, custom, byDefault }`  |
 * | `PUT /api/settings/spectate`     | `SetSpectate` | `SpectateSetting`                               |
 *
 * Only listed battles can be watched: a public kind (ranked, tournament, challenge zone) whose two
 * players allow spectators when it starts (`battle/spectate.ts`). A battle with a player who blocked
 * the viewer, or whom the viewer blocked, is neither listed for nor watchable by that viewer
 * (R-SEC-011 spirit); it reads as not found, so nobody learns who blocked whom. A spectator ticket
 * lasts 60 seconds and is bound to the account and the battle (R-SEC-006); the socket then gets only
 * spectator projections, a fixed number of plies behind (R-INFO-005, R-SEC-001).
 */
import { SPECTATE } from '@chain-theorem/content';
import { spectatingAllowed, type Player } from '@chain-theorem/db';
import {
  type LiveBattle,
  type LiveBattles,
  SetSpectate,
  type SpectateSetting,
  type SpectateTicket,
} from '@chain-theorem/protocol';
import { signTicket } from '../auth/tickets.ts';
import type { Env } from '../env.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import type { RoomInfo } from '../rooms/battle-room.ts';
import type { Ctx } from './context.ts';

async function roomInfo(env: Env, battleId: string): Promise<RoomInfo> {
  const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
  const res = await stub.fetch('https://room/info');
  return (await res.json()) as RoomInfo;
}

function setting(p: Player, now: number): SpectateSetting {
  return {
    allow: spectatingAllowed(p, now),
    custom: p.spectate !== null,
    byDefault: spectatingAllowed({ spectate: null, adultFrom: p.adultFrom }, now),
  };
}

/** The live entry of a listed battle, or null when it cannot be watched now. */
function liveEntry(id: string, startedAt: number, i: RoomInfo): LiveBattle | null {
  if (i.status !== 'active' || !i.spectate || !i.players || !i.format) return null;
  const s = i.spectate;
  return {
    id,
    format: i.format as LiveBattle['format'],
    kind: s.kind,
    ...(s.bracket !== undefined ? { bracket: s.bracket } : {}),
    ...(s.tournament !== undefined ? { tournament: s.tournament } : {}),
    white: { name: i.players.white.name, level: i.players.white.level },
    black: { name: i.players.black.name, level: i.players.black.level },
    spectators: s.watchers,
    startedAt,
  };
}

export function spectateRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/battles/live', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const rows = await ctx.db.battles.listLive(ctx.now - SPECTATE.listMaxAgeMs, SPECTATE.listLimit);
    const ids = rows.flatMap((b) => [b.whiteId, b.blackId]).filter((x): x is string => !!x);
    const blocked = await ctx.db.safety.blockedAmong(me.id, ids);
    const visible = rows.filter(
      (b) => !(b.whiteId && blocked.has(b.whiteId)) && !(b.blackId && blocked.has(b.blackId)),
    );
    const infos = await Promise.all(visible.map((b) => roomInfo(ctx.env, b.id).catch(() => null)));
    const battles: LiveBattle[] = [];
    visible.forEach((b, k) => {
      const i = infos[k];
      const entry = i ? liveEntry(b.id, b.startedAt, i) : null;
      if (entry) battles.push(entry);
    });
    return json({ battles, delay: SPECTATE.delayPlies } satisfies LiveBattles);
  });

  r.add('POST', '/api/battles/:id/spectate', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const battleId = params.id ?? '';
    if (battleId.length < 1 || battleId.length > 64) throw new HttpError(404, 'not_found');
    const row = await ctx.db.battles.get(battleId);
    if (!row?.listed || row.result !== null) throw new HttpError(404, 'not_found');
    const others = [row.whiteId, row.blackId].filter((x): x is string => !!x);
    if ((await ctx.db.safety.blockedAmong(me.id, others)).size > 0)
      throw new HttpError(404, 'not_found');
    const entry = liveEntry(battleId, row.startedAt, await roomInfo(ctx.env, battleId));
    if (!entry) throw new HttpError(404, 'not_found');
    if (entry.spectators >= SPECTATE.maxPerRoom) throw new HttpError(409, 'full');
    const token = await signTicket(ctx.env.AUTH_SECRET, me.id, `spectate:${battleId}`, ctx.now);
    return json({
      battleId,
      token,
      url: `/ws/spectate/${encodeURIComponent(battleId)}?t=${encodeURIComponent(token)}`,
    } satisfies SpectateTicket);
  });

  r.add('GET', '/api/settings/spectate', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json(setting(me, ctx.now));
  });

  r.add('PUT', '/api/settings/spectate', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { allow } = await body(req, SetSpectate);
    await ctx.db.players.setSpectate(me.id, allow);
    return json(setting({ ...me, spectate: allow }, ctx.now));
  });
}
