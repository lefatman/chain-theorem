/**
 * Report, mute and block, the admin console, suspensions and chat bans through the real Worker (M6
 * 6.4, `pnpm test:workers`): ZoneRoom, TradeSession, Matchmaker and BattleRoom Durable Objects with
 * local D1 inside workerd. Covers R-SEC-011 (report, mute and block for everyone, applied where
 * lines are delivered), R-WORLD-004 (blocked pairs refused like an offline or unavailable target;
 * trade invitation limits; guild invitation expiry; battles outside the zone mark the player
 * battling), R-SEC-006 (a suspension revokes sessions, refuses sign-in, tickets and sockets and
 * closes live ones) and R-SEC-010 (export and deletion).
 */
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { SAFETY, TRADE_INVITES } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type { SafetyLists, TradeTicket, WorldTicket } from '@chain-theorem/protocol';
import type { BattleSnapshot } from '../src/battle/index.ts';
import type { ConsoleMailSender } from '../src/auth/mail.ts';
import { mailer } from '../src/api/auth.ts';
import { sessionCookieName } from '../src/auth/cookies.ts';
import { getDb, releaseDb } from '../src/db.ts';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import { BASE, call, openSocket, signUp, type Sock } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const LOADOUT = { elements: ['tide'], items: [], sets: [['scout']] };

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function track(path: string): Promise<Sock> {
  const s = await openSocket(path);
  open.push(s);
  return s;
}

/** Enter the world; resolves once the zone snapshot arrived. */
async function enter(cookie: string): Promise<Sock> {
  const t = await call<WorldTicket>('POST', '/api/world/ticket', undefined, cookie);
  expect(t.status).toBe(200);
  const s = await track(t.data.url);
  s.send('hello');
  await s.wait('zsnap');
  return s;
}

/** A paying subscriber (trades and wagers are for subscribers, 14.4). */
async function subscriber(base: string): Promise<{ cookie: string; id: string; email: string }> {
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

/** The magic-link flow for an existing (or new) account: the verify answer and the cookie. */
async function signIn(
  email: string,
  name = uniq('Mod'),
): Promise<{ status: number; data: Record<string, unknown>; cookie: string }> {
  await call('POST', '/api/auth/start', { email });
  const sent = (mailer(env) as ConsoleMailSender).sent;
  const mail = [...sent].reverse().find((m) => m.to === email);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(mail?.text ?? '')?.[1] ?? '');
  const v = await call<Record<string, unknown>>('POST', '/api/auth/verify', { token });
  if (v.data.status === 'needs_profile') {
    const done = await call<Record<string, unknown>>('POST', '/api/auth/complete', {
      signup: v.data.signup,
      name,
      dob: '1985-05-05',
    });
    return {
      status: done.status,
      data: done.data,
      cookie: (done.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
    };
  }
  return {
    status: v.status,
    data: v.data,
    cookie: (v.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
  };
}

/**
 * The admin (`mod@example.com` is in ADMIN_EMAILS, vitest.config.ts) with a fresh session made in
 * the database, so repeated tests never hit the magic-link rate limit.
 */
async function admin(): Promise<{ cookie: string; id: string }> {
  return withDb(async (db) => {
    const p =
      (await db.players.getByEmail('mod@example.com')) ??
      (await db.players.create({
        email: 'mod@example.com',
        displayName: 'Moderator',
        adultFrom: Date.UTC(2003, 0, 1),
      }));
    const { token } = await db.sessions.create(p.id, { ttlMs: DAY });
    return { cookie: `${sessionCookieName(false)}=${token}`, id: p.id };
  });
}

async function saveLoadout(cookie: string): Promise<string> {
  const r = await call<{ id: string; valid: boolean }>(
    'PUT',
    '/api/loadouts',
    { name: 'Tide', loadout: LOADOUT },
    cookie,
  );
  expect(r.data.valid).toBe(true);
  return r.data.id;
}

async function waitFor(
  s: Sock,
  pred: (m: { t: string; d: Record<string, unknown> }) => boolean,
  from = 0,
  ms = 5000,
): Promise<{ t: string; d: Record<string, unknown> }> {
  const until = Date.now() + ms;
  for (;;) {
    const m = s.msgs.slice(from).find(pred);
    if (m) return m;
    if (Date.now() > until)
      throw new Error(`timed out; got ${s.msgs.map((x) => `${x.t}`).join(',')}`);
    await sleep(10);
  }
}

const chatFrom = (s: Sock, from: number, id: string) =>
  s.msgs.slice(from).filter((m) => m.t === 'chatmsg' && m.d.from === id);

describe('report, mute and block (M6 6.4)', () => {
  it('R-SEC-011 report, mute and block stay available to everyone: a minor on a trial account', async () => {
    const kid = await signUp(env, uniq('Kid'), '2012-03-04');
    const other = await signUp(env, uniq('Oth'));
    const lists = await call<SafetyLists>('GET', '/api/safety', undefined, kid.cookie);
    expect(lists.data).toEqual({
      muted: [],
      blocked: [],
      limits: { mutes: SAFETY.maxMutes, blocks: SAFETY.maxBlocks },
    });
    const muted = await call<SafetyLists>('POST', '/api/mutes', { id: other.id }, kid.cookie);
    expect(muted.data.muted.map((m) => m.id)).toEqual([other.id]);
    const blocked = await call<SafetyLists>('POST', '/api/blocks', { id: other.id }, kid.cookie);
    expect(blocked.data.blocked).toMatchObject([{ id: other.id }]);
    const report = await call<{ id: string }>(
      'POST',
      '/api/reports',
      {
        target: other.id,
        reason: 'harassment',
        note: 'kept messaging me',
        context: { chat: { text: 'hey kid', ch: 'whisper' } },
      },
      kid.cookie,
    );
    expect(report.status).toBe(201);
    expect(
      (await call('DELETE', `/api/mutes/${other.id}`, undefined, kid.cookie)).data,
    ).toMatchObject({ muted: [] });
    expect(
      (await call('DELETE', `/api/blocks/${other.id}`, undefined, kid.cookie)).data,
    ).toMatchObject({ blocked: [] });
    // Refusals: self, an unknown player, a reason off the list, a note that is too long.
    const bad = async (b: unknown) =>
      (await call<{ error: string }>('POST', '/api/reports', b, kid.cookie)).status;
    expect(await bad({ target: kid.id, reason: 'spam' })).toBe(400);
    expect(await bad({ target: crypto.randomUUID(), reason: 'spam' })).toBe(404);
    expect(await bad({ target: other.id, reason: 'boredom' })).toBe(400);
    expect(await bad({ target: other.id, reason: 'spam', note: 'x'.repeat(501) })).toBe(400);
    expect((await call('POST', '/api/mutes', { id: kid.id }, kid.cookie)).status).toBe(400);
    expect((await call('POST', '/api/mutes', { id: 'nobody' }, kid.cookie)).status).toBe(404);
    // Signed out: 401.
    expect((await call('GET', '/api/safety')).status).toBe(401);
  });

  it('R-SEC-011 a reporter may file a limited number of reports per day', async () => {
    const a = await signUp(env, uniq('Rep'));
    const b = await signUp(env, uniq('Tgt'));
    for (let i = 1; i < SAFETY.reportsPerDay; i++)
      await withDb((db) =>
        db.moderation.fileReport({
          reporterId: a.id,
          targetId: b.id,
          reason: 'spam',
          perDay: SAFETY.reportsPerDay,
        }),
      );
    const last = await call('POST', '/api/reports', { target: b.id, reason: 'spam' }, a.cookie);
    expect(last.status).toBe(201);
    const over = await call<{ error: string }>(
      'POST',
      '/api/reports',
      { target: b.id, reason: 'spam' },
      a.cookie,
    );
    expect([over.status, over.data.error]).toEqual([429, 'too_many_reports']);
  });

  it('R-SEC-011 a mute applies to live zone chat before the next line; the muted player is not told', async () => {
    const a = await signUp(env, uniq('Amy'));
    const b = await signUp(env, uniq('Bo'));
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    let from = za.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'first' });
    await waitFor(za, (m) => m.t === 'chatmsg' && m.d.text === 'first', from);
    await call('POST', '/api/mutes', { id: b.id }, a.cookie);
    from = za.msgs.length;
    const fromB = zb.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'second' });
    // B sees its own line (nothing tells B); A does not.
    await waitFor(zb, (m) => m.t === 'chatmsg' && m.d.text === 'second', fromB);
    zb.send('chat', { ch: 'whisper', to: a.id, text: 'psst' });
    await sleep(300);
    expect(chatFrom(za, from, b.id)).toEqual([]);
    expect(zb.msgs.slice(fromB).filter((m) => m.t === 'err')).toEqual([]);
    // It survives a reconnect (loaded into PlayerInit).
    za.ws.close(1000);
    await sleep(100);
    const za2 = await enter(a.cookie);
    from = za2.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'third' });
    await sleep(300);
    expect(chatFrom(za2, from, b.id)).toEqual([]);
    await call('DELETE', `/api/mutes/${b.id}`, undefined, a.cookie);
    zb.send('chat', { ch: 'zone', text: 'fourth' });
    await waitFor(za2, (m) => m.t === 'chatmsg' && m.d.text === 'fourth', from);
  });

  it('R-SEC-011 R-WORLD-004 a block refuses whispers, challenges and party invites both ways like an offline or busy player', async () => {
    const a = await signUp(env, uniq('Ada'));
    const b = await signUp(env, uniq('Ben'));
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    // The answer for a player who is not online, for comparison.
    let from = zb.msgs.length;
    zb.send('chat', { ch: 'whisper', to: crypto.randomUUID(), text: 'anyone?' });
    const offline = (await zb.wait('err', from)).d.code;
    expect(offline).toBe('whisper_refused');
    await call('POST', '/api/blocks', { id: b.id }, a.cookie);
    for (const [s, to] of [
      [zb, a.id],
      [za, b.id],
    ] as const) {
      from = s.msgs.length;
      s.send('chat', { ch: 'whisper', to, text: 'hi' });
      expect((await s.wait('err', from)).d.code).toBe(offline);
      from = s.msgs.length;
      s.send('chal', { to, format: 'first_blood' });
      expect((await s.wait('err', from)).d.code).toBe('busy');
      from = s.msgs.length;
      s.send('party', { op: 'invite', to });
      expect((await s.wait('err', from)).d.code).toBe('not_online');
    }
    await sleep(200);
    for (const s of [za, zb])
      expect(s.msgs.filter((m) => ['chalIn', 'partyInvite'].includes(m.t))).toEqual([]);
    // The blocked player's zone lines are hidden from the blocker.
    from = za.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'can you hear me' });
    await sleep(300);
    expect(chatFrom(za, from, b.id)).toEqual([]);
  });

  it('R-WORLD-004 blocking ends a friendship; a blocked pair cannot trade or guild-invite, and the refusals leak nothing', async () => {
    const a = await subscriber('Cal');
    const b = await subscriber('Dee');
    const c = await subscriber('Eve');
    expect((await call('POST', '/api/friends', { to: b.id }, a.cookie)).data).toEqual({
      status: 'requested',
    });
    expect((await call('POST', '/api/friends', { to: a.id }, b.cookie)).data).toEqual({
      status: 'friends',
    });
    await call('POST', '/api/blocks', { id: b.id }, a.cookie);
    const friends = await call<{ friends: unknown[] }>('GET', '/api/friends', undefined, a.cookie);
    expect(friends.data.friends).toEqual([]);
    // The blocker cannot send a request; the blocked player's request is never shown.
    expect(
      (await call<{ error: string }>('POST', '/api/friends', { to: b.id }, a.cookie)).data.error,
    ).toBe('blocked');
    expect((await call('POST', '/api/friends', { to: a.id }, b.cookie)).data).toEqual({
      status: 'requested',
    });
    expect(
      (await call<{ friends: unknown[] }>('GET', '/api/friends', undefined, a.cookie)).data.friends,
    ).toEqual([]);

    // Trades: B is in the world, yet the answer is the offline one.
    const zb = await enter(b.cookie);
    const trade = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: b.id, mode: 'trade' },
      a.cookie,
    );
    expect([trade.status, trade.data.error]).toEqual([409, 'not_online']);
    const back = await call<{ error: string }>(
      'POST',
      '/api/trades',
      { with: a.id, mode: 'wager' },
      b.cookie,
    );
    expect([back.status, back.data.error]).toEqual([409, 'not_online']);
    await sleep(200);
    expect(zb.msgs.filter((m) => m.t === 'tradeIn')).toEqual([]);

    // Guild invitations: to the inviter it looks sent (pending); B never sees it.
    const g = await call<{ guild: { id: string } }>(
      'POST',
      '/api/guilds',
      { name: uniq('Rooks'), tag: 'RK' + String(names % 100) },
      a.cookie,
    );
    expect(g.status).toBe(200);
    const inv = await call<{ guild: { invited: { id: string }[] } }>(
      'POST',
      '/api/guilds/invites',
      { to: b.id },
      a.cookie,
    );
    expect(inv.status).toBe(200);
    expect(inv.data.guild.invited.map((i) => i.id)).toEqual([b.id]);
    expect(
      (await call<{ invites: unknown[] }>('GET', '/api/guilds/me', undefined, b.cookie)).data
        .invites,
    ).toEqual([]);
    expect(
      (await call('POST', `/api/guilds/invites/${g.data.guild.id}/accept`, undefined, b.cookie))
        .status,
    ).toBe(404);
    // Someone else is invited and sees it.
    await call('POST', '/api/guilds/invites', { to: c.id }, a.cookie);
    expect(
      (await call<{ invites: unknown[] }>('GET', '/api/guilds/me', undefined, c.cookie)).data
        .invites,
    ).toHaveLength(1);
  });

  it('R-SEC-010 the data export includes own mutes, blocks and reports; deletion removes them', async () => {
    const a = await signUp(env, uniq('Exp'));
    const b = await signUp(env, uniq('Obj'));
    await call('POST', '/api/mutes', { id: b.id }, a.cookie);
    await call('POST', '/api/blocks', { id: b.id }, a.cookie);
    await call('POST', '/api/reports', { target: b.id, reason: 'spam', note: 'ads' }, a.cookie);
    await call('POST', '/api/reports', { target: a.id, reason: 'hate', note: 'by b' }, b.cookie);
    const ex = await call<Record<string, unknown>>('GET', '/api/me/export', undefined, a.cookie);
    expect(ex.data.mutes).toMatchObject([{ targetId: b.id }]);
    expect(ex.data.blocks).toMatchObject([{ targetId: b.id }]);
    expect(ex.data.reportsFiled).toMatchObject([{ targetId: b.id, reason: 'spam', note: 'ads' }]);
    expect(ex.data.reportsAbout).toMatchObject([{ reason: 'hate', status: 'open' }]);
    // The reported player never learns who reported them.
    expect(JSON.stringify(ex.data.reportsAbout)).not.toContain(b.id);
    expect(JSON.stringify(ex.data)).not.toContain('by b');
    expect((await call('DELETE', '/api/me', undefined, a.cookie)).status).toBe(204);
    const left = await withDb(async (db) => ({
      mutes: await db.safety.mutedIds(a.id),
      blocks: await db.safety.blockedIds(a.id),
      about: await db.moderation.reportsAbout(a.id),
      filed: await db.moderation.reportsAbout(b.id),
    }));
    expect(left.mutes).toEqual([]);
    expect(left.blocks).toEqual([]);
    expect(left.about).toEqual([]);
    expect(left.filed.map((r) => r.reporterId)).toEqual([null]);
  });
});

describe('battles outside the zone (M6 6.4)', () => {
  it('R-WORLD-004 a battle started from the online screen marks the player battling in the world: no consent challenges mid-battle', async () => {
    const a = await signUp(env, uniq('Fay'));
    const b = await signUp(env, uniq('Gus'));
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    const loadout = await saveLoadout(a.cookie);
    let from = zb.msgs.length;
    const t = await call<{ url: string; battleId: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'first_blood', loadoutId: loadout, tier: 'wild' },
      a.cookie,
    );
    await waitFor(zb, (m) => m.t === 'zbattle' && m.d.p === a.id && m.d.battling === true, from);
    from = zb.msgs.length;
    zb.send('chal', { to: a.id, format: 'first_blood' });
    expect((await zb.wait('err', from)).d.code).toBe('busy');
    const bs = await track(t.data.url);
    bs.send('hello', { from: 0 });
    await bs.wait('bstart');
    from = zb.msgs.length;
    bs.send('resign');
    await bs.wait('bend');
    await waitFor(zb, (m) => m.t === 'zbattle' && m.d.p === a.id && m.d.battling === false, from);
    await waitFor(za, (m) => m.t === 'zbattle' && m.d.p === a.id && m.d.battling === false);
  });

  it('R-WORLD-004 R-FMT-006 an item wager battle marks both players battling until it is settled', async () => {
    const a = await subscriber('Hal');
    const b = await subscriber('Ida');
    const c = await signUp(env, uniq('Jo'));
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    const zc = await enter(c.cookie);
    const started = await call<TradeTicket>(
      'POST',
      '/api/trades',
      { with: b.id, mode: 'wager', format: 'first_blood' },
      a.cookie,
    );
    expect(started.status).toBe(200);
    await zb.wait('tradeIn');
    const tb = await call<TradeTicket>(
      'POST',
      `/api/trades/${started.data.id}/ticket`,
      undefined,
      b.cookie,
    );
    const ta = await track(started.data.url);
    const sb = await track(tb.data.url);
    ta.send('hello');
    sb.send('hello');
    const openState = async (s: Sock) =>
      (await waitFor(s, (m) => m.t === 'tstate' && m.d.phase === 'open')).d;
    await openState(ta);
    await openState(sb);
    ta.send('offer', { items: [], cards: [{ id: 'scout', qty: 1 }] });
    sb.send('offer', { items: [], cards: [{ id: 'last_word', qty: 1 }] });
    await waitFor(ta, (m) => m.t === 'tstate' && JSON.stringify(m.d).includes('last_word'));
    await waitFor(sb, (m) => m.t === 'tstate' && JSON.stringify(m.d).includes('scout'));
    const latest = (s: Sock) =>
      [...s.msgs].reverse().find((m) => m.t === 'tstate')?.d as { rev: number };
    const rev = latest(ta).rev;
    ta.send('ready', { rev, on: true });
    sb.send('ready', { rev, on: true });
    await waitFor(
      ta,
      (m) =>
        m.t === 'tstate' &&
        (m.d.me as { ready: boolean }).ready &&
        (m.d.them as { ready: boolean }).ready,
    );
    const fc = zc.msgs.length;
    ta.send('confirm', { rev });
    sb.send('confirm', { rev });
    const done = await ta.wait('tdone', 0, 10_000);
    for (const id of [a.id, b.id])
      await waitFor(zc, (m) => m.t === 'zbattle' && m.d.p === id && m.d.battling === true, fc);
    // Nobody can challenge them mid-battle.
    let from = zc.msgs.length;
    zc.send('chal', { to: a.id, format: 'first_blood' });
    expect((await zc.wait('err', from)).d.code).toBe('busy');
    const doneB = await sb.wait('tdone', 0, 10_000);
    const ba = await track(String(done.d.url));
    const bb = await track(String(doneB.d.url));
    ba.send('hello', { from: 0 });
    bb.send('hello', { from: 0 });
    await ba.wait('bstart');
    await bb.wait('bstart');
    from = zc.msgs.length;
    bb.send('resign');
    await za.wait('wagerEnd', 0, 10_000);
    for (const id of [a.id, b.id])
      await waitFor(zc, (m) => m.t === 'zbattle' && m.d.p === id && m.d.battling === false, from);
  });
});

describe('trade and guild invitations (M6 6.4)', () => {
  it('R-WORLD-004 one open trade invitation per inviter and a per-minute cap: 429 too_many_invites', async () => {
    expect(TRADE_INVITES).toEqual({ open: 1, perMinute: 3 });
    const a = await subscriber('Kit');
    const b = await subscriber('Lin');
    const c = await subscriber('Max');
    await enter(b.cookie);
    await enter(c.cookie);
    const invite = (to: string) =>
      call<TradeTicket & { error: string }>(
        'POST',
        '/api/trades',
        { with: to, mode: 'trade' },
        a.cookie,
      );
    const first = await invite(b.id);
    expect(first.status).toBe(200);
    const second = await invite(c.id);
    expect([second.status, second.data.error]).toEqual([429, 'too_many_invites']);
    await call('POST', `/api/trades/${first.data.id}/decline`, undefined, b.cookie);
    const third = await invite(c.id);
    expect(third.status).toBe(200);
    await call('POST', `/api/trades/${third.data.id}/decline`, undefined, c.cookie);
    const fourth = await invite(b.id);
    expect(fourth.status).toBe(200);
    await call('POST', `/api/trades/${fourth.data.id}/decline`, undefined, b.cookie);
    // Three sent within the minute: the cap holds even with nothing waiting.
    const fifth = await invite(c.id);
    expect([fifth.status, fifth.data.error]).toEqual([429, 'too_many_invites']);
    // Each invitation is logged for both players (support and fraud review).
    const logged = await withDb((db) => db.audit.listKinds(b.id, ['trade.invited'], 0));
    expect(logged).toHaveLength(2);
  });

  it('R-WORLD-004 guild invitations expire after seven days', async () => {
    const lead = await signUp(env, uniq('Ned'));
    const x = await signUp(env, uniq('Oz'));
    const g = await call<{ guild: { id: string } }>(
      'POST',
      '/api/guilds',
      { name: uniq('Knights'), tag: 'KN' + String(names % 100) },
      lead.cookie,
    );
    await call('POST', '/api/guilds/invites', { to: x.id }, lead.cookie);
    expect(
      (await call<{ invites: unknown[] }>('GET', '/api/guilds/me', undefined, x.cookie)).data
        .invites,
    ).toHaveLength(1);
    await withDb((db) =>
      db.kysely
        .updateTable('guild_invites')
        .set({ created_at: Date.now() - 7 * DAY - 1000 })
        .where('player_id', '=', x.id)
        .execute(),
    );
    expect(
      (await call<{ invites: unknown[] }>('GET', '/api/guilds/me', undefined, x.cookie)).data
        .invites,
    ).toEqual([]);
    expect(
      (await call('POST', `/api/guilds/invites/${g.data.guild.id}/accept`, undefined, x.cookie))
        .status,
    ).toBe(404);
    const again = await call<{ guild: { invited: { id: string }[] } }>(
      'POST',
      '/api/guilds/invites',
      { to: x.id },
      lead.cookie,
    );
    expect(again.data.guild.invited.map((i) => i.id)).toEqual([x.id]);
    expect(
      (await call('POST', `/api/guilds/invites/${g.data.guild.id}/accept`, undefined, x.cookie))
        .status,
    ).toBe(200);
  });
});

describe('the admin console (M6 6.4)', () => {
  it('R-SEC-011 reports reach the queue oldest first; an admin reviews or dismisses them; non-admins are refused', async () => {
    const mod = await admin();
    const a = await signUp(env, uniq('Pia'));
    const b = await signUp(env, uniq('Quin'));
    const r1 = await call<{ id: string }>(
      'POST',
      '/api/reports',
      { target: b.id, reason: 'hate', context: { chat: { text: 'nasty', ch: 'zone' } } },
      a.cookie,
    );
    const r2 = await call<{ id: string }>(
      'POST',
      '/api/reports',
      { target: b.id, reason: 'spam' },
      a.cookie,
    );
    expect((await call('GET', '/api/admin/reports', undefined, a.cookie)).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/admin`, { headers: { cookie: a.cookie } })).status).toBe(403);
    const q = await call<{ reports: { id: string; reporter: { id: string } }[]; open: number }>(
      'GET',
      '/api/admin/reports',
      undefined,
      mod.cookie,
    );
    const ids = q.data.reports.map((r) => r.id);
    expect(ids.indexOf(r1.data.id)).toBeLessThan(ids.indexOf(r2.data.id));
    expect(q.data.reports.find((r) => r.id === r1.data.id)).toMatchObject({
      reason: 'hate',
      reporter: { id: a.id },
      target: { id: b.id },
      context: { chat: { text: 'nasty', ch: 'zone' } },
    });
    // The page lists it too, with a strict CSP and no script.
    const res = await SELF.fetch(`${BASE}/admin`, { headers: { cookie: mod.cookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(html).toContain(`/admin/reports/${r1.data.id}`);
    expect(html).toContain('nasty');
    expect(html).toContain('/admin/cost');
    expect(html).not.toContain('<script');
    const reviewed = await call<{ report: { status: string; resolvedBy: { id: string } } }>(
      'POST',
      `/api/admin/reports/${r1.data.id}`,
      { action: 'review', note: 'warned' },
      mod.cookie,
    );
    expect(reviewed.data.report).toMatchObject({ status: 'reviewed', resolvedBy: { id: mod.id } });
    expect(
      (await call('POST', `/api/admin/reports/${r1.data.id}`, { action: 'dismiss' }, mod.cookie))
        .status,
    ).toBe(404);
    // A form post from the page: 303 back to the console.
    const form = await SELF.fetch(`${BASE}/admin/reports/${r2.data.id}`, {
      method: 'POST',
      headers: {
        cookie: mod.cookie,
        origin: BASE,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'action=dismiss&note=duplicate',
      redirect: 'manual',
    });
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('/admin?done=dismissed');
    // A cross-site form post is refused (the app's origin check).
    const csrf = await SELF.fetch(`${BASE}/admin/players/${b.id}/suspend`, {
      method: 'POST',
      headers: {
        cookie: mod.cookie,
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'indefinite=1&reason=x',
      redirect: 'manual',
    });
    expect(csrf.status).toBe(403);
    const after = await call<{ reports: { id: string }[] }>(
      'GET',
      '/api/admin/reports',
      undefined,
      mod.cookie,
    );
    expect(after.data.reports.map((r) => r.id)).not.toContain(r1.data.id);
    expect(after.data.reports.map((r) => r.id)).not.toContain(r2.data.id);
    // Audited with the admin's id.
    const log = await withDb((db) => db.audit.listKinds(mod.id, ['admin.report_reviewed'], 0));
    expect(log.map((e) => e.payload.report)).toContain(r1.data.id);
  });

  it('R-SEC-011 lookup by name or email shows account facts, reports and audit entries without the full email', async () => {
    const mod = await admin();
    const p = await signUp(env, uniq('Rex'));
    const byName = await call<{ players: { id: string; email: string }[] }>(
      'GET',
      `/api/admin/players?q=${encodeURIComponent(p.email.split('-')[0] ?? '')}`,
      undefined,
      mod.cookie,
    );
    expect(byName.data.players.map((x) => x.id)).toContain(p.id);
    const byEmail = await call<{ players: { id: string; email: string }[] }>(
      'GET',
      `/api/admin/players?q=${encodeURIComponent(p.email)}`,
      undefined,
      mod.cookie,
    );
    expect(byEmail.data.players.map((x) => x.id)).toEqual([p.id]);
    expect(byEmail.data.players[0]?.email).toMatch(/^r\*\*\*@example\.com$/);
    const facts = await call<Record<string, unknown>>(
      'GET',
      `/api/admin/players/${p.id}`,
      undefined,
      mod.cookie,
    );
    expect(facts.data).toMatchObject({
      id: p.id,
      level: 1,
      access: 'trial',
      suspension: null,
      chatBanUntil: null,
      reports: { total: 0, open: 0 },
    });
    expect(JSON.stringify(facts.data)).not.toContain(p.email);
    const page = await SELF.fetch(`${BASE}/admin/players/${p.id}`, {
      headers: { cookie: mod.cookie },
    });
    const html = await page.text();
    expect(html).toContain('Suspend');
    expect(html).toContain('Chat ban');
    expect(html).not.toContain(p.email);
  });

  it('R-SEC-011 a chat ban drops the player lines on every channel and tells them once; lifting it restores chat', async () => {
    const mod = await admin();
    const a = await signUp(env, uniq('Sam'));
    const b = await signUp(env, uniq('Tom'));
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    const ban = await call<{ player: { chatBanUntil: number } }>(
      'POST',
      `/api/admin/players/${b.id}/chat-ban`,
      { hours: 1, reason: 'spamming the zone' },
      mod.cookie,
    );
    expect(ban.status).toBe(200);
    expect(ban.data.player.chatBanUntil).toBeGreaterThan(Date.now());
    let from = za.msgs.length;
    const fromB = zb.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'one' });
    zb.send('chat', { ch: 'whisper', to: a.id, text: 'two' });
    zb.send('chat', { ch: 'zone', text: 'three' });
    await sleep(400);
    expect(chatFrom(za, from, b.id)).toEqual([]);
    const told = zb.msgs.slice(fromB).filter((m) => m.t === 'err');
    expect(told.map((m) => m.d.code)).toEqual(['chat_banned']);
    // The ban survives a reconnect; a lifted ban restores chat at once.
    expect(
      (await call('POST', `/api/admin/players/${b.id}/chat-unban`, undefined, mod.cookie)).status,
    ).toBe(200);
    from = za.msgs.length;
    zb.send('chat', { ch: 'zone', text: 'back' });
    await waitFor(za, (m) => m.t === 'chatmsg' && m.d.text === 'back', from);
    const logB = await withDb((db) => db.audit.listKinds(b.id, ['moderation.chat_ban'], 0));
    expect(logB).toHaveLength(1);
    expect(JSON.stringify(logB)).not.toContain(mod.id);
    const logMod = await withDb((db) => db.audit.listKinds(mod.id, ['admin.chat_ban'], 0));
    expect(logMod.map((e) => e.payload.target)).toEqual([b.id]);
  });

  it('R-SEC-006 a suspension revokes sessions, refuses sign-in, tickets and sockets, and closes the zone, trade, queue and battle sockets', async () => {
    const mod = await admin();
    const a = await subscriber('Una');
    const b = await subscriber('Vic');
    const za = await enter(a.cookie);
    const zb = await enter(b.cookie);
    // B: a trade with A, a queue socket and an NPC battle, all live.
    const trade = await call<TradeTicket>(
      'POST',
      '/api/trades',
      { with: b.id, mode: 'trade' },
      a.cookie,
    );
    await zb.wait('tradeIn');
    const tb = await call<TradeTicket>(
      'POST',
      `/api/trades/${trade.data.id}/ticket`,
      undefined,
      b.cookie,
    );
    const ta = await track(trade.data.url);
    ta.send('hello');
    const sb = await track(tb.data.url);
    sb.send('hello');
    await sb.wait('tstate');
    const loadout = await saveLoadout(b.cookie);
    const qt = await call<{ url: string }>(
      'POST',
      '/api/queue/ticket',
      { format: 'full', loadoutId: loadout },
      b.cookie,
    );
    const qs = await track(qt.data.url);
    await qs.wait('queued');
    const bt = await call<{ url: string; battleId: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'first_blood', loadoutId: loadout, tier: 'wild' },
      b.cookie,
    );
    const bs = await track(bt.data.url);
    bs.send('hello', { from: 0 });
    await bs.wait('bstart');
    // A ticket issued before the suspension (tickets live 60 s).
    const early = await call<WorldTicket>('POST', '/api/world/ticket', undefined, b.cookie);

    const res = await call<{
      player: { suspension: { until: number | null } };
      closed: { zone: boolean; trades: number; queues: number; battles: number };
    }>(
      'POST',
      `/api/admin/players/${b.id}/suspend`,
      { hours: null, reason: 'cheating' },
      mod.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.data.player.suspension).toMatchObject({ until: null });
    expect(res.data.closed).toEqual({ zone: true, trades: 1, queues: 1, battles: 1 });
    expect(await zb.closed).toBe(4003);
    expect(await qs.closed).toBe(4003);
    expect(await bs.closed).toBe(4003);
    await sb.closed;
    expect((await ta.wait('tend')).d).toMatchObject({ reason: 'cancelled', by: 'them' });
    // The battle goes on for the grace period: B is disconnected and cannot come back.
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(bt.data.battleId));
    const conn = await runInDurableObject(
      stub,
      (room: BattleRoom) =>
        (room as unknown as { core: { snapshot(): BattleSnapshot } }).core.snapshot().conn,
    );
    const side = Object.values(conn).find((c) => c.graceUntil !== null);
    expect(side).toMatchObject({ connected: false });
    // Other players see B leave the zone.
    await waitFor(za, (m) => m.t === 'zleave' && m.d.p === b.id);

    // Sessions revoked: B is signed out everywhere, and nothing new starts.
    expect((await call<{ me: unknown }>('GET', '/api/me', undefined, b.cookie)).data.me).toBeNull();
    expect((await call('POST', '/api/world/ticket', undefined, b.cookie)).status).toBe(401);
    await expect(openSocket(early.data.url)).rejects.toThrow(/403/);
    const again = await signIn(b.email ?? '', 'x');
    expect(again.status).toBe(403);
    expect(again.data).toMatchObject({ error: 'suspended', until: null });
    expect(typeof again.data.data).toBe('string');
    expect(again.cookie).toBe('');

    // Lifting the suspension lets B sign in and play again.
    expect(
      (await call('POST', `/api/admin/players/${b.id}/unsuspend`, undefined, mod.cookie)).status,
    ).toBe(200);
    const back = await signIn(b.email ?? '', 'x');
    expect(back.status).toBe(200);
    expect((await call('POST', '/api/world/ticket', undefined, back.cookie)).status).toBe(200);
    // Admins cannot suspend themselves; non-admins cannot suspend anyone.
    expect(
      (
        await call(
          'POST',
          `/api/admin/players/${mod.id}/suspend`,
          { hours: 1, reason: 'x' },
          mod.cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          `/api/admin/players/${a.id}/suspend`,
          { hours: 1, reason: 'x' },
          back.cookie,
        )
      ).status,
    ).toBe(403);
    const audit = await withDb((db) => db.audit.listKinds(mod.id, ['admin.suspend'], 0));
    expect(audit.map((e) => e.payload.target)).toContain(b.id);
  });

  it('R-SEC-006 a suspension for a duration ends by itself', async () => {
    const mod = await admin();
    const p = await signUp(env, uniq('Wes'));
    await call(
      'POST',
      `/api/admin/players/${p.id}/suspend`,
      { hours: 1, reason: 'cool down' },
      mod.cookie,
    );
    expect((await signIn(p.email, 'x')).status).toBe(403);
    await withDb((db) =>
      db.kysely
        .updateTable('players')
        .set({ suspended_until: Date.now() - 1 })
        .where('id', '=', p.id)
        .execute(),
    );
    expect((await signIn(p.email, 'x')).status).toBe(200);
  });
  it('R-SEC-010 R-SEC-006 a suspended player can still export and delete their data with the token from the refused sign-in', async () => {
    const p = await signUp(env, uniq('Sus'));
    const mod = await admin();
    const sus = await call(
      'POST',
      `/api/admin/players/${p.id}/suspend`,
      { hours: null, reason: 'spam' },
      mod.cookie,
    );
    expect(sus.status).toBe(200);
    const refused = await signIn(p.email);
    expect(refused.status).toBe(403);
    expect(refused.cookie).toBe('');
    const token = String(refused.data.data);
    // Without the token nothing is served; the token opens only export and deletion.
    expect((await call('GET', '/api/me/export')).status).toBe(401);
    expect((await call('GET', `/api/inventory?data=${encodeURIComponent(token)}`)).status).toBe(
      401,
    );
    const exported = await call<{ player: { id: string } }>(
      'GET',
      `/api/me/export?data=${encodeURIComponent(token)}`,
    );
    expect(exported.status).toBe(200);
    expect(exported.data.player.id).toBe(p.id);
    // A tampered token is refused.
    expect((await call('GET', `/api/me/export?data=${encodeURIComponent(token)}x`)).status).toBe(
      401,
    );
    expect((await call('DELETE', `/api/me?data=${encodeURIComponent(token)}`)).status).toBe(204);
    expect(await withDb((db) => db.players.getById(p.id))).toBeNull();
  });
});
