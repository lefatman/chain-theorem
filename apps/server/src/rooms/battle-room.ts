/**
 * BattleRoom Durable Object (M4 4.2, 12.2): one instance per battle. It wraps the pure BattleCore:
 * sockets use the Hibernation API, clocks use Alarms, and every change is written to the object's own
 * storage before anything is sent (snapshot plus append-only log records), so an evicted room resumes
 * exactly. Clients only ever receive what the core produced for their side (R-SEC-001).
 *
 * A challenge-link battle starts as a lobby holding its creator; `POST /join` seats the second player
 * and starts the battle.
 *
 * The init may carry the battle's origin (a wild encounter, a trainer, a lesson, a challenge, M5); it
 * stays in storage, never reaches a client, and decides the rewards and quest progress when the
 * battle ends (R-SEC-003).
 *
 * M6 6.4: a battle started outside the zone (a wager, a queue, a link) tells each player's zone
 * channel when it starts and ends (`/battle`), so they are marked battling there; `POST /kick`
 * closes a suspended player's socket (R-SEC-006) and the normal disconnect grace takes over.
 *
 * M7 7.2 (10.4): a public battle (ranked, tournament, challenge zone; both players allow it) also
 * accepts read-only spectator sockets (tag `spectator`, at most SPECTATE.maxPerRoom, rate-limited
 * like players). A spectator's only message is `hello`; it gets the core's spectator view of the
 * delayed position and then the delayed spectator events (`Outbox.spectate`), never a player's
 * messages (R-INFO-005, R-SEC-001). Players and spectators are told the spectator count.
 */
import { DurableObject } from 'cloudflare:workers';
import { SPECTATE } from '@chain-theorem/content';
import { spectatingAllowed, type Db } from '@chain-theorem/db';
import {
  type Bucket,
  ClientSpectate,
  LIMITS,
  type LiveKind,
  decode,
  newBucket,
  strike,
  take,
  tooManyStrikes,
} from '@chain-theorem/protocol';
import type { Side } from '@chain-theorem/rules';
import {
  BattleCore,
  CLOSE_POLICY,
  type BattleInit,
  type BattleSnapshot,
  type LogRecord,
  type Outbox,
  type SeatInit,
} from '../battle/index.ts';
import { liveDetails, liveKind } from '../battle/spectate.ts';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import { outsideZone, type BattleOrigin } from '../world/battles.ts';
import { tellZone } from '../world/routing.ts';
import { battleUsage, settleBattle } from '../world/settle.ts';
import { assignColours, type LobbyInit } from './init.ts';
import { metricsStub } from './metrics.ts';

interface Attachment {
  side: Side | 'lobby' | 'spectator';
  playerId: string;
  /** Spectator sockets (M7 7.2): `hello` received, so streamed spectator messages go here. */
  live?: boolean;
  /** Spectator sockets: the rate-limit bucket (R-SEC-005), kept across hibernation. */
  bucket?: Bucket;
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
  /** A public battle (M7 7.2): why it is listed and how many spectators watch it. */
  spectate?: { kind: LiveKind; bracket?: string; tournament?: string; watchers: number };
}

/** Both seats are players who allow spectators now (M7 7.2; NPC seats are never listed). */
async function spectatorsAllowed(db: Db, init: BattleInit, now: number): Promise<boolean> {
  for (const seat of [init.white, init.black]) {
    const id = playerOf(seat);
    const p = id ? await db.players.getById(id) : null;
    if (!p || !spectatingAllowed(p, now)) return false;
  }
  return true;
}

export class BattleRoom extends DurableObject<Env> {
  private core: BattleCore | null = null;
  private lobby: LobbyInit | null = null;
  private origin: BattleOrigin | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    this.lobby = (await this.ctx.storage.get<LobbyInit>('lobby')) ?? null;
    this.origin = (await this.ctx.storage.get<BattleOrigin>('origin')) ?? null;
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
    if (req.headers.get('upgrade') === 'websocket')
      return url.pathname === '/spectate' ? this.acceptSpectator(req) : this.accept(req);
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /init': {
        const { origin, ...init } = (await req.json()) as BattleInit & { origin?: BattleOrigin };
        return this.init(init, origin ?? { kind: 'pvp' });
      }
      case 'POST /lobby':
        return this.openLobby((await req.json()) as LobbyInit);
      case 'POST /join':
        return this.join((await req.json()) as SeatInit);
      case 'POST /kick': {
        const { playerId, code } = (await req.json()) as { playerId: string; code: number };
        return this.kick(playerId, code);
      }
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
      const kind = this.core.spectatable && this.origin ? liveKind(this.origin) : null;
      return {
        status: s.endedAt === null ? 'active' : 'ended',
        format: s.format,
        players: { white: tag(s.seats.white), black: tag(s.seats.black) },
        ...(kind && this.origin
          ? {
              spectate: {
                kind,
                ...liveDetails(this.origin),
                watchers: this.spectators().length,
              },
            }
          : {}),
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

  private async init(init: BattleInit, origin: BattleOrigin): Promise<Response> {
    if (this.core) return new Response('exists', { status: 409 });
    const now = Date.now();
    let started: { core: BattleCore; out: Outbox };
    const db = await getDb(this.env);
    try {
      // M7 7.2: a public kind of battle is listed when both players allow spectators.
      const listed = liveKind(origin) !== null && (await spectatorsAllowed(db, init, now));
      try {
        started = BattleCore.create(
          listed ? { ...init, spectate: { delay: SPECTATE.delayPlies } } : init,
          now,
        );
      } catch (e) {
        return new Response(`bad init: ${String(e)}`, { status: 400 });
      }
      this.core = started.core;
      this.origin = origin;
      await this.ctx.storage.put('origin', origin);
      await db.battles.create({
        id: init.battleId,
        format: init.format,
        whiteId: playerOf(init.white),
        blackId: playerOf(init.black),
        startedAt: now,
        listed,
      });
      // M6 6.4: players in the world are marked battling there (no challenges mid-battle).
      if (outsideZone(origin))
        for (const id of [playerOf(init.white), playerOf(init.black)])
          if (id) await tellZone(this.env, db, id, init.battleId, true);
    } finally {
      await releaseDb(this.env, db);
    }
    await this.deliver(started.out);
    return new Response('ok');
  }

  /**
   * Close a player's socket(s) in this battle (a moderator's suspension, M6 6.4). The side is
   * disconnected at once; it cannot come back, so the disconnect grace decides the battle (9.2).
   */
  private async kick(playerId: string, code: number): Promise<Response> {
    let closed = 0;
    const sides = new Set<Side>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.playerId !== playerId) continue;
      try {
        ws.close(code, 'suspended');
      } catch {
        /* already closed */
      }
      closed++;
      if (a.side !== 'lobby' && a.side !== 'spectator') sides.add(a.side);
    }
    const core = this.core;
    if (core) for (const side of sides) await this.deliver(core.disconnect(side, Date.now()));
    return closed > 0 ? Response.json({ closed }) : Response.json({ closed }, { status: 404 });
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
    const res = await this.init(
      { battleId: lobby.battleId, format: lobby.format, white, black },
      { kind: 'pvp' },
    );
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
      // M7 7.2: players of a public battle see how many spectators watch.
      if (this.core.spectatable) sendTo(server, this.watchersMsg());
      const out = this.core.connect(side, Date.now());
      void this.ctx.blockConcurrencyWhile(() => this.deliver(out));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A spectator socket (M7 7.2): the Worker checked the spectate ticket (R-SEC-006) and suspension.
   * Only public battles accept spectators, at most SPECTATE.maxPerRoom at a time.
   */
  private acceptSpectator(req: Request): Response {
    const playerId = req.headers.get('x-player-id');
    if (!playerId) return new Response('missing player', { status: 400 });
    if (!this.core?.spectatable) return new Response('not public', { status: 404 });
    if (this.spectators().length >= SPECTATE.maxPerRoom)
      return new Response('full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ['spectator']);
    server.serializeAttachment({
      side: 'spectator',
      playerId,
      live: false,
      bucket: newBucket(LIMITS.battle, Date.now()),
    } satisfies Attachment);
    this.broadcastWatchers();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Open spectator sockets, optionally without one that is closing. */
  private spectators(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets('spectator')
      .filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  private watchersMsg(except?: WebSocket): { t: 'watchers'; d: { count: number } } {
    return { t: 'watchers', d: { count: this.spectators(except).length } };
  }

  /** Tell the players and the spectators that said hello how many spectators watch now. */
  private broadcastWatchers(except?: WebSocket): void {
    if (!this.core?.spectatable) return;
    const msg = this.watchersMsg(except);
    for (const ws of [...this.ctx.getWebSockets('white'), ...this.ctx.getWebSockets('black')])
      sendTo(ws, msg);
    for (const ws of this.spectators(except))
      if ((ws.deserializeAttachment() as Attachment | null)?.live) sendTo(ws, msg);
  }

  /**
   * One frame from a spectator: read-only, so only `hello` does anything (it answers with the
   * delayed position and the spectator events since `from`); everything else, and anything over
   * the rate limit, is dropped and counted, and a socket that keeps offending is closed (R-SEC-005).
   */
  private spectatorMessage(ws: WebSocket, a: Attachment, message: string | ArrayBuffer): void {
    const now = Date.now();
    const bucket = a.bucket ?? newBucket(LIMITS.battle, now);
    const before = bucket.strikes;
    let hello: number | null = null;
    if (take(bucket, LIMITS.battle, now)) {
      const msg = decode(ClientSpectate, typeof message === 'string' ? message : '');
      if (msg) hello = msg.d.from;
      else {
        bucket.strikes = before;
        strike(bucket);
      }
    }
    ws.serializeAttachment({ ...a, bucket, live: a.live === true || hello !== null });
    if (tooManyStrikes(bucket)) {
      ws.close(CLOSE_POLICY, 'too many invalid or excess messages');
      return;
    }
    if (hello === null || !this.core) return;
    for (const m of this.core.spectatorHello(hello, this.spectators().length)) sendTo(ws, m);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a?.side === 'spectator') {
      this.spectatorMessage(ws, a, message);
      return;
    }
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
    if (a?.side === 'spectator') {
      this.broadcastWatchers(ws);
      return;
    }
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
    // M7 7.2: delayed spectator views go only to spectator sockets that said hello.
    if (out.spectate?.length) {
      const live = this.spectators().filter(
        (ws) => (ws.deserializeAttachment() as Attachment | null)?.live === true,
      );
      for (const msg of out.spectate) for (const ws of live) sendTo(ws, msg);
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
          const origin = (await this.ctx.storage.get<BattleOrigin>('origin')) ?? { kind: 'pvp' };
          await settleBattle(this.env, db, e.summary, e.archive, origin, Date.now());
        } catch (err) {
          console.error(`battle ${core.battleId}: settling failed: ${String(err)}`);
        } finally {
          await releaseDb(this.env, db);
        }
        try {
          await metricsStub(this.env).fetch('https://metrics/battle', {
            method: 'POST',
            body: JSON.stringify(battleUsage(e.summary, e.archive)),
          });
        } catch (err) {
          console.error(`battle ${core.battleId}: metrics failed: ${String(err)}`);
        }
      } else if (e.kind === 'error') console.error(`battle ${core.battleId}: ${e.message}`);
    }

    const next = core.nextAlarm();
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}

function sendTo(ws: WebSocket, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closed meanwhile */
  }
}
