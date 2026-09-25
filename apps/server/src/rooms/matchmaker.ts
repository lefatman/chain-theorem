/**
 * Matchmaker Durable Object (M4 4.3, 12.2): one instance per casual queue (format). Waiting players
 * hold a hibernating socket; the room pairs them (±5 levels, widening, `pairing.ts`), creates the
 * BattleRoom and answers `matched`. Only Alarms schedule work: no intervals, no loops (R-COST-002).
 */
import { DurableObject } from 'cloudflare:workers';
import { ClientQueue, ServerQueue, decode, encode, type Msg } from '@chain-theorem/protocol';
import type { FormatId, Loadout } from '@chain-theorem/rules';
import type { Env } from '../env.ts';
import { nextWiden, pair } from '../match/pairing.ts';
import { assignColours, type RoomInit, type SeatInit } from './init.ts';

interface Waiter {
  id: string;
  name: string;
  level: number;
  loadout: Loadout;
  since: number;
  format: FormatId;
}

export class Matchmaker extends DurableObject<Env> {
  /** Worker → `GET /ws` upgrade with the verified player in `x-waiter` (JSON). */
  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 });
    const raw = req.headers.get('x-waiter');
    if (!raw) return new Response('missing waiter', { status: 400 });
    const w = JSON.parse(raw) as Omit<Waiter, 'since'>;
    const waiter: Waiter = { ...w, since: Date.now() };
    // One queue socket per player: a new one replaces the old (a second tab).
    for (const old of this.ctx.getWebSockets(waiter.id)) old.close(4000, 'replaced');
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [waiter.id]);
    server.serializeAttachment(waiter);
    await this.run();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const m = typeof message === 'string' ? decode(ClientQueue, message) : null;
    if (m?.t === 'ping') send(ws, { t: 'pong', d: {} });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    await this.broadcastCounts();
  }

  override async alarm(): Promise<void> {
    await this.run();
  }

  private waiters(): { ws: WebSocket; w: Waiter }[] {
    const out: { ws: WebSocket; w: Waiter }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const w = ws.deserializeAttachment() as Waiter | null;
      if (w && ws.readyState === WebSocket.OPEN) out.push({ ws, w });
    }
    return out;
  }

  /** Pair everyone who can be paired now, then schedule the next widening. */
  private async run(): Promise<void> {
    const now = Date.now();
    const list = this.waiters();
    const byId = new Map(list.map((x) => [x.w.id, x]));
    const pairs = pair(
      list.map((x) => x.w),
      now,
    );
    for (const [a, b] of pairs) {
      const battleId = crypto.randomUUID();
      const seat = (w: Waiter): SeatInit => ({
        playerId: w.id,
        name: w.name,
        level: w.level,
        loadout: w.loadout,
      });
      const { white, black } = assignColours(seat(a), seat(b));
      const init: RoomInit = { battleId, format: a.format, white, black };
      const stub = this.env.BATTLE_ROOM.get(this.env.BATTLE_ROOM.idFromName(battleId));
      const res = await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify(init),
      });
      for (const w of [a, b]) {
        const x = byId.get(w.id);
        if (!x) continue;
        if (res.ok) send(x.ws, { t: 'matched', d: { battleId } });
        else send(x.ws, { t: 'err', d: { code: 'match_failed' } });
        x.ws.close(1000, 'matched');
      }
    }
    await this.broadcastCounts();
    const rest = this.waiters().map((x) => x.w);
    const next = nextWiden(rest, Date.now());
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  private async broadcastCounts(): Promise<void> {
    const list = this.waiters();
    for (const { ws, w } of list)
      send(ws, { t: 'queued', d: { format: w.format, since: w.since, waiting: list.length } });
  }
}

function send(ws: WebSocket, msg: Msg<typeof ServerQueue>): void {
  try {
    ws.send(encode(ServerQueue, msg));
  } catch {
    /* closed */
  }
}
