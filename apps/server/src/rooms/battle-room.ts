/**
 * BattleRoom Durable Object (M4 4.2, 12.2): one instance per battle. It wraps the pure BattleCore:
 * sockets use the Hibernation API, clocks use Alarms, and every change is written to the object's own
 * storage before anything is sent (snapshot plus append-only log records), so an evicted room resumes
 * exactly. Clients only ever receive what the core produced for their side (R-SEC-001).
 *
 * A challenge-link battle starts as a lobby holding its creator; `POST /join` seats the second player
 * and starts the battle.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Side } from '@chain-theorem/rules';
import {
  BattleCore,
  type BattleInit,
  type BattleSnapshot,
  type LogRecord,
  type Outbox,
  type SeatInit,
} from '../battle/index.ts';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import { assignColours, type LobbyInit } from './init.ts';

interface Attachment {
  side: Side | 'lobby';
  playerId: string;
}

const REC = 'rec:';
const pad = (n: number) => String(n).padStart(8, '0');

function playerOf(seat: SeatInit): string | null {
  return 'playerId' in seat ? seat.playerId : null;
}

export interface RoomInfo {
  status: 'empty' | 'lobby' | 'active' | 'ended';
  format?: string;
  code?: string;
  creator?: { name: string; level: number; playerId: string };
  players?: Record<Side, { name: string; level: number; playerId: string | null }>;
}

export class BattleRoom extends DurableObject<Env> {
  private core: BattleCore | null = null;
  private lobby: LobbyInit | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    this.lobby = (await this.ctx.storage.get<LobbyInit>('lobby')) ?? null;
    const snap = await this.ctx.storage.get<BattleSnapshot>('snap');
    if (!snap) return;
    const recs = await this.ctx.storage.list<LogRecord>({ prefix: REC });
    const core = BattleCore.restore(snap, [...recs.values()]);
    this.core = core;
    // After a restart (a deploy, an eviction without hibernation) the sockets are gone although the
    // snapshot still marks the sides connected: start their disconnect grace now (9.2).
    if (snap.endedAt !== null) return;
    const now = Date.now();
    for (const side of ['white', 'black'] as const) {
      if (
        snap.conn[side].connected &&
        'playerId' in snap.seats[side] &&
        this.ctx.getWebSockets(side).length === 0
      )
        await this.deliver(core.disconnect(side, now));
    }
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('upgrade') === 'websocket') return this.accept(req);
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /init':
        return this.init((await req.json()) as BattleInit);
      case 'POST /lobby':
        return this.openLobby((await req.json()) as LobbyInit);
      case 'POST /join':
        return this.join((await req.json()) as SeatInit);
      case 'GET /info':
        return Response.json(this.info());
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private info(): RoomInfo {
    if (this.core) {
      const s = this.core.snapshot();
      const tag = (seat: SeatInit) => ({
        name: seat.name,
        level: seat.level,
        playerId: playerOf(seat),
      });
      return {
        status: s.endedAt === null ? 'active' : 'ended',
        format: s.format,
        players: { white: tag(s.seats.white), black: tag(s.seats.black) },
      };
    }
    if (this.lobby) {
      const c = this.lobby.creator;
      return {
        status: 'lobby',
        format: this.lobby.format,
        code: this.lobby.code,
        creator: { name: c.name, level: c.level, playerId: c.playerId },
      };
    }
    return { status: 'empty' };
  }

  private async init(init: BattleInit): Promise<Response> {
    if (this.core) return new Response('exists', { status: 409 });
    const now = Date.now();
    let started: { core: BattleCore; out: Outbox };
    try {
      started = BattleCore.create(init, now);
    } catch (e) {
      return new Response(`bad init: ${String(e)}`, { status: 400 });
    }
    this.core = started.core;
    const db = await getDb(this.env);
    try {
      await db.battles.create({
        id: init.battleId,
        format: init.format,
        whiteId: playerOf(init.white),
        blackId: playerOf(init.black),
        startedAt: now,
      });
    } finally {
      await releaseDb(this.env, db);
    }
    await this.deliver(started.out);
    return new Response('ok');
  }

  private async openLobby(lobby: LobbyInit): Promise<Response> {
    if (this.core || this.lobby) return new Response('exists', { status: 409 });
    this.lobby = lobby;
    await this.ctx.storage.put('lobby', lobby);
    return new Response('ok');
  }

  private async join(seat: SeatInit): Promise<Response> {
    const lobby = this.lobby;
    if (!lobby || this.core) return Response.json({ error: 'challenge_closed' }, { status: 409 });
    if (playerOf(seat) === lobby.creator.playerId)
      return Response.json({ error: 'own_challenge' }, { status: 409 });
    const { white, black } = assignColours<SeatInit>(lobby.creator, seat);
    const res = await this.init({ battleId: lobby.battleId, format: lobby.format, white, black });
    if (!res.ok) return Response.json({ error: 'invalid_loadout' }, { status: 400 });
    this.lobby = null;
    await this.ctx.storage.delete('lobby');
    // The creator's waiting socket reconnects and says hello to the started battle.
    for (const ws of this.ctx.getWebSockets('lobby')) ws.close(4001, 'started');
    return Response.json({ battleId: lobby.battleId });
  }

  /** Worker → upgrade with the verified player id in `x-player-id` (ticket checked, R-SEC-006). */
  private accept(req: Request): Response {
    const playerId = req.headers.get('x-player-id');
    if (!playerId) return new Response('missing player', { status: 400 });
    let side: Side | 'lobby' | null = null;
    if (this.core) {
      const seats = this.core.snapshot().seats;
      side =
        playerOf(seats.white) === playerId
          ? 'white'
          : playerOf(seats.black) === playerId
            ? 'black'
            : null;
    } else if (this.lobby?.creator.playerId === playerId) side = 'lobby';
    if (!side) return new Response('not a player of this battle', { status: 403 });
    // One socket per seat: a new tab replaces the old one.
    for (const old of this.ctx.getWebSockets(side)) old.close(4000, 'replaced');
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [side]);
    server.serializeAttachment({ side, playerId } satisfies Attachment);
    if (side !== 'lobby' && this.core) {
      const out = this.core.connect(side, Date.now());
      void this.ctx.blockConcurrencyWhile(() => this.deliver(out));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.side === 'lobby' || !this.core) return;
    const raw = typeof message === 'string' ? message : '';
    await this.deliver(this.core.message(a.side, raw, Date.now()));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
    await this.gone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  /** A socket went away: the side is disconnected unless another socket of it is still open. */
  private async gone(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.side === 'lobby' || !this.core) return;
    const others = this.ctx
      .getWebSockets(a.side)
      .filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (others.length > 0) return;
    await this.deliver(this.core.disconnect(a.side, Date.now()));
  }

  override async alarm(): Promise<void> {
    if (!this.core) return;
    await this.deliver(this.core.alarm(Date.now()));
  }

  /**
   * Persist first (log records and snapshot in one atomic put), then send, then run effects, then
   * re-arm the alarm for the next clock or grace deadline.
   */
  private async deliver(out: Outbox): Promise<void> {
    const core = this.core;
    if (!core) return;
    const writes: Record<string, unknown> = {};
    for (const e of out.effects)
      if (e.kind === 'persist') writes[`${REC}${pad(e.record.n)}`] = e.record;
    if (out.save || Object.keys(writes).length > 0) writes.snap = core.snapshot();
    if (Object.keys(writes).length > 0) await this.ctx.storage.put(writes);

    for (const { to, msg } of out.send) {
      const data = JSON.stringify(msg);
      for (const ws of this.ctx.getWebSockets(to)) {
        try {
          ws.send(data);
        } catch {
          /* closed meanwhile */
        }
      }
    }

    for (const e of out.effects) {
      if (e.kind === 'close') {
        for (const ws of this.ctx.getWebSockets(e.side)) ws.close(e.code, e.reason);
        await this.deliver(core.disconnect(e.side, Date.now()));
      } else if (e.kind === 'ended') {
        const key = `battles/${e.summary.battleId}.json`;
        await this.env.BATTLE_LOGS.put(key, JSON.stringify(e.archive), {
          httpMetadata: { contentType: 'application/json' },
        });
        const db = await getDb(this.env);
        try {
          const w = e.summary.result.winner;
          await db.battles.finish(e.summary.battleId, {
            result: w ?? 'draw',
            reason: e.summary.result.reason,
            endedAt: e.summary.endedAt,
            logKey: key,
          });
        } finally {
          await releaseDb(this.env, db);
        }
      } else if (e.kind === 'error') console.error(`battle ${core.battleId}: ${e.message}`);
    }

    const next = core.nextAlarm();
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}
