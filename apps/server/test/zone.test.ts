/**
 * ZoneRoom integration (M5, `pnpm test:workers`): the Worker, ZoneRoom, BattleRoom and Metrics Durable
 * Objects with local D1 inside workerd. Covers entering the world, the Chess Academy, trainer and wild
 * battles with idempotent rewards, chat safety, parties, consent challenges, channel overflow and the
 * cost dashboard.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import {
  battleXp,
  lessonById,
  npcLocation,
  stepFrom,
  walkable,
  world,
  zoneGeometry,
  DISCOVERY_XP,
  type Dir,
} from '@chain-theorem/content/world';
import type { Db } from '@chain-theorem/db';
import type { WorldTicket } from '@chain-theorem/protocol';
import type { Side } from '@chain-theorem/rules';
import { getDb, releaseDb } from '../src/db.ts';
import type { ZoneRoom } from '../src/rooms/zone-room.ts';
import { zoneStub } from '../src/world/routing.ts';
import type { PlayerInit, ZoneCore } from '../src/zone/index.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const open: Sock[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) s.ws.close(1000);
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

const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let names = 0;
const uniq = (base: string) => `${base}${++names}${String(Date.now()).slice(-5)}`;

/** A walkable tile next to an NPC and the direction that faces it. */
function beside(npc: string): { zone: string; x: number; y: number; face: Dir } {
  const at = npcLocation(npc);
  if (!at) throw new Error(`no NPC ${npc}`);
  const g = zoneGeometry(at.zone);
  for (const d of ['s', 'n', 'e', 'w'] as const) {
    const t = stepFrom(at.x, at.y, d);
    if (walkable(g, t.x, t.y)) return { zone: at.zone, x: t.x, y: t.y, face: OPPOSITE[d] };
  }
  throw new Error(`no free tile beside ${npc}`);
}

async function place(id: string, zone: string, x: number, y: number): Promise<void> {
  await withDb((db) => db.world.setPosition(id, zone, x, y));
}

/** Ticket, socket, hello; resolves once the zone snapshot arrived. */
async function enter(cookie: string): Promise<{ s: Sock; snap: Record<string, unknown> }> {
  const t = await call<WorldTicket>('POST', '/api/world/ticket', undefined, cookie);
  expect(t.status).toBe(200);
  const s = await openSocket(t.data.url);
  open.push(s);
  s.send('hello');
  const snap = (await s.wait('zsnap')).d;
  return { s, snap };
}

/** Face `dir` (a step into the NPC only turns), then talk; resolves with the dialog. */
async function talk(s: Sock, npc: string, dir: Dir): Promise<{ options: { id: string }[] }> {
  s.send('step', { dir });
  await sleep(150);
  const from = s.msgs.length;
  s.send('interact', { npc });
  return (await s.wait('dialog', from)).d as { options: { id: string }[] };
}

async function waitFor(
  s: Sock,
  pred: (m: Sock['msgs'][number]) => boolean,
  from = 0,
  ms = 8000,
): Promise<Sock['msgs'][number]> {
  const until = Date.now() + ms;
  for (;;) {
    const m = s.msgs.slice(from).find(pred);
    if (m) return m;
    if (Date.now() > until)
      throw new Error(
        `timed out; got ${s.msgs.map((x) => `${x.t}:${JSON.stringify(x.d).slice(0, 60)}`).join(' | ')}`,
      );
    await sleep(10);
  }
}

interface Pub {
  turn: Side;
  ply: number;
  legal: string[];
}

/** Play legal moves (the NPC answers by itself) until `plies` plies were played, then resign. */
async function playThenResign(url: string, plies: number): Promise<Record<string, unknown>> {
  const b = await openSocket(url);
  open.push(b);
  b.send('hello', { from: 0 });
  const start = (await b.wait('bstart')).d;
  const you = start.you as Side;
  const latest = (): Pub =>
    (b.msgs.filter((m) => m.t === 'bev').at(-1)?.d.public ?? start.public) as Pub;
  let movedAt = -1;
  const until = Date.now() + 10_000;
  while (latest().ply < plies) {
    const pub = latest();
    if (pub.turn === you && pub.legal.length > 0 && movedAt !== pub.ply) {
      b.send('mv', { move: pub.legal[0] });
      movedAt = pub.ply;
    }
    if (Date.now() > until) throw new Error(`stuck at ply ${pub.ply}`);
    await sleep(10);
  }
  const from = b.msgs.length;
  b.send('resign');
  return (await b.wait('bend', from)).d;
}

async function totalXp(cookie: string): Promise<number> {
  return (await call<{ totalXp: number }>('GET', '/api/progress', undefined, cookie)).data.totalXp;
}

describe('ZoneRoom (M5)', () => {
  it('R-WORLD-001 R-SEC-006 R-COST-002 a new player enters the start zone; others see joins and steps; discovery XP is paid once', async () => {
    const a = await signUp(env, uniq('Ana'));
    const b = await signUp(env, uniq('Ben'));
    expect((await call('GET', '/ws/zone/academy_hall?t=forged', undefined, a.cookie)).status).toBe(
      426,
    );
    const bad = await fetchUpgrade('/ws/zone/academy_hall?t=forged');
    expect(bad).toBe(403);
    const { s: sa, snap } = await enter(a.cookie);
    expect(snap).toMatchObject({ zone: world.start.zone, channel: 0 });
    const npcs = (snap.npcs as { id: string }[]).map((n) => n.id);
    expect(npcs).toContain('headmaster_orla');
    const reward = await sa.wait('reward');
    expect(reward.d).toMatchObject({ xp: DISCOVERY_XP, level: 1 });
    const { s: sb } = await enter(b.cookie);
    await waitFor(sa, (m) => m.t === 'zjoin' && m.d.p === b.id);
    // B walks: A sees the step. The start room is small; try each direction until one moves.
    for (const dir of ['e', 'w', 'n', 's'] as const) {
      const from = sa.msgs.length;
      sb.send('step', { dir });
      await sleep(150);
      if (sa.msgs.slice(from).some((m) => m.t === 'zstep' && m.d.p === b.id)) break;
    }
    expect(sa.msgs.some((m) => m.t === 'zstep' && m.d.p === b.id)).toBe(true);
    // Presence is set while in the zone.
    expect(await withDb((db) => db.world.presence(a.id))).toEqual({
      zone: world.start.zone,
      channel: 0,
    });
    // Leaving saves the position and clears presence; re-entering pays no second discovery.
    sb.ws.close(1000);
    await waitFor(sa, (m) => m.t === 'zleave' && m.d.p === b.id);
    await sleep(100);
    expect(await withDb((db) => db.world.presence(b.id))).toBeNull();
    const again = await enter(b.cookie);
    await sleep(200);
    expect(again.s.msgs.filter((m) => m.t === 'reward')).toEqual([]);
    expect(await totalXp(b.cookie)).toBe(DISCOVERY_XP);
  });

  it('R-WORLD-003 R-WORLD-005 R-SEC-003 the Academy: accept the enrolment quest, fail then skip a chess lesson, rewarded once', async () => {
    const p = await signUp(env, uniq('Cal'));
    const head = beside('headmaster_orla');
    await place(p.id, head.zone, head.x, head.y);
    const { s } = await enter(p.cookie);
    await s.wait('reward'); // discovery
    const d = await talk(s, 'headmaster_orla', head.face);
    const questOpt = d.options.find((o) => o.id.startsWith('quest:'));
    expect(questOpt).toBeDefined();
    let from = s.msgs.length;
    s.send('choose', { npc: 'headmaster_orla', option: questOpt?.id });
    expect((await s.wait('quest', from)).d).toMatchObject({ id: 'academy_enrolment', step: 0 });
    // DD-72: accepting from the giver completes the leading "talk to the Headmaster" step.
    const q = await waitFor(s, (m) => m.t === 'quest' && m.d.step === 1, from);
    expect(q.d).toMatchObject({ id: 'academy_enrolment', done: false });
    await sleep(100);
    expect(await withDb((db) => db.world.quests(p.id))).toEqual([
      expect.objectContaining({ questId: 'academy_enrolment', step: q.d.step }),
    ]);

    // Tutor Nell: the movement lesson. A wrong answer gets the hint; then the veteran skips it.
    s.ws.close(1000);
    await sleep(100);
    const nell = beside('tutor_nell');
    await place(p.id, nell.zone, nell.x, nell.y);
    const { s: s2 } = await enter(p.cookie);
    const lessonDialog = await talk(s2, 'tutor_nell', nell.face);
    expect(lessonDialog.options.map((o) => o.id)).toEqual(
      expect.arrayContaining(['lesson:moves_basics', 'skip:moves_basics']),
    );
    from = s2.msgs.length;
    s2.send('choose', { npc: 'tutor_nell', option: 'lesson:moves_basics' });
    const puzzle = await s2.wait('puzzle', from);
    expect(puzzle.d).toMatchObject({ lesson: 'moves_basics', index: 0 });
    const lesson = lessonById.get('moves_basics');
    if (lesson?.kind !== 'puzzles') throw new Error('moves_basics is a puzzle lesson');
    const right = lesson.puzzles[0]?.accept[0] ?? '';
    from = s2.msgs.length;
    s2.send('answer', {
      lesson: 'moves_basics',
      puzzle: 0,
      move: right === 'a1a2' ? 'h1h2' : 'a1a2',
    });
    const wrong = await s2.wait('lessonResult', from);
    expect(wrong.d).toMatchObject({ ok: false, done: false });
    const xpBefore = await totalXp(p.cookie);
    await talk(s2, 'tutor_nell', nell.face);
    from = s2.msgs.length;
    s2.send('choose', { npc: 'tutor_nell', option: 'skip:moves_basics' });
    const paid = await s2.wait('reward', from);
    expect(paid.d.xp).toBe(lesson.reward.xp);
    await sleep(100);
    expect(await totalXp(p.cookie)).toBe(xpBefore + lesson.reward.xp);
    // The lesson is done: no option to take it (or be paid for it) again.
    const after = await talk(s2, 'tutor_nell', nell.face);
    expect(after.options.map((o) => o.id)).not.toContain('skip:moves_basics');
    const progress = await call<{ lessonsDone: string[]; quests: { id: string }[] }>(
      'GET',
      '/api/progress',
      undefined,
      p.cookie,
    );
    expect(progress.data.lessonsDone).toContain('moves_basics');
    expect(progress.data.quests.map((x) => x.id)).toEqual(['academy_enrolment']);
  });

  it('R-WORLD-002 R-SEC-003 R-FMT-005 a trainer battle from the world: encounter, battle socket, marker cleared, battle XP paid once', async () => {
    const p = await signUp(env, uniq('Dax'));
    const spot = beside('coach_brann');
    await place(p.id, spot.zone, spot.x, spot.y);
    const { s } = await enter(p.cookie);
    await s.wait('reward');
    const d = await talk(s, 'coach_brann', spot.face);
    expect(d.options.map((o) => o.id)).toContain('battle');
    const from = s.msgs.length;
    s.send('choose', { npc: 'coach_brann', option: 'battle' });
    const enc = await s.wait('enc', from);
    expect(enc.d.kind).toBe('trainer');
    const xpBefore = await totalXp(p.cookie);
    const end = await playThenResign(String(enc.d.url), 2);
    expect(end.result).toMatchObject({ reason: 'resign' });
    await waitFor(s, (m) => m.t === 'zbattle' && m.d.p === p.id && m.d.battling === false, from);
    const paid = await waitFor(s, (m) => m.t === 'reward', from);
    const brann = world.npcs.find((n) => n.id === 'coach_brann');
    if (brann?.role.kind !== 'trainer') throw new Error('coach_brann is a trainer');
    expect(paid.d.xp).toBe(battleXp(brann.role.format, 'loss', brann.role.level));
    await sleep(100);
    expect(await totalXp(p.cookie)).toBe(xpBefore + Number(paid.d.xp));
    const battleId = String(enc.d.battleId);
    const grants = await withDb((db) => db.rewards.get(`battle:${battleId}`, p.id));
    expect(grants?.payload.xp).toBe(paid.d.xp);
    const row = await withDb((db) => db.battles.get(battleId));
    expect(row).toMatchObject({ result: expect.stringMatching(/white|black/) });
  });

  it('R-WORLD-002 a step in tall grass rolls encounters on the server: a wild First Blood battle', async () => {
    const p = await signUp(env, uniq('Eli'));
    const g = zoneGeometry('thistle_meadow');
    let start: { x: number; y: number } | null = null;
    for (let y = 0; y < g.height && !start; y++)
      for (let x = 0; x < g.width - 1 && !start; x++) {
        const i = y * g.width + x;
        if (g.wild[i] && g.wild[i + 1] && walkable(g, x, y) && walkable(g, x + 1, y))
          start = { x, y };
      }
    if (!start) throw new Error('no grass pair in thistle_meadow');
    await place(p.id, 'thistle_meadow', start.x, start.y);
    const { s } = await enter(p.cookie);
    let enc: Sock['msgs'][number] | undefined;
    for (let i = 0; i < 200 && !enc; i++) {
      s.send('step', { dir: i % 2 === 0 ? 'e' : 'w' });
      await sleep(130);
      enc = s.msgs.find((m) => m.t === 'enc');
    }
    expect(enc?.d.kind).toBe('wild');
    const b = await openSocket(String(enc?.d.url));
    open.push(b);
    b.send('hello', { from: 0 });
    const bstart = (await b.wait('bstart')).d;
    expect(bstart.format).toBe('first_blood');
    const players = bstart.players as Record<Side, { name: string }>;
    const npcSide: Side = bstart.you === 'white' ? 'black' : 'white';
    expect(players[npcSide].name).toMatch(/^Wild /);
    b.send('resign');
    await waitFor(s, (m) => m.t === 'zbattle' && m.d.p === p.id && m.d.battling === false);
  });

  it('R-SEC-011 R-WORLD-004 chat: zone chat is filtered while a minor is present; whispers cross zones; a stranger cannot whisper a minor', async () => {
    const a = await signUp(env, uniq('Fay'));
    const b = await signUp(env, uniq('Gus'));
    const m = await signUp(env, uniq('Hal'), `${new Date().getUTCFullYear() - 15}-06-01`);
    const town = world.zones.find((z) => z.kind === 'town');
    if (!town) throw new Error('no town');
    const tg = zoneGeometry(town.id);
    await place(b.id, town.id, tg.spawn.x, tg.spawn.y);
    const { s: sa } = await enter(a.cookie);
    const { s: sb } = await enter(b.cookie);
    // Adults only: the adult's own zone line arrives unfiltered.
    let from = sa.msgs.length;
    sa.send('chat', { ch: 'zone', text: 'well shit' });
    expect((await sa.wait('chatmsg', from)).d).toMatchObject({
      text: 'well shit',
      filtered: false,
    });
    // A whisper reaches B in another zone.
    from = sb.msgs.length;
    sa.send('chat', { ch: 'whisper', to: b.id, text: 'hello over there' });
    expect((await sb.wait('chatmsg', from)).d).toMatchObject({
      ch: 'whisper',
      from: a.id,
      text: 'hello over there',
    });
    // A minor joins A's channel: zone chat is now filtered for everyone.
    const { s: sm } = await enter(m.cookie);
    await waitFor(sa, (x) => x.t === 'zjoin' && x.d.p === m.id);
    from = sm.msgs.length;
    sa.send('chat', { ch: 'zone', text: 'well shit' });
    const seen = (await sm.wait('chatmsg', from)).d;
    expect(seen.filtered).toBe(true);
    expect(String(seen.text)).not.toContain('shit');
    // A stranger's whisper to the minor is refused like an offline target.
    from = sb.msgs.length;
    sb.send('chat', { ch: 'whisper', to: m.id, text: 'hi' });
    expect((await sb.wait('err', from)).d.code).toBe('whisper_refused');
    expect(sm.msgs.some((x) => x.t === 'chatmsg' && x.d.from === b.id)).toBe(false);
    // Whispering someone offline is refused too.
    from = sa.msgs.length;
    sa.send('chat', { ch: 'whisper', to: '0192f0a0-0000-7000-8000-00000000dead', text: 'hi' });
    expect((await sa.wait('err', from)).d.code).toBe('whisper_refused');
  });

  it('R-WORLD-004 R-SEC-011 parties span zones: invite, accept, both see the party, party chat, leave', async () => {
    const a = await signUp(env, uniq('Ivy'));
    const b = await signUp(env, uniq('Jon'));
    const town = world.zones.find((z) => z.kind === 'town');
    if (!town) throw new Error('no town');
    const tg = zoneGeometry(town.id);
    await place(b.id, town.id, tg.spawn.x, tg.spawn.y);
    const { s: sa } = await enter(a.cookie);
    const { s: sb } = await enter(b.cookie);
    let fb = sb.msgs.length;
    sa.send('party', { op: 'invite', to: b.id });
    const invite = await sb.wait('partyInvite', fb);
    expect(invite.d).toMatchObject({ from: a.id });
    const fa = sa.msgs.length;
    fb = sb.msgs.length;
    sb.send('party', { op: 'reply', id: invite.d.id, accept: true });
    const pa = await sa.wait('party', fa);
    const pb = await sb.wait('party', fb);
    expect(pa.d).toMatchObject({ leader: a.id });
    expect((pa.d.members as { p: string }[]).map((x) => x.p).sort()).toEqual([a.id, b.id].sort());
    expect(pb.d.id).toBe(pa.d.id);
    // A forged or reused invite does nothing harmful.
    let from = sb.msgs.length;
    sb.send('party', {
      op: 'reply',
      id: 'k.0192f0a000007000800000000000beef.xxxxxxxxxxxxxxxxxxxxxx',
      accept: true,
    });
    expect((await sb.wait('err', from)).d.code).toBe('invite_expired');
    // Party chat crosses zones.
    from = sb.msgs.length;
    sa.send('chat', { ch: 'party', text: 'meet at the gate' });
    expect((await sb.wait('chatmsg', from)).d).toMatchObject({
      ch: 'party',
      text: 'meet at the gate',
    });
    // B leaves: both get the new view.
    const la = sa.msgs.length;
    from = sb.msgs.length;
    sb.send('party', { op: 'leave' });
    expect((await sb.wait('party', from)).d).toMatchObject({ id: null, members: [] });
    const after = await sa.wait('party', la);
    expect((after.d.members as { p: string }[]).map((x) => x.p)).toEqual([a.id]);
  });

  it('R-WORLD-004 a consent challenge between two players starts a PvP battle for both', async () => {
    const a = await signUp(env, uniq('Kim'));
    const b = await signUp(env, uniq('Lou'));
    const { s: sa } = await enter(a.cookie);
    const { s: sb } = await enter(b.cookie);
    let from = sb.msgs.length;
    sa.send('chal', { to: b.id, format: 'first_blood' });
    const chal = await sb.wait('chalIn', from);
    expect(chal.d).toMatchObject({ from: a.id, format: 'first_blood' });
    const fa = sa.msgs.length;
    from = sb.msgs.length;
    sb.send('chalReply', { id: chal.d.id, accept: true });
    const ea = await sa.wait('enc', fa);
    const eb = await sb.wait('enc', from);
    expect(ea.d.kind).toBe('challenge');
    expect(eb.d.battleId).toBe(ea.d.battleId);
    const ba = await openSocket(String(ea.d.url));
    open.push(ba);
    ba.send('hello', { from: 0 });
    expect((await ba.wait('bstart')).d.format).toBe('first_blood');
    ba.send('resign');
    await waitFor(sb, (m) => m.t === 'zbattle' && m.d.p === b.id && m.d.battling === false, from);
  });

  it('R-WORLD-001 a full channel overflows into the next channel of the same zone', async () => {
    const zone = 'route_1';
    const a = await signUp(env, uniq('Max'));
    const g = zoneGeometry(zone);
    await place(a.id, zone, g.spawn.x, g.spawn.y);
    const { snap } = await enter(a.cookie);
    expect(snap).toMatchObject({ zone, channel: 0 });
    // Fill channel 0 to its 60 players with stand-ins (they have no sockets).
    await runInDurableObject(zoneStub(env, zone, 0), async (room: ZoneRoom) => {
      const core = (room as unknown as { core: ZoneCore }).core;
      for (let i = 0; core.size < 60; i++) {
        const init: PlayerInit = {
          id: `standin-${i}`,
          name: `Stand ${i}`,
          level: 1,
          adult: true,
          friends: [],
          quests: [],
          lessonsDone: [],
          defeatedNpcs: [],
          keyItems: [],
          party: null,
          filterChat: false,
        };
        core.join(init, Date.now());
      }
    });
    const b = await signUp(env, uniq('Ned'));
    await place(b.id, zone, g.spawn.x, g.spawn.y);
    const { snap: snapB } = await enter(b.cookie);
    expect(snapB).toMatchObject({ zone, channel: 1 });
    expect(await withDb((db) => db.world.presence(b.id))).toEqual({ zone, channel: 1 });
    await runInDurableObject(zoneStub(env, zone, 0), async (room: ZoneRoom) => {
      const core = (room as unknown as { core: ZoneCore }).core;
      for (let i = 0; i < 60; i++) core.leave(`standin-${i}`, Date.now());
    });
  });

  it('R-COST-002 zone telemetry reaches the cost dashboard; only admins may open it', async () => {
    const boss = await signUp(env, uniq('Boss'), '1980-01-01', 'boss@example.com');
    const pleb = await signUp(env, uniq('Pleb'));
    // A finished battle reports its usage too.
    const saved = await call<{ id: string }>(
      'PUT',
      '/api/loadouts',
      { name: 'Tide', loadout: { elements: ['tide'], items: [], sets: [['scout']] } },
      pleb.cookie,
    );
    const t = await call<{ url: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'first_blood', loadoutId: saved.data.id, tier: 'wild' },
      pleb.cookie,
    );
    const bs = await openSocket(t.data.url);
    open.push(bs);
    bs.send('hello', { from: 0 });
    await bs.wait('bstart');
    bs.send('resign');
    await bs.wait('bend');
    // An emptied channel reports its telemetry window at once.
    const { s } = await enter(pleb.cookie);
    s.send('step', { dir: 'e' });
    s.send('chat', { ch: 'zone', text: 'counting' });
    await sleep(150);
    s.ws.close(1000);
    await sleep(300);
    expect((await call('GET', '/api/admin/cost', undefined, pleb.cookie)).status).toBe(403);
    expect((await call('GET', '/api/admin/cost')).status).toBe(401);
    const d = await call<{
      total: {
        rollup: { playerMs: number; zoneIn: number; battles: number };
        cost: { perSubscriberMonth: number };
      };
      hours: unknown[];
    }>('GET', '/api/admin/cost', undefined, boss.cookie);
    expect(d.status).toBe(200);
    expect(d.data.total.rollup.playerMs).toBeGreaterThan(0);
    expect(d.data.total.rollup.zoneIn).toBeGreaterThan(0);
    expect(d.data.total.rollup.battles).toBeGreaterThan(0);
    expect(d.data.hours.length).toBeGreaterThan(0);
    const page = await SELFfetch('/admin/cost', boss.cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Infrastructure cost');
    expect(page.text).toContain('per heavy subscriber-month');
  });
});

async function fetchUpgrade(path: string): Promise<number> {
  const { SELF } = await import('cloudflare:test');
  const res = await SELF.fetch(`http://localhost${path}`, { headers: { upgrade: 'websocket' } });
  return res.status;
}

async function SELFfetch(path: string, cookie: string): Promise<{ status: number; text: string }> {
  const { SELF } = await import('cloudflare:test');
  const res = await SELF.fetch(`http://localhost${path}`, { headers: { cookie } });
  return { status: res.status, text: await res.text() };
}
