/**
 * TradeSession Durable Object (M6 6.1; spec 10.4, 9.5, 12.2): one instance per trade or wager
 * negotiation, named by its id. It wraps the pure TradeCore: sockets use the Hibernation API, time
 * uses Alarms only (invitation and idle expiry, an execution watchdog, the purge; R-COST-002), and
 * the core snapshot is stored before anything is sent. Clients get only the core's views: both
 * offers and marks, never an inventory or a loadout (R-SEC-001).
 *
 * When both players confirmed:
 * - a trade runs as ONE atomic database list (`trades.execute`, R-SEC-004), then both players'
 *   saved loadouts are re-checked (10.4);
 * - a wager (9.5, R-FMT-006) takes each player's fighting loadout (the battle uses this snapshot even
 *   if it holds a staked item), moves both stakes into escrow in one atomic list, then creates the
 *   PvP BattleRoom with origin `{ kind: 'wager', wagerId }`; `settleBattle` pays the winner once.
 *   Every step is idempotent by the attempt's wager id, so a restart mid-way resumes safely; a
 *   battle that cannot start returns the stakes. After the hand-off the session keeps a slow alarm
 *   until the escrow is settled (`settleFromRecord`), then deletes its storage.
 * Entitlement is checked again when it runs: trial accounts never trade or wager (14.4).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Db, ItemBundle } from '@chain-theorem/db';
import type { Offer } from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';
import { signTicket } from '../auth/tickets.ts';
import type { BattleInit, SeatInit } from '../battle/index.ts';
import { canTrade } from '../billing/entitlement.ts';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import {
  TradeCore,
  type Effect,
  type ExecResult,
  type Outbox,
  type Owned,
  type TradeInit,
  type TradeSide,
  type TradeSnapshot,
} from '../trade/index.ts';
import { revalidateLoadouts } from '../trade/loadouts.ts';
import type { Fighter } from '../world/battles.ts';
import { loadFighter } from '../world/progress.ts';
import { settleFromRecord } from '../world/wager.ts';
import { assignColours } from './init.ts';

interface Attachment {
  side: TradeSide;
  playerId: string;
  /** Superseded by a newer socket of the same side: its close changes nothing. */
  replaced?: boolean;
}

/** A wager attempt's plan, stored before the escrow so a restart resumes with the same battle. */
interface WagerPlan {
  wagerId: string;
  battleId: string;
  init: BattleInit;
}

/** What the Worker learns about a session (REST tickets, declines). */
export interface TradeInfo {
  status: 'empty' | TradeSnapshot['phase'];
  mode?: TradeSnapshot['mode'];
  a?: string;
  b?: string;
}

/** How often a finished wager session looks for its battle's result (the settlement safety net). */
export const SETTLE_CHECK_MS = 5 * 60_000;
const CLOSE_REPLACED = 4000;
const LIVE = 'wager:live';

const planKey = (attempt: number) => `wager:plan:${attempt}`;
const SIDES: readonly TradeSide[] = ['a', 'b'];

/** Protocol offer (`{id, qty}`) to database bundle (`{itemId, qty}` / `{abilityId, qty}`). */
export function toBundle(o: Offer): ItemBundle {
  return {
    items: o.items.map((l) => ({ itemId: l.id, qty: l.qty })),
    cards: o.cards.map((l) => ({ abilityId: l.id, qty: l.qty })),
  };
}

async function loadOwned(db: Db, playerId: string): Promise<Owned> {
  const inv = await db.inventory.list(playerId);
  return {
    items: Object.fromEntries(inv.items.map((i) => [i.itemId, i.qty])),
    cards: Object.fromEntries(inv.cards.map((c) => [c.abilityId, c.qty])),
  };
}

const seatOf = (f: Fighter): SeatInit => ({
  playerId: f.playerId,
  name: f.name,
  level: f.level,
  loadout: f.loadout,
});

export class TradeSession extends DurableObject<Env> {
  private core: TradeCore | null = null;
  /** An `execute` effect is being run by this instance (the watchdog must not start another). */
  private running = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    const snap = await this.ctx.storage.get<TradeSnapshot>('snap');
    if (!snap) return;
    const core = TradeCore.restore(snap);
    this.core = core;
    // After a restart without hibernation the sockets are gone although the snapshot says open.
    const now = Date.now();
    for (const side of SIDES)
      if (snap.connected[side] && this.open(side).length === 0)
        await this.deliver(core.disconnect(side, now));
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') === 'websocket') return this.accept(req);
    const url = new URL(req.url);
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /init':
        return this.init((await req.json()) as TradeInit);
      case 'GET /info':
        return Response.json(this.info());
      case 'POST /cancel': {
        const { playerId } = (await req.json()) as { playerId: string };
        const side = this.core?.sideOf(playerId) ?? null;
        if (!this.core || !side) return Response.json({ error: 'not_found' }, { status: 404 });
        await this.deliver(this.core.cancelBy(side, Date.now()));
        return new Response(null, { status: 204 });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private info(): TradeInfo {
    const c = this.core;
    if (!c) return { status: 'empty' };
    return { status: c.phase, mode: c.mode, a: c.party('a').id, b: c.party('b').id };
  }

  private async init(init: TradeInit): Promise<Response> {
    if (this.core) return new Response('exists', { status: 409 });
    try {
      this.core = TradeCore.create(init, Date.now());
    } catch (e) {
      return new Response(`bad init: ${String(e)}`, { status: 400 });
    }
    await this.deliver({ send: [], effects: [], save: true });
    return new Response('ok');
  }

  /** Worker → upgrade with the verified player id in `x-player-id` (ticket checked, R-SEC-006). */
  private accept(req: Request): Response {
    const playerId = req.headers.get('x-player-id');
    const core = this.core;
    if (!playerId || !core) return new Response('no such trade', { status: 404 });
    const side = core.sideOf(playerId);
    if (!side) return new Response('not a party of this trade', { status: 403 });
    if (core.over) return new Response('this trade is over', { status: 410 });
    // One socket per side: a new tab replaces the old one.
    for (const old of this.open(side)) {
      old.serializeAttachment({ side, playerId, replaced: true } satisfies Attachment);
      try {
        old.close(CLOSE_REPLACED, 'replaced');
      } catch {
        /* already closed */
      }
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [side]);
    server.serializeAttachment({ side, playerId } satisfies Attachment);
    void this.ctx.blockConcurrencyWhile(async () => {
      const owned = await this.withDb((db) => loadOwned(db, playerId));
      await this.deliver(core.connect(side, owned, Date.now()));
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.replaced || !this.core) return;
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

  private async gone(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.replaced || !this.core) return;
    if (this.open(a.side).some((s) => s !== ws)) return;
    await this.deliver(this.core.disconnect(a.side, Date.now()));
  }

  /** Open, current sockets of a side. */
  private open(side: TradeSide): WebSocket[] {
    return this.ctx.getWebSockets(side).filter((s) => {
      const a = s.deserializeAttachment() as Attachment | null;
      return s.readyState === WebSocket.OPEN && !a?.replaced;
    });
  }

  override async alarm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    // A finished wager keeps watching its escrow until it is settled (9.5: stakes never stranded).
    if (core.phase === 'done' && core.mode === 'wager') {
      const live = await this.ctx.storage.get<{ wagerId: string }>(LIVE);
      if (live) {
        const settled = await this.withDb((db) =>
          settleFromRecord(this.env, db, live.wagerId, now),
        );
        if (!settled) {
          await this.ctx.storage.setAlarm(now + SETTLE_CHECK_MS);
          return;
        }
        await this.ctx.storage.delete(LIVE);
      }
    }
    await this.deliver(core.alarm(now));
  }

  /** Persist first, then send, then run effects, then re-arm the alarm. */
  private async deliver(out: Outbox): Promise<void> {
    const core = this.core;
    if (!core) return;
    if (out.save) await this.ctx.storage.put('snap', core.snapshot());
    for (const { to, msg } of out.send) {
      const data = JSON.stringify(msg);
      for (const ws of this.open(to)) {
        try {
          ws.send(data);
        } catch {
          /* closed meanwhile */
        }
      }
    }
    for (const e of out.effects) {
      if (e.kind === 'purge') {
        this.core = null;
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        return;
      }
      await this.effect(core, e);
    }
    if (this.core !== core) return;
    const next = core.nextAlarm();
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  private async effect(core: TradeCore, e: Exclude<Effect, { kind: 'purge' }>): Promise<void> {
    switch (e.kind) {
      case 'close':
        for (const ws of this.open(e.side)) {
          try {
            ws.close(e.code, e.reason);
          } catch {
            /* already closed */
          }
        }
        return;
      case 'error':
        console.error(`trade ${core.id}: ${e.message}`);
        return;
      case 'execute': {
        if (this.running) return;
        this.running = true;
        try {
          const result = await this.withDb((db) => this.execute(core, db, e));
          await this.deliver(core.executed(result, Date.now()));
        } finally {
          this.running = false;
        }
        return;
      }
    }
  }

  private async withDb<T>(f: (db: Db) => Promise<T>): Promise<T> {
    const db = await getDb(this.env);
    try {
      return await f(db);
    } finally {
      await releaseDb(this.env, db);
    }
  }

  /** Reload both inventories into the core (after a failed attempt) and report the failure. */
  private async fail(
    core: TradeCore,
    db: Db,
    code: 'not_owned' | 'battle_failed' | 'not_entitled' | 'failed',
  ): Promise<ExecResult> {
    const now = Date.now();
    for (const side of SIDES)
      await this.deliver(core.setOwned(side, await loadOwned(db, core.party(side).id), now));
    return { ok: false, code };
  }

  private async execute(
    core: TradeCore,
    db: Db,
    e: Extract<Effect, { kind: 'execute' }>,
  ): Promise<ExecResult> {
    const now = Date.now();
    const a = core.party('a');
    const b = core.party('b');
    try {
      const [pa, pb] = await Promise.all([db.players.getById(a.id), db.players.getById(b.id)]);
      if (!pa || !pb || !canTrade(pa, now) || !canTrade(pb, now))
        return await this.fail(core, db, 'not_entitled');
      if (e.mode === 'trade') {
        const r = await db.trades.execute({
          id: core.id,
          aId: a.id,
          bId: b.id,
          a: toBundle(e.offers.a),
          b: toBundle(e.offers.b),
          at: now,
        });
        // `duplicate`: a run resumed after a restart; its first attempt already committed.
        if (r.status === 'insufficient') return await this.fail(core, db, 'not_owned');
        return {
          ok: true,
          mode: 'trade',
          invalid: {
            a: await revalidateLoadouts(db, a.id, now),
            b: await revalidateLoadouts(db, b.id, now),
          },
        };
      }
      return await this.wager(core, db, e, now);
    } catch (err) {
      console.error(`trade ${core.id}: execute failed: ${String(err)}`);
      return await this.fail(core, db, 'failed');
    }
  }

  private async wager(
    core: TradeCore,
    db: Db,
    e: Extract<Effect, { kind: 'execute' }>,
    now: number,
  ): Promise<ExecResult> {
    const a = core.party('a');
    const b = core.party('b');
    const format = (e.format ?? 'first_blood') as FormatId;
    // 1. The fighting loadouts, before the stakes leave the inventories: the battle uses this
    //    snapshot even when it holds a staked item (9.5).
    let plan = await this.ctx.storage.get<WagerPlan>(planKey(e.attempt));
    if (!plan) {
      const fa = await loadFighter(db, a.id);
      const fb = await loadFighter(db, b.id);
      if (!fa || !fb) return this.fail(core, db, 'battle_failed');
      const battleId = crypto.randomUUID();
      const { white, black } = assignColours(seatOf(fa), seatOf(fb));
      plan = {
        wagerId: `${core.id}:${e.attempt}`,
        battleId,
        init: { battleId, format, white, black },
      };
      await this.ctx.storage.put(planKey(e.attempt), plan);
    }
    // 2. Both stakes into escrow, in one atomic list (R-SEC-004).
    const esc = await db.wagers.escrow({
      id: plan.wagerId,
      battleId: plan.battleId,
      format,
      aId: a.id,
      bId: b.id,
      aStake: toBundle(e.offers.a),
      bStake: toBundle(e.offers.b),
      at: now,
    });
    if (esc.status === 'insufficient') return this.fail(core, db, 'not_owned');
    if (esc.status === 'duplicate') {
      // A resumed run: only go on when this attempt's escrow still holds the stakes.
      const held = await db.wagers.getEscrow(plan.wagerId);
      if (held?.status !== 'escrowed') return this.fail(core, db, 'battle_failed');
    }
    // 3. The PvP battle (409: a resumed run already created it).
    const res = await this.env.BATTLE_ROOM.get(
      this.env.BATTLE_ROOM.idFromName(plan.battleId),
    ).fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ ...plan.init, origin: { kind: 'wager', wagerId: plan.wagerId } }),
    });
    if (!res.ok && res.status !== 409) {
      console.error(`trade ${core.id}: battle init ${res.status}: ${await res.text()}`);
      await db.wagers.settle(plan.wagerId, { winnerId: null, aborted: true, at: Date.now() });
      return this.fail(core, db, 'battle_failed');
    }
    const battleId = plan.battleId;
    await this.ctx.storage.put(LIVE, { wagerId: plan.wagerId });
    await revalidateLoadouts(db, a.id, now);
    await revalidateLoadouts(db, b.id, now);
    const url = async (playerId: string) => {
      const token = await signTicket(this.env.AUTH_SECRET, playerId, `battle:${battleId}`, now);
      return `/ws/battle/${encodeURIComponent(battleId)}?t=${encodeURIComponent(token)}`;
    };
    return { ok: true, mode: 'wager', battleId, urls: { a: await url(a.id), b: await url(b.id) } };
  }
}
