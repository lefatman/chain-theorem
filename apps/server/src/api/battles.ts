/**
 * Battle routes (M4 4.2, 4.3): NPC battles, challenge links, queue tickets and socket tickets. A
 * socket ticket lasts 60 seconds and is bound to the player and the room (R-SEC-006); only players of
 * a battle get one.
 */
import { npcBuild } from '@chain-theorem/content/npcs';
import {
  AcceptChallenge,
  CreateBattle,
  JoinQueue,
  type BattleTicket,
} from '@chain-theorem/protocol';
import type { SeatInit } from '../battle/index.ts';
import { randomToken } from '../auth/crypto.ts';
import { signTicket } from '../auth/tickets.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import { assignColours, type LobbyInit } from '../rooms/init.ts';
import type { RoomInfo } from '../rooms/battle-room.ts';
import type { Env } from '../env.ts';
import { legalLoadout } from './account.ts';
import type { Ctx } from './context.ts';

function room(env: Env, battleId: string): DurableObjectStub {
  return env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
}

export async function battleTicket(
  ctx: Ctx,
  playerId: string,
  battleId: string,
): Promise<BattleTicket> {
  const token = await signTicket(ctx.env.AUTH_SECRET, playerId, `battle:${battleId}`, ctx.now);
  return {
    battleId,
    token,
    url: `/ws/battle/${encodeURIComponent(battleId)}?t=${encodeURIComponent(token)}`,
  };
}

async function info(env: Env, battleId: string): Promise<RoomInfo> {
  const res = await room(env, battleId).fetch('https://room/info');
  return (await res.json()) as RoomInfo;
}

/** Challenge codes: 10 base62-ish characters (about 60 bits); the battle id is `c-<code>`. */
function newCode(): string {
  return randomToken(8).replace(/[-_]/g, 'x').slice(0, 10);
}

export function battleRoutes(r: Router<Ctx>): void {
  r.add('POST', '/api/battles', async (req, ctx) => {
    const input = await body(req, CreateBattle);
    const mine = await legalLoadout(ctx, input.loadoutId);
    const me: SeatInit = {
      playerId: mine.playerId,
      name: mine.name,
      level: mine.level,
      loadout: mine.loadout,
    };
    if (input.kind === 'npc') {
      const battleId = crypto.randomUUID();
      const seed = new Uint32Array(1);
      crypto.getRandomValues(seed);
      const npc = npcBuild(input.tier, mine.level, seed[0] ?? 0);
      const them: SeatInit = {
        tier: input.tier,
        name: npc.name,
        level: npc.level,
        loadout: npc.loadout,
      };
      const { white, black } = assignColours<SeatInit>(me, them);
      const res = await room(ctx.env, battleId).fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({
          battleId,
          format: input.format,
          white,
          black,
          origin: { kind: 'npc', tier: input.tier },
        }),
      });
      if (!res.ok) throw new HttpError(400, 'invalid_loadout');
      return json(await battleTicket(ctx, mine.playerId, battleId));
    }
    const code = newCode();
    const battleId = `c-${code}`;
    const lobby: LobbyInit = {
      battleId,
      format: input.format,
      code,
      creator: {
        playerId: mine.playerId,
        name: mine.name,
        level: mine.level,
        loadout: mine.loadout,
      },
    };
    const res = await room(ctx.env, battleId).fetch('https://room/lobby', {
      method: 'POST',
      body: JSON.stringify(lobby),
    });
    if (!res.ok) throw new HttpError(409, 'try_again');
    return json({
      code,
      url: `${ctx.env.APP_ORIGIN}/#/online?c=${code}`,
      ticket: await battleTicket(ctx, mine.playerId, battleId),
    });
  });

  r.add('GET', '/api/challenges/:code', async (_req, ctx, params) => {
    await ctx.requireMe();
    const code = params.code ?? '';
    if (!/^[A-Za-z0-9]{6,16}$/.test(code)) throw new HttpError(404, 'not_found');
    const i = await info(ctx.env, `c-${code}`);
    if (i.status === 'empty' || !i.format) throw new HttpError(404, 'not_found');
    const from = i.creator ?? (i.players ? i.players.white : null);
    return json({
      format: i.format,
      from: { name: from?.name ?? '?', level: from?.level ?? 1 },
      open: i.status === 'lobby',
    });
  });

  r.add('POST', '/api/challenges/:code/accept', async (req, ctx, params) => {
    const { loadoutId } = await body(req, AcceptChallenge);
    const code = params.code ?? '';
    const mine = await legalLoadout(ctx, loadoutId);
    const battleId = `c-${code}`;
    const res = await room(ctx.env, battleId).fetch('https://room/join', {
      method: 'POST',
      body: JSON.stringify({
        playerId: mine.playerId,
        name: mine.name,
        level: mine.level,
        loadout: mine.loadout,
      } satisfies SeatInit),
    });
    if (!res.ok)
      throw new HttpError(
        res.status,
        ((await res.json()) as { error?: string }).error ?? 'challenge_closed',
      );
    return json(await battleTicket(ctx, mine.playerId, battleId));
  });

  r.add('POST', '/api/queue/ticket', async (req, ctx) => {
    const { format, loadoutId } = await body(req, JoinQueue);
    const mine = await legalLoadout(ctx, loadoutId);
    const roomName = `queue:${format}:${loadoutId}`;
    const token = await signTicket(ctx.env.AUTH_SECRET, mine.playerId, roomName, ctx.now);
    return json({
      url: `/ws/queue/${format}/${encodeURIComponent(loadoutId)}?t=${encodeURIComponent(token)}`,
    });
  });

  r.add('POST', '/api/battles/:id/ticket', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const battleId = params.id ?? '';
    if (battleId.length > 64) throw new HttpError(404, 'not_found');
    const i = await info(ctx.env, battleId);
    const seated =
      i.creator?.playerId === me.id ||
      i.players?.white.playerId === me.id ||
      i.players?.black.playerId === me.id;
    if (!seated) throw new HttpError(404, 'not_found');
    return json(await battleTicket(ctx, me.id, battleId));
  });

  r.add('GET', '/api/battles/active', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const rows = await ctx.db.battles.listActiveForPlayer(me.id);
    const out: { id: string; format: string; opponent: string }[] = [];
    for (const b of rows.slice(0, 5)) {
      const i = await info(ctx.env, b.id);
      if (i.status !== 'active' || !i.players) continue;
      const opp = i.players.white.playerId === me.id ? i.players.black : i.players.white;
      out.push({ id: b.id, format: b.format, opponent: opp.name });
    }
    return json({ battles: out });
  });
}
