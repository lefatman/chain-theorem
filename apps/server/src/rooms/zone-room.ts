/**
 * ZoneRoom Durable Object (M5 5.1–5.5, 10.1–10.5, 12.2): one instance per zone channel, named
 * `zone:<zone>:<channel>`. It wraps the pure ZoneCore: sockets use the Hibernation API (no timers, no
 * loops, R-COST-002), the core snapshot is stored before anything is sent whenever the core asks for
 * a save, and each player's tile is mirrored into their socket attachment so steps cost no storage
 * writes yet survive hibernation. Effects the core cannot do itself run here: creating battles,
 * idempotent rewards and level-ups (R-SEC-003), saving positions on warp and logout, quest storage,
 * routing party and whisper chat to other channels (R-SEC-011), parties, and telemetry (14.2).
 *
 * Other rooms reach a player through their presence with POST host calls (see `world/routing.ts`):
 * `/deliver`, `/refused`, `/party`, `/invite`, `/grant`, `/ended` and `/notify` (one message the host
 * composed: trade and wager invitations and results, M6); each answers 404 when the player is not in
 * this channel. M6 guilds add `/guild` (the player's guild changed); guild lines leave through the
 * guild's GuildRoom, which delivers them back with `/deliver`.
 */
import { DurableObject } from 'cloudflare:workers';
import { DISCOVERY_XP, world, type Dir, type Reward } from '@chain-theorem/content/world';
import type { Db } from '@chain-theorem/db';
import { signTicket } from '../auth/tickets.ts';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import type { HostCounters, ZoneReport } from '../metrics.ts';
import { zoneBattle, type Fighter } from '../world/battles.ts';
import { partyOp, type PartyHost } from '../world/party.ts';
import { FLAG, grantOnce, loadFighter, saveQuest, syncLevel } from '../world/progress.ts';
import { callPlayer, type ZoneCall } from '../world/routing.ts';
import {
  ZoneCore,
  type BattleOutcome,
  type Effect,
  type Outbox,
  type PartyView,
  type PlayerInit,
  type RoutedChat,
  type ServerMsg,
  type ZoneKey,
  type ZoneSnapshot,
} from '../zone/index.ts';
import { guildStub } from './guild-room.ts';
import { metricsStub } from './metrics.ts';

interface Attachment {
  id: string;
  x?: number;
  y?: number;
  dir?: Dir;
  /** First visit to this zone: grant the discovery XP once the client has its snapshot. */
  discover?: boolean;
  /** Superseded by a newer socket of the same player: its close changes nothing. */
  replaced?: boolean;
}

/** Headers the Worker sets on the upgrade it forwards (the ticket was checked, R-SEC-006). */
export const ZONE_HEADERS = {
  init: 'x-zone-init',
  key: 'x-zone-key',
  discover: 'x-zone-discover',
} as const;

const CLOSE_REPLACED = 4000;

/** The host calls' bodies. */
interface Calls {
  deliver: { to: string; msg: RoutedChat };
  refused: { id: string };
  party: { id: string; party: PartyView | null };
  invite: { to: string; invite: { id: string; from: string; name: string } };
  grant: { id: string; reward: Reward; level: number };
  ended: { id: string; outcome: BattleOutcome | null; rewards: Reward[]; level: number };
  notify: { id: string; msg: ServerMsg };
  guild: { id: string; guild: string | null };
}

const target = (call: ZoneCall, body: Calls[ZoneCall]): string =>
  call === 'deliver' || call === 'invite'
    ? (body as { to: string }).to
    : (body as { id: string }).id;

export class ZoneRoom extends DurableObject<Env> {
  private core: ZoneCore | null = null;
  private counters: HostCounters = { rowsWritten: 0, doRequests: 0, joins: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    const snap = await this.ctx.storage.get<ZoneSnapshot>('snap');
    if (!snap) return;
    const core = ZoneCore.restore(world, snap);
    const open = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || a.replaced) continue;
      open.add(a.id);
      if (a.x !== undefined && a.y !== undefined && a.dir)
        core.place(a.id, { x: a.x, y: a.y, dir: a.dir });
    }
    this.core = core;
    // After a restart without hibernation (a deploy, an eviction) the sockets are gone: those
    // players left, and their positions are saved as on logout (R-COST-002).
    const now = Date.now();
    for (const p of snap.players) if (!open.has(p.id)) await this.left(p.id, now);
  }

  override async fetch(req: Request): Promise<Response> {
    this.counters.doRequests++;
    if (req.headers.get('upgrade') === 'websocket') return this.accept(req);
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/info') {
      const c = this.core;
      return Response.json(
        c ? { zone: c.zone, channel: c.channel, size: c.size, full: c.full } : { size: 0 },
      );
    }
    const call = url.pathname.slice(1) as ZoneCall;
    if (
      req.method !== 'POST' ||
      !['deliver', 'refused', 'party', 'invite', 'grant', 'ended', 'notify', 'guild'].includes(call)
    )
      return new Response('not found', { status: 404 });
    const body = (await req.json()) as Calls[ZoneCall];
    const out = this.apply(call, body, Date.now());
    if (!out) return Response.json({ error: 'not_here' }, { status: 404 });
    await this.run(out);
    return Response.json({ ok: true });
  }

  /** A host call against this channel's core; null when the player is not here. */
  private apply(call: ZoneCall, body: Calls[ZoneCall], now: number): Outbox[] | null {
    const core = this.core;
    if (!core || !core.has(target(call, body))) return null;
    switch (call) {
      case 'deliver': {
        const b = body as Calls['deliver'];
        return [core.deliverChat(b.to, b.msg, now)];
      }
      case 'refused':
        return [core.chatRefused((body as Calls['refused']).id, now)];
      case 'party': {
        const b = body as Calls['party'];
        return [core.setParty(b.id, b.party, now)];
      }
      case 'invite': {
        const b = body as Calls['invite'];
        return [core.partyInvite(b.to, b.invite, now)];
      }
      case 'grant': {
        const b = body as Calls['grant'];
        return [core.grant(b.id, b.reward, b.level, now)];
      }
      case 'ended': {
        const b = body as Calls['ended'];
        return [
          core.battleEnded(b.id, b.outcome, now),
          ...b.rewards.map((r) => core.grant(b.id, r, b.level, now)),
        ];
      }
      case 'notify': {
        const b = body as Calls['notify'];
        return [core.notify(b.id, b.msg, now)];
      }
      case 'guild': {
        const b = body as Calls['guild'];
        return [core.setGuild(b.id, b.guild, now)];
      }
    }
  }

  /** Worker → upgrade with the player's init in headers (ticket checked, R-SEC-006). */
  private async accept(req: Request): Promise<Response> {
    const init = JSON.parse(req.headers.get(ZONE_HEADERS.init) ?? 'null') as PlayerInit | null;
    const key = JSON.parse(req.headers.get(ZONE_HEADERS.key) ?? 'null') as ZoneKey | null;
    if (!init || !key) return new Response('missing init', { status: 400 });
    let core = this.core;
    if (!core) {
      core = new ZoneCore(world, key);
      this.core = core;
    }
    if (core.zone !== key.zone || core.channel !== key.channel)
      return new Response('wrong channel', { status: 400 });
    const now = Date.now();
    const out = core.join(init, now);
    if (out.refused === 'full') return Response.json({ error: 'full' }, { status: 409 });
    // One socket per player and channel: a new tab replaces the old one.
    for (const old of this.ctx.getWebSockets(init.id)) {
      const a = old.deserializeAttachment() as Attachment | null;
      old.serializeAttachment({ ...(a ?? { id: init.id }), replaced: true } satisfies Attachment);
      try {
        old.close(CLOSE_REPLACED, 'replaced');
      } catch {
        /* already closed */
      }
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [init.id]);
    server.serializeAttachment({
      id: init.id,
      ...core.position(init.id),
      discover: req.headers.get(ZONE_HEADERS.discover) === '1',
    } satisfies Attachment);
    this.counters.joins++;
    await this.run([out], (db) => db.world.setPresence(init.id, key.zone, key.channel));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    const core = this.core;
    if (!a || a.replaced || !core) return;
    const raw = typeof message === 'string' ? message : '';
    const now = Date.now();
    const out = core.message(a.id, raw, now);
    const pos = core.position(a.id);
    const hello = a.discover === true && out.send.some((m) => m.to === a.id && m.msg.t === 'zsnap');
    if (pos && (pos.x !== a.x || pos.y !== a.y || pos.dir !== a.dir || hello))
      ws.serializeAttachment({
        ...a,
        ...pos,
        ...(hello ? { discover: false } : {}),
      } satisfies Attachment);
    await this.run([out]);
    if (hello) await this.discover(a.id, now);
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

  /** A socket went away: the player leaves unless another live socket of theirs is still open. */
  private async gone(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.replaced || !this.core) return;
    const others = this.ctx.getWebSockets(a.id).filter((s) => {
      const b = s.deserializeAttachment() as Attachment | null;
      return s !== ws && s.readyState === WebSocket.OPEN && !b?.replaced;
    });
    if (others.length > 0) return;
    await this.left(a.id, Date.now());
  }

  private async left(id: string, now: number): Promise<void> {
    const core = this.core;
    if (!core) return;
    const outs = [core.leave(id, now)];
    // An empty channel reports its last telemetry window now (it may hibernate for long).
    if (core.size === 0) outs.push(core.flushTelemetry(now));
    await this.run(outs, (db) => db.world.clearPresence(id, core.zone, core.channel));
  }

  /** 7.5 discoveries: XP for the first visit to a zone (once, by its grant key). */
  private async discover(id: string, now: number): Promise<void> {
    const core = this.core;
    if (!core) return;
    await this.run([], async (db) => {
      const reward: Reward = { xp: DISCOVERY_XP };
      const granted = await grantOnce(
        db,
        id,
        { key: `discover:${id}:${core.zone}`, reward, flags: [FLAG.zone(core.zone)] },
        now,
      );
      if (!granted) return [];
      return [core.grant(id, granted, await syncLevel(db, id), now)];
    });
  }

  /**
   * Store, send, then run effects (which may produce more outboxes) until nothing is left. `first`
   * runs with the database before the outboxes are handled (presence, discovery).
   */
  private async run(queue: Outbox[], first?: (db: Db) => Promise<Outbox[] | void>): Promise<void> {
    const core = this.core;
    if (!core) return;
    let db: Db | null = null;
    const useDb = async (): Promise<Db> => (db ??= await getDb(this.env));
    try {
      if (first) {
        const more = await first(await useDb());
        if (more) queue.push(...more);
      }
      for (let out = queue.shift(); out; out = queue.shift()) {
        if (out.save) {
          await this.ctx.storage.put('snap', core.snapshot());
          this.counters.rowsWritten++;
        }
        for (const { to, msg } of out.send) {
          const data = JSON.stringify(msg);
          for (const ws of this.ctx.getWebSockets(to)) {
            const a = ws.deserializeAttachment() as Attachment | null;
            if (a?.replaced) continue;
            try {
              ws.send(data);
            } catch {
              /* closed meanwhile */
            }
          }
        }
        for (const e of out.effects) {
          try {
            queue.push(...(await this.effect(core, e, useDb)));
          } catch (err) {
            console.error(
              `zone ${core.zone}#${core.channel}: ${e.kind} effect failed: ${String(err)}`,
            );
          }
        }
      }
    } finally {
      if (db) await releaseDb(this.env, db);
    }
  }

  private async effect(core: ZoneCore, e: Effect, useDb: () => Promise<Db>): Promise<Outbox[]> {
    const now = Date.now();
    switch (e.kind) {
      case 'battle':
        return this.startBattle(core, e, await useDb(), now);
      case 'warp': {
        const db = await useDb();
        await db.world.setPosition(e.id, e.zone, e.x, e.y);
        // Party travel (10.4): members in this channel follow their leader through the warp.
        const party = await db.social.partyOf(e.id);
        if (party?.leaderId !== e.id) return [];
        const dest = { zone: e.zone, x: e.x, y: e.y, dir: e.dir };
        return party.members
          .filter((m) => m.playerId !== e.id && core.has(m.playerId))
          .map((m) => core.travel(m.playerId, dest, now));
      }
      case 'persist':
        await (await useDb()).world.setPosition(e.id, e.zone, e.x, e.y);
        return [];
      case 'quest':
        await saveQuest(await useDb(), e.id, e.quest, now);
        return [];
      case 'questDone':
        return this.reward(
          core,
          await useDb(),
          e.id,
          `quest:${e.id}:${e.quest}`,
          e.reward,
          [],
          now,
        );
      case 'lessonDone':
        return this.reward(
          core,
          await useDb(),
          e.id,
          `lesson:${e.id}:${e.lesson}`,
          e.reward,
          [FLAG.lesson(e.lesson)],
          now,
        );
      case 'defeated':
        await (await useDb()).world.setFlag(e.id, FLAG.npc(e.npc), now);
        return [];
      case 'chat': {
        const outs: Outbox[] = [];
        for (const to of e.to) {
          const ok = await this.route(core, await useDb(), to, 'deliver', { to, msg: e.msg }, outs);
          if (!ok && e.msg.ch === 'whisper') outs.push(core.chatRefused(e.from, now));
        }
        return outs;
      }
      case 'guildChat': {
        // M6 (10.4): the guild's GuildRoom filters by its youngest member (R-SEC-011) and delivers
        // the line to every online member; a sender it does not know has left the guild.
        const res = await guildStub(this.env, e.guild).fetch(
          `https://guild/chat?g=${encodeURIComponent(e.guild)}`,
          { method: 'POST', body: JSON.stringify({ msg: e.msg }) },
        );
        if (res.status !== 404) return [];
        return [core.setGuild(e.msg.from, null, now), core.notice(e.msg.from, 'no_guild', now)];
      }
      case 'bounce': {
        const outs: Outbox[] = [];
        await this.route(core, await useDb(), e.to, 'refused', { id: e.to }, outs);
        return outs;
      }
      case 'party': {
        const db = await useDb();
        const outs: Outbox[] = [];
        const host: PartyHost = {
          db,
          secret: this.env.AUTH_SECRET,
          now,
          call: (playerId, call, body) =>
            this.route(core, db, playerId, call, body as Calls[ZoneCall], outs),
          notice: async (playerId, code) => {
            if (core.has(playerId)) outs.push(core.notice(playerId, code, now));
          },
        };
        await partyOp(host, e.party);
        return outs;
      }
      case 'prefs':
        await (await useDb()).world.setFilterChat(e.id, e.filterChat);
        return [];
      case 'telemetry':
        await this.telemetry({ ...e.report, host: this.counters });
        this.counters = { rowsWritten: 0, doRequests: 0, joins: 0 };
        return [];
      case 'close': {
        for (const ws of this.ctx.getWebSockets(e.id)) {
          try {
            ws.close(e.code, e.reason);
          } catch {
            /* already closed */
          }
        }
        const db = await useDb();
        await db.world.clearPresence(e.id, core.zone, core.channel);
        return [core.leave(e.id, now)];
      }
      case 'error':
        console.error(`zone ${core.zone}#${core.channel}: ${e.message}`);
        return [];
    }
  }

  /** A host call to a player here (applied directly) or in another channel (by presence). */
  private async route(
    core: ZoneCore,
    db: Db,
    playerId: string,
    call: ZoneCall,
    body: Calls[ZoneCall],
    outs: Outbox[],
  ): Promise<boolean> {
    if (core.has(playerId)) {
      outs.push(...(this.apply(call, body, Date.now()) ?? []));
      return true;
    }
    return callPlayer(this.env, db, playerId, call, body);
  }

  private async reward(
    core: ZoneCore,
    db: Db,
    id: string,
    key: string,
    reward: Reward,
    flags: string[],
    now: number,
  ): Promise<Outbox[]> {
    const granted = await grantOnce(db, id, { key, reward, flags }, now);
    if (!granted) return [];
    return [core.grant(id, granted, await syncLevel(db, id), now)];
  }

  /** Create the BattleRoom for a `battle` effect and hand each player a battle ticket. */
  private async startBattle(
    core: ZoneCore,
    e: Extract<Effect, { kind: 'battle' }>,
    db: Db,
    now: number,
  ): Promise<Outbox[]> {
    const req = e.battle;
    const battleId = crypto.randomUUID();
    try {
      const fighters = new Map<string, Fighter>();
      for (const id of req.players) {
        const f = await loadFighter(db, id);
        if (!f) throw new Error(`no legal loadout for ${id}`);
        fighters.set(id, f);
      }
      const bit = new Uint8Array(1);
      crypto.getRandomValues(bit);
      const { init, origin } = zoneBattle(
        battleId,
        core.zone,
        req,
        fighters,
        ((bit[0] ?? 0) & 1) === 0,
      );
      const res = await this.env.BATTLE_ROOM.get(this.env.BATTLE_ROOM.idFromName(battleId)).fetch(
        'https://room/init',
        { method: 'POST', body: JSON.stringify({ ...init, origin }) },
      );
      if (!res.ok) throw new Error(`init ${res.status}: ${await res.text()}`);
      const outs: Outbox[] = [];
      for (const id of req.players) {
        const token = await signTicket(this.env.AUTH_SECRET, id, `battle:${battleId}`, now);
        const url = `/ws/battle/${encodeURIComponent(battleId)}?t=${encodeURIComponent(token)}`;
        outs.push(core.battleStarted(id, { battleId, url, kind: req.kind }, now));
      }
      return outs;
    } catch (err) {
      console.error(`zone ${core.zone}#${core.channel}: battle ${e.ref} failed: ${String(err)}`);
      return req.players.flatMap((id) => [
        core.battleEnded(id, null, now),
        core.notice(id, 'battle_failed', now),
      ]);
    }
  }

  private async telemetry(rep: ZoneReport): Promise<void> {
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    this.env.TELEMETRY?.writeDataPoint({
      indexes: ['zone'],
      blobs: [rep.zone, String(rep.channel)],
      doubles: [
        rep.players,
        rep.playerMs,
        sum(rep.in),
        sum(rep.out),
        rep.dropped.rate,
        rep.dropped.invalid,
        rep.dropped.refused,
        rep.encounters,
        rep.battles,
        rep.host.rowsWritten,
        rep.host.doRequests,
        rep.host.joins,
      ],
    });
    await metricsStub(this.env).fetch('https://metrics/zone', {
      method: 'POST',
      body: JSON.stringify(rep),
    });
  }
}
