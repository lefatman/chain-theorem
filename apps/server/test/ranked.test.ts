/**
 * Ranked play and leaderboards inside workerd (M6 6.2, 6.1; `pnpm test:workers`): the ranked queue
 * per format and bracket pairs two players into a rated battle whose BattleRoom keeps a ranked origin;
 * at the end both ratings change once in one atomic list (R-FMT-004); the bracket follows the level,
 * never the loadout; the same-opponent cap and its flag (R-SEC-008); leaderboards per format and
 * bracket with the caller's own rank and the guild leaderboard (R-WORLD-004).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { RANKED } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type {
  GuildLeaderboard,
  Leaderboard,
  MyRatings,
  RankedTicket,
} from '@chain-theorem/protocol';
import type { Side } from '@chain-theorem/rules';
import type { BattleArchive, BattleSummary } from '../src/battle/index.ts';
import { getDb, releaseDb } from '../src/db.ts';
import { REPEAT_PAIRING, RANKED_COUNTERS, settleRanked } from '../src/rating/settle.ts';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import { MemorySink } from '../src/telemetry.ts';
import type { BattleOrigin } from '../src/world/battles.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const TIDE = { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withDb<T>(f: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb(env);
  try {
    return await f(db);
  } finally {
    await releaseDb(env, db);
  }
}

async function saveLoadout(cookie: string): Promise<string> {
  const r = await call<{ id: string; valid: boolean }>(
    'PUT',
    '/api/loadouts',
    { name: 'Tide', loadout: TIDE },
    cookie,
  );
  expect(r.data.valid).toBe(true);
  return r.data.id;
}

async function ratings(cookie: string): Promise<MyRatings> {
  const r = await call<MyRatings>('GET', '/api/ratings/me', undefined, cookie);
  expect(r.status).toBe(200);
  return r.data;
}

function summary(battleId: string, winner: Side | null, format = 'full'): BattleSummary {
  return {
    battleId,
    format,
    contentVersion: 'test',
    white: { playerId: 'w', name: 'W', level: 1 },
    black: { playerId: 'b', name: 'B', level: 1 },
    result: { winner, reason: winner ? 'resign' : 'agreement' },
    startedAt: 0,
    endedAt: 1,
    plies: 10,
    events: 0,
    records: 0,
    stateHash: '0',
    stats: {
      white: { rateLimited: 0, invalid: 0, rejected: 0 },
      black: { rateLimited: 0, invalid: 0, rejected: 0 },
    },
  } as BattleSummary;
}

function seats(white: string, black: string): Pick<BattleArchive, 'seats'> {
  const seat = (id: string) => ({
    playerId: id,
    name: id.slice(0, 4),
    level: 1,
    loadout: { elements: ['tide'], items: [], sets: [['scout']] },
  });
  return { seats: { white: seat(white), black: seat(black) } } as Pick<BattleArchive, 'seats'>;
}

describe('ranked queues (M6 6.2)', () => {
  it('R-FMT-004 two players are paired in the ranked queue; the battle is rated once for both', async () => {
    const a = await signUp(env, 'Rana');
    const b = await signUp(env, 'Rook');
    const la = await saveLoadout(a.cookie);
    const lb = await saveLoadout(b.cookie);
    const ta = await call<RankedTicket>(
      'POST',
      '/api/ranked/ticket',
      { format: 'vanguard', loadoutId: la },
      a.cookie,
    );
    expect(ta.status).toBe(200);
    expect(ta.data).toMatchObject({
      format: 'vanguard',
      bracket: '1-2',
      rating: { rating: 1500, rd: 350, games: 0, rank: null, provisional: true },
    });
    expect(ta.data.url).toMatch(/^\/ws\/ranked\/vanguard\//);
    const tb = await call<RankedTicket>(
      'POST',
      '/api/ranked/ticket',
      { format: 'vanguard', loadoutId: lb },
      b.cookie,
    );
    const sa = await openSocket(ta.data.url);
    await sa.wait('queued');
    const sb = await openSocket(tb.data.url);
    const ma = await sa.wait('matched');
    const mb = await sb.wait('matched');
    const battleId = ma.d.battleId as string;
    expect(mb.d.battleId).toBe(battleId);
    // The origin stays server-side: ranked, in the players' bracket.
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
    const origin = await runInDurableObject(stub, (room: BattleRoom) =>
      (room as unknown as { ctx: DurableObjectState }).ctx.storage.get<BattleOrigin>('origin'),
    );
    expect(origin).toEqual({ kind: 'ranked', bracket: '1-2' });
    // One battle at a time: no second ranked ticket while this one is being played.
    const again = await call<{ error: string }>(
      'POST',
      '/api/ranked/ticket',
      { format: 'full', loadoutId: la },
      a.cookie,
    );
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('in_battle');

    // A resigns at once: the result is a loss for A and a win for B.
    const bt = await call<{ url: string }>(
      'POST',
      `/api/battles/${battleId}/ticket`,
      undefined,
      a.cookie,
    );
    const ws: Sock = await openSocket(bt.data.url);
    ws.send('hello', { from: 0 });
    await ws.wait('bstart');
    ws.send('resign');
    await ws.wait('bend');
    let ra: MyRatings | null = null;
    for (let i = 0; i < 100; i++) {
      ra = await ratings(a.cookie);
      if (ra.ratings.some((r) => r.format === 'vanguard' && r.games === 1)) break;
      await sleep(50);
    }
    const mineA = ra?.ratings.find((r) => r.format === 'vanguard' && r.bracket === '1-2');
    const mineB = (await ratings(b.cookie)).ratings.find(
      (r) => r.format === 'vanguard' && r.bracket === '1-2',
    );
    expect(mineA?.games).toBe(1);
    expect(mineB?.games).toBe(1);
    expect(mineA?.rating).toBeLessThan(1500);
    expect(mineB?.rating).toBeGreaterThan(1500);
    expect((mineA?.rating ?? 0) + (mineB?.rating ?? 0)).toBe(3000);
    // Rated once: settling the same battle again changes nothing.
    const game = await withDb((db) => db.ranked.getGame(battleId));
    expect(game?.rated).toBe(true);
    const again2 = await withDb((db) =>
      settleRanked(
        db,
        summary(battleId, 'white', 'vanguard'),
        seats(a.id, b.id),
        '1-2',
        Date.now(),
        new MemorySink(),
      ),
    );
    expect(again2).toBeNull();
    expect(await withDb((db) => db.ratings.get(a.id, 'vanguard', '1-2'))).toMatchObject({
      games: 1,
    });
    // Full Battle in the same bracket is a separate rating.
    expect(
      (await ratings(a.cookie)).ratings.find((r) => r.format === 'full' && r.bracket === '1-2'),
    ).toMatchObject({ rating: 1500, games: 0 });
    for (const s of [sa, sb, ws]) s.ws.close(1000);
  });

  it('R-FMT-004 the bracket follows the level, never the loadout; First Blood has no ranked queue', async () => {
    const p = await signUp(env, 'Lvl');
    const id = await saveLoadout(p.cookie);
    const fb = await call<{ error: string }>(
      'POST',
      '/api/ranked/ticket',
      { format: 'first_blood', loadoutId: id },
      p.cookie,
    );
    expect(fb.status).toBe(400);
    expect(fb.data.error).toBe('not_ranked');
    // Level 10 unlocks 3 slots: bracket 3-4, although this loadout equips a single item.
    await withDb((db) => db.world.setLevel(p.id, 10));
    const t = await call<RankedTicket>(
      'POST',
      '/api/ranked/ticket',
      { format: 'full', loadoutId: id },
      p.cookie,
    );
    expect(t.status).toBe(200);
    expect(TIDE.items).toHaveLength(1);
    expect(t.data.bracket).toBe('3-4');
    expect((await ratings(p.cookie)).bracket).toBe('3-4');
    // The queue socket joins the 3-4 queue: its Matchmaker instance is named by format and bracket.
    const s = await openSocket(t.data.url);
    const q = await s.wait('queued');
    expect(q.d.format).toBe('full');
    const mm = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('ranked:full:3-4'));
    const waiting = await runInDurableObject(mm, (room) =>
      (room as unknown as { ctx: DurableObjectState }).ctx
        .getWebSockets()
        .map((w) => w.deserializeAttachment() as { id: string; ranked?: { bracket: string } }),
    );
    expect(waiting.find((w) => w.id === p.id)?.ranked?.bracket).toBe('3-4');
    s.ws.close(1000);
  });

  it('R-SEC-008 past the per-day cap against the same opponent ratings stay put and the pairing is flagged', async () => {
    const a = await signUp(env, 'Capa');
    const b = await signUp(env, 'Capb');
    const sink = new MemorySink();
    const now = Date.now();
    const cap = RANKED.sameOpponentPerDay;
    const results = [];
    for (let i = 0; i <= cap; i++) {
      const bt = await withDb((db) =>
        db.battles.create({ format: 'full', whiteId: a.id, blackId: b.id, startedAt: now }),
      );
      results.push(
        await withDb((db) =>
          settleRanked(db, summary(bt.id, 'white'), seats(a.id, b.id), '1-2', now + i, sink),
        ),
      );
    }
    expect(results.map((r) => r?.plan.rated)).toEqual([...Array(cap).fill(true), false]);
    expect(results.at(-1)?.plan.flagged).toBe(true);
    const ra = await withDb((db) => db.ratings.get(a.id, 'full', '1-2'));
    expect(ra?.games).toBe(cap);
    expect(ra?.rating).toBeCloseTo(results[cap - 1]?.plan.white.after.rating ?? 0, 6);
    // The flag: an audit entry for both players and a telemetry counter.
    for (const [me, them] of [
      [a.id, b.id],
      [b.id, a.id],
    ] as const) {
      const log = await withDb((db) => db.audit.listForPlayer(me));
      const flags = log.filter((e) => e.kind === REPEAT_PAIRING);
      expect(flags).toHaveLength(1);
      expect(flags[0]?.payload).toMatchObject({ opponent: them, gamesToday: cap + 1 });
    }
    expect(sink.get(RANKED_COUNTERS.flagged, { format: 'full', bracket: '1-2' })).toBe(1);
    expect(sink.get(RANKED_COUNTERS.rated, { format: 'full', bracket: '1-2' })).toBe(cap + 1);
    // Another opponent still rates normally.
    const c = await signUp(env, 'Capc');
    const bt = await withDb((db) =>
      db.battles.create({ format: 'full', whiteId: c.id, blackId: a.id, startedAt: now }),
    );
    const r = await withDb((db) =>
      settleRanked(db, summary(bt.id, 'black'), seats(c.id, a.id), '1-2', now + 10, sink),
    );
    expect(r?.plan.rated).toBe(true);
  });

  it('R-FMT-004 abandonment counts as a loss', async () => {
    const a = await signUp(env, 'Aban');
    const b = await signUp(env, 'Stay');
    const bt = await withDb((db) =>
      db.battles.create({ format: 'full', whiteId: a.id, blackId: b.id, startedAt: Date.now() }),
    );
    const s = summary(bt.id, 'black');
    const abandoned = { ...s, result: { winner: 'black' as const, reason: 'abandon' } };
    const r = await withDb((db) =>
      settleRanked(
        db,
        abandoned as BattleSummary,
        seats(a.id, b.id),
        '1-2',
        Date.now(),
        new MemorySink(),
      ),
    );
    expect(r?.plan.white.delta).toBeLessThan(0);
    expect(r?.plan.black.delta).toBeGreaterThan(0);
  });
});

describe('leaderboards (M6 6.1, R-WORLD-004)', () => {
  it('R-WORLD-004 per format and bracket: settled players best first, the caller highlighted by rank', async () => {
    const players = [];
    for (const name of ['Lba', 'Lbb', 'Lbc', 'Lbd']) players.push(await signUp(env, name));
    const put = (i: number, rating: number, rd: number, games: number) =>
      withDb((db) =>
        db.ratings.upsert({
          playerId: players[i]!.id,
          format: 'vanguard',
          bracket: '5-6',
          rating,
          rd,
          volatility: 0.06,
          games,
          updatedAt: Date.now(),
        }),
      );
    await put(0, 1810, 70, 30);
    await put(1, 1790, 60, 30);
    await put(2, 2500, 340, 1); // provisional: hidden
    await put(3, 1700, 90, 12);
    const board = await call<Leaderboard>(
      'GET',
      '/api/leaderboards?format=vanguard&bracket=5-6',
      undefined,
      players[3]!.cookie,
    );
    expect(board.status).toBe(200);
    expect(board.data.entries.map((e) => [e.rank, e.name, e.rating])).toEqual([
      [1, 'Lba', 1810],
      [2, 'Lbb', 1790],
      [3, 'Lbd', 1700],
    ]);
    expect(board.data.me).toMatchObject({ rank: 3, rating: 1700, provisional: false });
    const hidden = await call<Leaderboard>(
      'GET',
      '/api/leaderboards?format=vanguard&bracket=5-6&limit=2',
      undefined,
      players[2]!.cookie,
    );
    expect(hidden.data.entries).toHaveLength(2);
    expect(hidden.data.me).toMatchObject({ rank: null, provisional: true });
    const other = await call<Leaderboard>(
      'GET',
      '/api/leaderboards?format=full&bracket=5-6',
      undefined,
      players[0]!.cookie,
    );
    expect(other.data.entries).toEqual([]);
    expect(other.data.me).toBeNull();
    expect(
      (
        await call(
          'GET',
          '/api/leaderboards?format=first_blood&bracket=9-9',
          undefined,
          players[0]!.cookie,
        )
      ).status,
    ).toBe(400);
    expect((await call('GET', '/api/leaderboards?format=full&bracket=1-2')).status).toBe(401);

    // The guild leaderboard: a guild with two listed members ranks by their mean rating.
    const g = await call<{ guild: { id: string } }>(
      'POST',
      '/api/guilds',
      { name: 'Board Guild', tag: 'BG' },
      players[0]!.cookie,
    );
    expect(g.status).toBe(200);
    await call('POST', '/api/guilds/invites', { to: players[1]!.id }, players[0]!.cookie);
    await call(
      'POST',
      `/api/guilds/invites/${g.data.guild.id}/accept`,
      undefined,
      players[1]!.cookie,
    );
    const gb = await call<GuildLeaderboard>(
      'GET',
      '/api/leaderboards/guilds?format=vanguard&bracket=5-6',
      undefined,
      players[1]!.cookie,
    );
    expect(gb.status).toBe(200);
    expect(gb.data.entries.find((e) => e.tag === 'BG')).toMatchObject({ score: 1800, rated: 2 });
    expect(gb.data.mine).toMatchObject({ tag: 'BG', score: 1800 });
    const withTag = await call<Leaderboard>(
      'GET',
      '/api/leaderboards?format=vanguard&bracket=5-6',
      undefined,
      players[0]!.cookie,
    );
    expect(withTag.data.entries[0]?.tag).toBe('BG');
  });
});
