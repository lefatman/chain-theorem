/**
 * Tournaments inside workerd (M7 7.1; `pnpm test:workers`): admins create and cancel events (audited,
 * ADMIN_EMAILS only), players register per slot bracket up to the field size, the TournamentRoom
 * starts the event by alarm and creates each round's BattleRooms with the tournament origin, players
 * get their game through a ticket, results come back from `settleBattle`, the next round is paired,
 * and the end records the winner and grants the prizes once (R-SEC-003); zone notices reach players
 * in the world; a double no-show is a double loss; account deletion reaches the room (R-SEC-010).
 */
import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Db } from '@chain-theorem/db';
import type {
  BattleTicket,
  TournamentList,
  TournamentView,
  WorldTicket,
} from '@chain-theorem/protocol';
import { sessionCookieName } from '../src/auth/cookies.ts';
import { getDb, releaseDb } from '../src/db.ts';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import type { TournamentRoom } from '../src/rooms/tournament-room.ts';
import type { TournamentSnapshot } from '../src/tournament/index.ts';
import type { BattleOrigin } from '../src/world/battles.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withDb<T>(f: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb(env);
  try {
    return await f(db);
  } finally {
    await releaseDb(env, db);
  }
}

/**
 * The admin (`boss@example.com` is in ADMIN_EMAILS, vitest.config.ts) with a fresh session made in
 * the database, so repeated tests never hit the magic-link rate limit.
 */
async function admin(): Promise<{ cookie: string; id: string }> {
  return withDb(async (db) => {
    const p =
      (await db.players.getByEmail('boss@example.com')) ??
      (await db.players.create({
        email: 'boss@example.com',
        displayName: 'Boss',
        adultFrom: Date.UTC(2003, 0, 1),
      }));
    const { token } = await db.sessions.create(p.id, { ttlMs: 24 * 60 * 60 * 1000 });
    return { cookie: `${sessionCookieName(false)}=${token}`, id: p.id };
  });
}

async function bossCookie(): Promise<string> {
  return (await admin()).cookie;
}

async function bossId(): Promise<string> {
  return (await admin()).id;
}

interface Created {
  id: string;
  name: string;
  status: string;
  startsAt: number;
}

async function create(body: Record<string, unknown>): Promise<Created> {
  const r = await call<{ tournament: Created }>(
    'POST',
    '/api/admin/tournaments',
    body,
    await bossCookie(),
  );
  expect(r.status).toBe(200);
  return r.data.tournament;
}

async function view(id: string, cookie: string): Promise<TournamentView> {
  const r = await call<TournamentView>('GET', `/api/tournaments/${id}`, undefined, cookie);
  expect(r.status).toBe(200);
  return r.data;
}

const room = (id: string) => env.TOURNAMENT_ROOM.get(env.TOURNAMENT_ROOM.idFromName(id));

/** Wait until the room's view satisfies `ok` (alarms fire on their own; this nudges them too). */
async function until(
  id: string,
  cookie: string,
  ok: (v: TournamentView) => boolean,
  ms = 15_000,
): Promise<TournamentView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await view(id, cookie);
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out; status ${v.status}, round ${v.round}`);
    await runDurableObjectAlarm(room(id)).catch(() => false);
    await sleep(100);
  }
}

async function zone(cookie: string): Promise<Sock> {
  const t = await call<WorldTicket>('POST', '/api/world/ticket', undefined, cookie);
  expect(t.status).toBe(200);
  const s = await openSocket(t.data.url);
  s.send('hello');
  await s.wait('zsnap');
  return s;
}

/** Both players join their game; `loser` resigns at once. */
async function playGame(
  id: string,
  a: { cookie: string; id: string },
  b: { cookie: string; id: string },
  loser: 'a' | 'b',
): Promise<string> {
  const ta = await call<BattleTicket>('POST', `/api/tournaments/${id}/ticket`, undefined, a.cookie);
  const tb = await call<BattleTicket>('POST', `/api/tournaments/${id}/ticket`, undefined, b.cookie);
  expect(ta.status).toBe(200);
  expect(tb.data.battleId).toBe(ta.data.battleId);
  const sa = await openSocket(ta.data.url);
  const sb = await openSocket(tb.data.url);
  sa.send('hello', { from: 0 });
  sb.send('hello', { from: 0 });
  await sa.wait('bstart');
  await sb.wait('bstart');
  (loser === 'a' ? sa : sb).send('resign');
  await sa.wait('bend', 0, 10_000);
  await sb.wait('bend', 0, 10_000);
  sa.ws.close();
  sb.ws.close();
  return ta.data.battleId;
}

describe('tournaments (M7 7.1)', () => {
  it('R-WORLD-004 admins create events (audited); players register up to the field size and list them', async () => {
    const player = await signUp(env, 'Plain');
    const refused = await call(
      'POST',
      '/api/admin/tournaments',
      { format: 'first_blood', bracket: '1-2', system: 'swiss' },
      player.cookie,
    );
    expect(refused.status).toBe(403);
    const t = await create({
      format: 'first_blood',
      bracket: '1-2',
      system: 'swiss',
      startInMs: 60_000,
      maxPlayers: 2,
      name: 'Listing test',
    });
    expect(t).toMatchObject({ name: 'Listing test', status: 'open' });
    const id = await bossId();
    const audit = await withDb((db) => db.audit.listForPlayer(id, 10));
    expect(audit.map((a) => a.kind)).toContain('admin.tournament_create');

    const [a, b, c] = [player, await signUp(env, 'Second'), await signUp(env, 'Third')];
    const reg = await call<TournamentView>(
      'POST',
      `/api/tournaments/${t.id}/register`,
      undefined,
      a.cookie,
    );
    expect(reg.status).toBe(200);
    expect(reg.data.you).toMatchObject({ registered: true, withdrawn: false, cannot: null });
    const again = await call<{ error: string }>(
      'POST',
      `/api/tournaments/${t.id}/register`,
      undefined,
      a.cookie,
    );
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('already');
    expect(
      (await call('POST', `/api/tournaments/${t.id}/register`, undefined, b.cookie)).status,
    ).toBe(200);
    const full = await call<{ error: string }>(
      'POST',
      `/api/tournaments/${t.id}/register`,
      undefined,
      c.cookie,
    );
    expect(full.status).toBe(409);
    expect(full.data.error).toBe('full');
    expect((await view(t.id, c.cookie)).you.cannot).toBe('full');
    // Unregistering before the start frees the place.
    const out = await call<TournamentView>(
      'DELETE',
      `/api/tournaments/${t.id}/register`,
      undefined,
      b.cookie,
    );
    expect(out.data.you.registered).toBe(false);
    expect(
      (await call('POST', `/api/tournaments/${t.id}/register`, undefined, c.cookie)).status,
    ).toBe(200);

    const list = await call<TournamentList>('GET', '/api/tournaments', undefined, a.cookie);
    expect(list.data.bracket).toBe('1-2');
    const row = list.data.upcoming.find((x) => x.id === t.id);
    expect(row).toMatchObject({ players: 2, maxPlayers: 2, registered: true, scheduled: false });
    // The daily schedule: one event per slot bracket, created once however often it is listed.
    const daily = list.data.upcoming.filter((x) => x.scheduled);
    expect(daily.map((x) => x.bracket).sort()).toEqual(['1-2', '3-4', '5-6']);
    const again2 = await call<TournamentList>('GET', '/api/tournaments', undefined, c.cookie);
    expect(
      again2.data.upcoming
        .filter((x) => x.scheduled)
        .map((x) => x.id)
        .sort(),
    ).toEqual(daily.map((x) => x.id).sort());
  });

  it('R-FMT-004 registration is per slot bracket (the level, never the loadout)', async () => {
    const t = await create({ format: 'full', bracket: '3-4', system: 'se', startInMs: 60_000 });
    const low = await signUp(env, 'Low');
    const r = await call<{ error: string }>(
      'POST',
      `/api/tournaments/${t.id}/register`,
      undefined,
      low.cookie,
    );
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('wrong_bracket');
    const mid = await signUp(env, 'Mid');
    await withDb((db) => db.world.setLevel(mid.id, 10));
    expect(
      (await call('POST', `/api/tournaments/${t.id}/register`, undefined, mid.cookie)).status,
    ).toBe(200);
    expect((await view(t.id, low.cookie)).you.cannot).toBe('wrong_bracket');
  });

  it('R-WORLD-004 a Swiss event runs by alarms through the real battles, and the prizes are granted once (R-SEC-003)', async () => {
    const t = await create({
      format: 'first_blood',
      bracket: '1-2',
      system: 'swiss',
      startInMs: 1500,
      breakMs: 0,
      rounds: 2,
      name: 'Run test',
    });
    const players = [
      await signUp(env, 'Ann'),
      await signUp(env, 'Ben'),
      await signUp(env, 'Cid'),
      await signUp(env, 'Dee'),
    ];
    for (const p of players)
      expect(
        (await call('POST', `/api/tournaments/${t.id}/register`, undefined, p.cookie)).status,
      ).toBe(200);
    const z = await zone(players[0]?.cookie ?? '');
    await sleep(Math.max(0, t.startsAt - Date.now()) + 50);
    const r1 = await until(
      t.id,
      players[0]?.cookie ?? '',
      (v) => v.status === 'running' && v.round === 1 && v.you.game !== null,
    );
    expect(r1.rounds).toBe(2);
    expect(r1.roundList[0]?.pairings).toHaveLength(2);
    // The player in the world was told of the pairing and of the game.
    // (The notices go out as the room runs its effects, right after the state the view shows.)
    const kinds = async () => {
      const end = Date.now() + 5000;
      for (;;) {
        const k = new Set(z.msgs.filter((m) => m.t === 'tourney').map((m) => String(m.d.kind)));
        if (k.has('game') || Date.now() > end) return [...k].sort();
        await sleep(20);
      }
    };
    expect(await kinds()).toEqual(['game', 'paired']);

    const byId = new Map(players.map((p) => [p.id, p]));
    const origins: BattleOrigin[] = [];
    for (let round = 1; round <= 2; round++) {
      const v = await until(
        t.id,
        players[0]?.cookie ?? '',
        (x) => x.round === round && (x.roundList[round - 1]?.started ?? false),
      );
      for (const p of v.roundList[round - 1]?.pairings ?? []) {
        const w = byId.get(p.white.id);
        const b = p.black ? byId.get(p.black.id) : undefined;
        if (!w || !b) continue;
        const battleId = await playGame(t.id, w, b, 'b');
        expect(battleId).toBe(`t-${t.id}-${round}-${p.board}`);
        origins.push(
          (await runInDurableObject(
            env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId)),
            (r: BattleRoom) =>
              (r as unknown as { ctx: DurableObjectState }).ctx.storage.get<BattleOrigin>('origin'),
          )) as BattleOrigin,
        );
      }
    }
    expect(origins).toEqual([
      { kind: 'tournament', tournamentId: t.id, round: 1 },
      { kind: 'tournament', tournamentId: t.id, round: 1 },
      { kind: 'tournament', tournamentId: t.id, round: 2 },
      { kind: 'tournament', tournamentId: t.id, round: 2 },
    ]);
    const end = await until(t.id, players[0]?.cookie ?? '', (x) => x.status === 'finished');
    expect(end.winner).not.toBeNull();
    expect(end.standings[0]?.id).toBe(end.winner?.id);
    expect(end.standings[0]?.points).toBe(2);
    // No repeat pairing: 2 rounds of 4 players.
    const met = end.roundList.flatMap((r) =>
      r.pairings.map((p) => [p.white.id, p.black?.id].sort().join()),
    );
    expect(new Set(met).size).toBe(4);

    // The listing shows the winner; the database has the places.
    const list = await call<TournamentList>(
      'GET',
      '/api/tournaments',
      undefined,
      players[1]?.cookie,
    );
    expect(list.data.finished.find((x) => x.id === t.id)?.winner?.id).toBe(end.winner?.id);
    const entries = await withDb((db) => db.tournaments.entries(t.id));
    expect(entries.map((e) => e.place).sort()).toEqual([1, 2, 3, 4]);

    // Prizes: one grant per top-3 player (with points), under `tournament:<id>:<player>`.
    const grants = async () =>
      withDb((db) =>
        db.kysely
          .selectFrom('reward_grants')
          .select(['grant_key', 'player_id'])
          .where('grant_key', 'like', `tournament:${t.id}:%`)
          .execute(),
      );
    await until(t.id, players[0]?.cookie ?? '', () => true);
    const first = await grants();
    const paid = end.standings.filter((s) => s.rank <= 3 && s.points > 0).map((s) => s.id);
    expect(first.map((g) => g.player_id).sort()).toEqual([...paid].sort());
    const winnerCoins = await withDb((db) => db.world.coins(end.winner?.id ?? ''));
    expect(winnerCoins).toBeGreaterThanOrEqual(200);
    // A repeated end (the room's retry) and a repeated result pay nobody twice.
    await runInDurableObject(room(t.id), async (r: TournamentRoom) => {
      const ctx = (r as unknown as { ctx: DurableObjectState }).ctx;
      const snap = (await ctx.storage.get<TournamentSnapshot>('snap')) as TournamentSnapshot;
      await ctx.storage.put('snap', { ...snap, settle: 'pending', settleAt: Date.now() - 1 });
    });
    // Reload the room from storage so the patched snapshot is live, then fire its alarm.
    await runInDurableObject(room(t.id), async (r: TournamentRoom) => {
      const self = r as unknown as { ctx: DurableObjectState; core: unknown };
      const { TournamentCore } = await import('../src/tournament/index.ts');
      self.core = TournamentCore.restore(
        (await self.ctx.storage.get<TournamentSnapshot>('snap')) as TournamentSnapshot,
      );
      await self.ctx.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(room(t.id));
    expect((await grants()).length).toBe(first.length);
    expect(await withDb((db) => db.world.coins(end.winner?.id ?? ''))).toBe(winnerCoins);
    const rev = (await view(t.id, players[0]?.cookie ?? '')).rev;
    const replay = await room(t.id).fetch('https://tournament/result', {
      method: 'POST',
      body: JSON.stringify({
        battleId: `t-${t.id}-1-1`,
        outcome: { winner: 'black', reason: 'resign', absent: { white: false, black: false } },
      }),
    });
    expect(replay.ok).toBe(true);
    expect((await view(t.id, players[0]?.cookie ?? '')).rev).toBe(rev);
    expect((await view(t.id, players[0]?.cookie ?? '')).standings).toEqual(end.standings);
    z.ws.close();
  });

  it('R-WORLD-004 a game neither player starts is a double loss; the absent are withdrawn', async () => {
    const t = await create({
      format: 'first_blood',
      bracket: '1-2',
      system: 'se',
      startInMs: 1200,
      breakMs: 0,
    });
    const [a, b] = [await signUp(env, 'Gone'), await signUp(env, 'Away')];
    for (const p of [a, b])
      expect(
        (await call('POST', `/api/tournaments/${t.id}/register`, undefined, p.cookie)).status,
      ).toBe(200);
    await sleep(Math.max(0, t.startsAt - Date.now()) + 50);
    const v = await until(t.id, a.cookie, (x) => x.you.game !== null);
    const battleId = v.you.game?.battleId ?? '';
    // What settleBattle reports when both seats' grace ran out without a single frame.
    const res = await room(t.id).fetch('https://tournament/result', {
      method: 'POST',
      body: JSON.stringify({
        battleId,
        outcome: { winner: 'black', reason: 'abandon', absent: { white: true, black: true } },
      }),
    });
    expect(res.ok).toBe(true);
    const end = await until(t.id, a.cookie, (x) => x.status === 'finished');
    expect(end.roundList[0]?.pairings[0]).toMatchObject({ result: 'none' });
    expect(end.roundList[0]?.pairings[0]?.absent).toHaveLength(2);
    expect(end.winner).toBeNull();
    expect(end.entrants.every((e) => e.withdrawn)).toBe(true);
  });

  it('R-WORLD-004 admins cancel an event: no rounds, no prizes; the console page lists events', async () => {
    const t = await create({
      format: 'vanguard',
      bracket: '1-2',
      system: 'swiss',
      startInMs: 60_000,
    });
    const p = await signUp(env, 'Cancelled');
    await call('POST', `/api/tournaments/${t.id}/register`, undefined, p.cookie);
    expect(
      (await call('POST', `/api/admin/tournaments/${t.id}/cancel`, undefined, p.cookie)).status,
    ).toBe(403);
    const c = await call<{ tournament: Created }>(
      'POST',
      `/api/admin/tournaments/${t.id}/cancel`,
      undefined,
      await bossCookie(),
    );
    expect(c.status).toBe(200);
    expect(c.data.tournament.status).toBe('cancelled');
    expect((await view(t.id, p.cookie)).status).toBe('cancelled');
    expect(
      (await call('POST', `/api/admin/tournaments/${t.id}/cancel`, undefined, await bossCookie()))
        .status,
    ).toBe(409);
    const id = await bossId();
    const audit = await withDb((db) => db.audit.listForPlayer(id, 50));
    expect(audit.map((a) => a.kind)).toContain('admin.tournament_cancel');
    const html = await SELF.fetch('http://localhost/admin/tournaments', {
      headers: { cookie: await bossCookie() },
    });
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain('New tournament');
    expect(text).toContain(t.name);
  });

  it('R-SEC-010 a deleted account leaves the list, the export shows its tournaments', async () => {
    const t = await create({ format: 'full', bracket: '1-2', system: 'swiss', startInMs: 60_000 });
    const p = await signUp(env, 'Leaver');
    await call('POST', `/api/tournaments/${t.id}/register`, undefined, p.cookie);
    const exp = await call<{ tournaments: { tournamentId: string }[] }>(
      'GET',
      '/api/me/export',
      undefined,
      p.cookie,
    );
    expect(exp.data.tournaments.map((x) => x.tournamentId)).toContain(t.id);
    expect((await call('DELETE', '/api/me', undefined, p.cookie)).status).toBe(204);
    const other = await signUp(env, 'Watcher');
    const v = await view(t.id, other.cookie);
    expect(v.entrants.map((e) => e.id)).not.toContain(p.id);
    expect(await withDb((db) => db.tournaments.entries(t.id))).toEqual([]);
  });
});
