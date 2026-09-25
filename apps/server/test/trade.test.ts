/**
 * Trades and item wagers through the real Worker (M6 6.1, `pnpm test:workers`): the TradeSession,
 * ZoneRoom and BattleRoom Durable Objects with local D1 inside workerd. Covers entitlement (trial
 * accounts cannot trade or wager, R-COST-005), invitations through the zone channel, socket tickets
 * bound to player and trade (R-SEC-006), the two-step confirmation with resets, the atomic transfer
 * (R-SEC-004), loadouts invalidated by a trade (10.4), payload hygiene (R-SEC-001), and a wager
 * battle from escrow to payout (9.5, R-FMT-006).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '@chain-theorem/db';
import type { TradeTicket, WorldTicket } from '@chain-theorem/protocol';
import type { Side } from '@chain-theorem/rules';
import type { BattleSnapshot } from '../src/battle/index.ts';
import { getDb, releaseDb } from '../src/db.ts';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const TIDE = { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] };

const open: Sock[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) {
    try {
      s.ws.close(1000);
    } catch {
      /* closed */
    }
  }
  await new Promise((r) => setTimeout(r, 50));
});

async function withDb<T>(f: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb(env);
  try {
    return await f(db);
  } finally {
    await releaseDb(env, db);
  }
}

let names = 0;
const uniq = (base: string) => `${base}${++names}${String(Date.now()).slice(-4)}`;

/** A paying subscriber (14.4): trading and wagers are for subscribers only. */
async function subscriber(base: string): Promise<{ cookie: string; id: string }> {
  const p = await signUp(env, uniq(base));
  await withDb((db) =>
    db.kysely
      .updateTable('players')
      .set({ sub_status: 'active', sub_expires_at: Date.now() + 30 * DAY })
      .where('id', '=', p.id)
      .execute(),
  );
  return p;
}

async function track(path: string): Promise<Sock> {
  const s = await openSocket(path);
  open.push(s);
  return s;
}

/** Enter the world (the invitation arrives on the zone socket). */
async function enter(cookie: string): Promise<Sock> {
  const t = await call<WorldTicket>('POST', '/api/world/ticket', undefined, cookie);
  expect(t.status).toBe(200);
  const s = await track(t.data.url);
  s.send('hello');
  await s.wait('zsnap');
  return s;
}

async function inventory(cookie: string) {
  return (
    await call<{ items: { id: string; qty: number }[]; cards: { id: string; qty: number }[] }>(
      'GET',
      '/api/inventory',
      undefined,
      cookie,
    )
  ).data;
}

const qty = (inv: Awaited<ReturnType<typeof inventory>>, kind: 'items' | 'cards', id: string) =>
  inv[kind].find((x) => x.id === id)?.qty ?? 0;

interface TState {
  rev: number;
  phase: string;
  reset: 'you' | 'them' | null;
  failure: string | null;
  me: { ready: boolean; confirmed: boolean; offer: unknown };
  them: { ready: boolean; confirmed: boolean; offer: unknown; here: boolean };
}

/** The latest `tstate` after index `from` that satisfies `pred`. */
async function state(s: Sock, pred: (d: TState) => boolean, from = 0): Promise<TState> {
  const until = Date.now() + 8000;
  for (;;) {
    const m = s.msgs
      .slice(from)
      .filter((x) => x.t === 'tstate')
      .map((x) => x.d as unknown as TState)
      .reverse()
      .find(pred);
    if (m) return m;
    if (Date.now() > until)
      throw new Error(`no matching tstate; got ${s.msgs.map((x) => x.t).join(',')}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Two subscribers in the world; A invites B; both open the trade socket. */
async function negotiate(mode: 'trade' | 'wager', format?: string) {
  const a = await subscriber('Ana');
  const b = await subscriber('Ben');
  const za = await enter(a.cookie);
  const zb = await enter(b.cookie);
  const fromZ = zb.msgs.length;
  const started = await call<TradeTicket>(
    'POST',
    '/api/trades',
    { with: b.id, mode, ...(format ? { format } : {}) },
    a.cookie,
  );
  expect(started.status).toBe(200);
  const invite = await zb.wait('tradeIn', fromZ);
  expect(invite.d).toMatchObject({ id: started.data.id, from: a.id, mode });
  const tb = await call<TradeTicket>(
    'POST',
    `/api/trades/${started.data.id}/ticket`,
    undefined,
    b.cookie,
  );
  expect(tb.status).toBe(200);
  const ta = await track(started.data.url);
  ta.send('hello');
  await state(ta, (d) => d.phase === 'invited');
  const sb = await track(tb.data.url);
  sb.send('hello');
  await state(sb, (d) => d.phase === 'open');
  await state(ta, (d) => d.phase === 'open' && d.them.here);
  return { a, b, za, zb, ta, tb: sb, id: started.data.id };
}

/** Both mark the current revision ready, then both confirm it. */
async function readyAndConfirm(ta: Sock, tb: Sock): Promise<void> {
  const cur = await state(ta, () => true);
  ta.send('ready', { rev: cur.rev, on: true });
  tb.send('ready', { rev: cur.rev, on: true });
  await state(ta, (d) => d.rev === cur.rev && d.me.ready && d.them.ready);
  ta.send('confirm', { rev: cur.rev });
  tb.send('confirm', { rev: cur.rev });
}

describe('trades and wagers (M6 6.1)', () => {
  it('R-COST-005 trial accounts cannot trade or wager, and the access route says why', async () => {
    const trial = await signUp(env, uniq('Tia'));
    const sub = await subscriber('Sol');
    expect(
      (
        await call<{ allowed: boolean; reason: string }>(
          'GET',
          '/api/trades/access',
          undefined,
          trial.cookie,
        )
      ).data,
    ).toEqual({ allowed: false, reason: 'trial' });
    expect((await call('GET', '/api/trades/access', undefined, sub.cookie)).data).toEqual({
      allowed: true,
      reason: null,
    });
    const own = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: sub.id, mode: 'trade' },
      trial.cookie,
    );
    expect([own.status, own.data.error]).toEqual([403, 'trial_account']);
    const wager = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: sub.id, mode: 'wager', format: 'first_blood' },
      trial.cookie,
    );
    expect(wager.status).toBe(403);
    const partner = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: trial.id, mode: 'wager' },
      sub.cookie,
    );
    expect([partner.status, partner.data.error]).toEqual([409, 'partner_cannot_trade']);
    // A lapsed account (trial over, no subscription) is refused the same way.
    await withDb((db) =>
      db.kysely
        .updateTable('players')
        .set({ trial_ends_at: Date.now() - DAY, created_at: Date.now() - 30 * DAY })
        .where('id', '=', trial.id)
        .execute(),
    );
    expect(
      (await call<{ reason: string }>('GET', '/api/trades/access', undefined, trial.cookie)).data
        .reason,
    ).toBe('expired');
    // Inviting someone who is not in the world fails without leaving a session behind.
    const other = await subscriber('Oli');
    const offline = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: other.id, mode: 'trade' },
      sub.cookie,
    );
    expect([offline.status, offline.data.error]).toEqual([409, 'not_online']);
  });

  it('R-WORLD-004 R-SEC-004 R-SEC-001 R-SEC-006 a trade: invitation, offers, a reset, two-step confirm, one atomic transfer', async () => {
    const { a, b, ta, tb, id } = await negotiate('trade');
    // A's saved loadout uses the Glove A is about to trade away (10.4).
    const saved = await call<{ id: string; valid: boolean }>(
      'PUT',
      '/api/loadouts',
      { name: 'Tide', loadout: TIDE },
      a.cookie,
    );
    expect(saved.data.valid).toBe(true);

    // R-SEC-006: a ticket opens only its own trade, and only its player gets one.
    const token =
      new URL(
        `http://x${(await call<TradeTicket>('POST', `/api/trades/${id}/ticket`, undefined, a.cookie)).data.url}`,
      ).searchParams.get('t') ?? '';
    await expect(
      openSocket(`/ws/trade/${crypto.randomUUID()}?t=${encodeURIComponent(token)}`),
    ).rejects.toThrow(/403/);
    await expect(openSocket(`/ws/trade/${id}?t=forged.ticket`)).rejects.toThrow(/403/);
    const c = await subscriber('Cyd');
    expect((await call('POST', `/api/trades/${id}/ticket`, undefined, c.cookie)).status).toBe(404);

    ta.send('offer', { items: [{ id: 'dual_adepts_glove', qty: 1 }], cards: [] });
    tb.send('offer', { items: [], cards: [{ id: 'scout', qty: 1 }] });
    await state(ta, (d) => JSON.stringify(d.them.offer).includes('scout'));
    const first = await state(tb, () => true);
    ta.send('ready', { rev: first.rev, on: true });
    tb.send('ready', { rev: first.rev, on: true });
    await state(ta, (d) => d.rev === first.rev && d.them.ready && d.me.ready);
    // B adds a card: both marks are cleared and A is told who changed it.
    const from = ta.msgs.length;
    tb.send('offer', {
      items: [],
      cards: [
        { id: 'scout', qty: 1 },
        { id: 'last_word', qty: 1 },
      ],
    });
    const reset = await state(ta, (d) => d.rev > first.rev, from);
    expect(reset).toMatchObject({ reset: 'them', me: { ready: false }, them: { ready: false } });
    // The old revision can no longer be confirmed.
    ta.send('confirm', { rev: first.rev });
    await ta.wait('err', from);
    expect(ta.msgs.slice(from).find((m) => m.t === 'err')?.d.code).toBe('stale');

    await readyAndConfirm(ta, tb);
    const doneA = await ta.wait('tdone');
    const doneB = await tb.wait('tdone');
    expect(doneA.d).toMatchObject({
      mode: 'trade',
      got: {
        items: [],
        cards: [
          { id: 'last_word', qty: 1 },
          { id: 'scout', qty: 1 },
        ],
      },
      invalid: ['Tide'],
    });
    expect(doneB.d).toMatchObject({ got: { items: [{ id: 'dual_adepts_glove', qty: 1 }] } });
    expect(await ta.closed).toBe(4100);

    const invA = await inventory(a.cookie);
    const invB = await inventory(b.cookie);
    expect(qty(invA, 'items', 'dual_adepts_glove')).toBe(0);
    expect(qty(invA, 'cards', 'scout')).toBe(2);
    expect(qty(invA, 'cards', 'last_word')).toBe(2);
    expect(qty(invB, 'items', 'dual_adepts_glove')).toBe(2);
    expect(qty(invB, 'cards', 'scout')).toBe(0);
    expect(qty(invB, 'cards', 'last_word')).toBe(0);
    // Logged for support and fraud review; the loadout is marked invalid until fixed.
    const logged = await withDb((db) => db.audit.listForPlayer(a.id));
    expect(logged.map((e) => e.kind)).toContain('trade');
    expect(await withDb((db) => db.trades.get(id))).toMatchObject({ aId: a.id, bId: b.id });
    const row = await withDb((db) => db.loadouts.get(a.id, saved.data.id));
    expect(row?.isValid).toBe(false);

    // R-SEC-001: B only ever saw offers: nothing A kept back, no loadout, nothing "equipped".
    const seen = JSON.stringify(tb.msgs);
    expect(seen).not.toContain('hit_and_run');
    expect(seen).not.toMatch(/equip|loadout|owned|inventory|elements|sets/i);
  });

  it('R-SEC-004 a trade whose items went meanwhile changes nothing and reopens; declining ends it', async () => {
    const { a, b, ta, tb, id } = await negotiate('trade');
    ta.send('offer', { items: [{ id: 'dual_adepts_glove', qty: 1 }], cards: [] });
    await state(tb, (d) => JSON.stringify(d.them.offer).includes('dual_adepts_glove'));
    // The Glove leaves A's inventory behind the session's back.
    expect(await withDb((db) => db.inventory.spend(a.id, 'item', 'dual_adepts_glove', 1))).toBe(
      true,
    );
    const before = [await inventory(a.cookie), await inventory(b.cookie)];
    const from = ta.msgs.length;
    await readyAndConfirm(ta, tb);
    const failed = await state(ta, (d) => d.failure !== null, from);
    expect(failed).toMatchObject({ phase: 'open', failure: 'not_owned', me: { ready: false } });
    expect([await inventory(a.cookie), await inventory(b.cookie)]).toEqual(before);
    expect(await withDb((db) => db.trades.get(id))).toBeNull();
    // B declines: both are told and the session is over.
    expect((await call('POST', `/api/trades/${id}/decline`, undefined, b.cookie)).status).toBe(204);
    expect((await ta.wait('tend')).d).toEqual({ reason: 'cancelled', by: 'them' });
    expect(
      (await call<{ error: string }>('POST', `/api/trades/${id}/ticket`, undefined, a.cookie)).data
        .error,
    ).toBe('closed');
  });

  it('R-FMT-006 R-SEC-004 a wager battle: consent, escrow at the start, the loadout snapshot keeps the staked item, the winner takes both stakes once', async () => {
    const { a, b, za, zb, ta, tb } = await negotiate('wager', 'vanguard');
    // A fights with the Glove A stakes (DD-78: the newest legal saved loadout).
    await call('PUT', '/api/loadouts', { name: 'Tide', loadout: TIDE }, a.cookie);
    ta.send('offer', { items: [{ id: 'dual_adepts_glove', qty: 1 }], cards: [] });
    tb.send('offer', { items: [], cards: [{ id: 'scout', qty: 1 }] });
    await state(ta, (d) => JSON.stringify(d.them.offer).includes('scout'));
    // Either player may change the format; that resets the marks too.
    const f = await state(tb, () => true);
    tb.send('ready', { rev: f.rev, on: true });
    tb.send('format', { format: 'first_blood' });
    await state(ta, (d) => d.rev > f.rev && d.reset === 'them');
    await readyAndConfirm(ta, tb);
    const doneA = await ta.wait('tdone');
    const doneB = await tb.wait('tdone');
    expect(doneA.d.mode).toBe('wager');
    const battleId = String(doneA.d.battleId);
    expect(doneB.d.battleId).toBe(battleId);
    expect(doneA.d.url).not.toBe(doneB.d.url);

    // The stakes are in escrow from the start ...
    expect(qty(await inventory(a.cookie), 'items', 'dual_adepts_glove')).toBe(0);
    expect(qty(await inventory(b.cookie), 'cards', 'scout')).toBe(0);
    const escrow = await withDb((db) => db.wagers.escrowByBattle(battleId));
    expect(escrow).toMatchObject({
      status: 'escrowed',
      aId: a.id,
      bId: b.id,
      format: 'first_blood',
    });
    // ... while A's battle loadout still holds the staked Glove (9.5).
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
    const seats = await runInDurableObject(
      stub,
      (room: BattleRoom) =>
        (room as unknown as { core: { snapshot(): BattleSnapshot } }).core.snapshot().seats,
    );
    const aSide = (['white', 'black'] as const).find(
      (s) => 'playerId' in seats[s] && seats[s].playerId === a.id,
    ) as Side;
    expect(seats[aSide].loadout.items).toContain('dual_adepts_glove');

    // B resigns: A wins both stakes.
    const ba = await track(String(doneA.d.url));
    const bb = await track(String(doneB.d.url));
    ba.send('hello', { from: 0 });
    bb.send('hello', { from: 0 });
    expect((await bb.wait('bstart')).d.format).toBe('first_blood');
    await ba.wait('bstart');
    const fa = za.msgs.length;
    const fb = zb.msgs.length;
    bb.send('resign');
    expect((await ba.wait('bend')).d.result).toMatchObject({ winner: aSide });
    const won = await za.wait('wagerEnd', fa, 10_000);
    expect(won.d).toMatchObject({
      result: 'won',
      items: [{ id: 'dual_adepts_glove', qty: 1 }],
      cards: [{ id: 'scout', qty: 1 }],
    });
    expect((await zb.wait('wagerEnd', fb, 10_000)).d).toMatchObject({
      result: 'lost',
      items: [],
      cards: [],
    });
    const invA = await inventory(a.cookie);
    expect(qty(invA, 'items', 'dual_adepts_glove')).toBe(1);
    expect(qty(invA, 'cards', 'scout')).toBe(2);
    expect(qty(await inventory(b.cookie), 'cards', 'scout')).toBe(0);
    const settled = await withDb((db) => db.wagers.escrowByBattle(battleId));
    expect(settled?.status).toBe('settled');
    expect((await withDb((db) => db.wagers.getByBattle(battleId)))?.status).toBe('settled');
    // Exactly once: a repeated settlement (a retry, the session's safety net) changes nothing.
    expect(await withDb((db) => db.wagers.settle(settled?.id ?? '', { winnerId: b.id }))).toEqual({
      status: 'duplicate',
    });
    expect(qty(await inventory(a.cookie), 'cards', 'scout')).toBe(2);
    // R-SEC-001: the stakes never said whether anything was equipped.
    expect(JSON.stringify(tb.msgs)).not.toMatch(/equip|loadout|elements|sets/i);
  });

  it('R-FMT-006 a drawn wager battle returns each stake', async () => {
    const { a, b, ta, tb } = await negotiate('wager');
    ta.send('offer', { items: [], cards: [{ id: 'hit_and_run', qty: 1 }] });
    tb.send('offer', { items: [], cards: [{ id: 'last_word', qty: 1 }] });
    await state(ta, (d) => JSON.stringify(d.them.offer).includes('last_word'));
    await readyAndConfirm(ta, tb);
    const doneA = await ta.wait('tdone');
    const doneB = await tb.wait('tdone');
    const battleId = String(doneA.d.battleId);
    expect(qty(await inventory(a.cookie), 'cards', 'hit_and_run')).toBe(0);
    const ba = await track(String(doneA.d.url));
    const bb = await track(String(doneB.d.url));
    ba.send('hello', { from: 0 });
    bb.send('hello', { from: 0 });
    await ba.wait('bstart');
    await bb.wait('bstart');
    ba.send('draw');
    await bb.wait('drawOffer');
    bb.send('drawReply', { accept: true });
    expect((await bb.wait('bend')).d.result).toMatchObject({ winner: null });
    const until = Date.now() + 10_000;
    while ((await withDb((db) => db.wagers.escrowByBattle(battleId)))?.status === 'escrowed') {
      if (Date.now() > until) throw new Error('the wager was not settled');
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await withDb((db) => db.wagers.escrowByBattle(battleId)))?.outcome).toBe('draw');
    expect(qty(await inventory(a.cookie), 'cards', 'hit_and_run')).toBe(1);
    expect(qty(await inventory(a.cookie), 'cards', 'last_word')).toBe(1);
    expect(qty(await inventory(b.cookie), 'cards', 'last_word')).toBe(1);
    expect(qty(await inventory(b.cookie), 'cards', 'hit_and_run')).toBe(1);
  });
});
