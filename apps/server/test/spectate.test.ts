/**
 * Spectating inside workerd (M7 7.2; spec 10.4 "delayed, public-projection-only view of live
 * battles"; `pnpm test:workers`): the live list, spectator tickets (R-SEC-006), which battles are
 * public and the per-account opt-out with its default for minors (R-SEC-011), and a spectator socket
 * on a public battle whose every frame is scanned against the exact full state it shows (R-SEC-001,
 * R-INFO-005), staying SPECTATE.delayPlies behind, read-only and rate-limited (R-SEC-005).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SPECTATE, engine } from '@chain-theorem/content';
import type { LiveBattles, SpectateSetting, SpectateTicket } from '@chain-theorem/protocol';
import type { GameState, Loadout, SpectatorState } from '@chain-theorem/rules';
import { signTicket } from '../src/auth/tickets.ts';
import type { BattleSnapshot, LogRecord, SeatInit } from '../src/battle/index.ts';
import { checkSpectatorMessage } from '../src/battle/testing.ts';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import type { BattleOrigin } from '../src/world/battles.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

type Acct = { cookie: string; id: string };

const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };
/** White: a replay ability negated by its own Stopwatch. Black: a veiled Poisoned Meat. */
const WHITE: Loadout = { elements: ['tide'], items: ['wardens_stopwatch'], sets: [['momentum']] };
const BLACK: Loadout = {
  elements: ['grove'],
  items: ['dual_adepts_glove'],
  sets: [['veil', 'poisoned_meat']],
};
const RANKED: BattleOrigin = { kind: 'ranked', bracket: '1-2' };
let serial = 0;

function room(battleId: string) {
  return env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
}

/** Start a battle the way the Matchmaker, a ZoneRoom or a TournamentRoom does (`POST /init`). */
async function startBattle(
  white: Acct,
  black: Acct,
  origin: BattleOrigin,
  loadouts: [Loadout, Loadout] = [PLAIN, PLAIN],
): Promise<string> {
  const battleId = `spec-${++serial}-${Date.now()}`;
  const seat = (a: Acct, name: string, loadout: Loadout): SeatInit => ({
    playerId: a.id,
    name,
    level: 30,
    loadout,
  });
  const res = await room(battleId).fetch('https://room/init', {
    method: 'POST',
    body: JSON.stringify({
      battleId,
      format: 'full',
      white: seat(white, 'Wynn', loadouts[0]),
      black: seat(black, 'Bex', loadouts[1]),
      origin,
    }),
  });
  expect(res.status).toBe(200);
  return battleId;
}

async function live(viewer: Acct): Promise<LiveBattles> {
  const r = await call<LiveBattles>('GET', '/api/battles/live', undefined, viewer.cookie);
  expect(r.status).toBe(200);
  return r.data;
}

async function spectate(viewer: Acct, battleId: string) {
  return call<SpectateTicket & { error?: string }>(
    'POST',
    `/api/battles/${encodeURIComponent(battleId)}/spectate`,
    undefined,
    viewer.cookie,
  );
}

async function player(a: Acct, battleId: string): Promise<Sock> {
  const t = await call<{ url: string }>(
    'POST',
    `/api/battles/${battleId}/ticket`,
    undefined,
    a.cookie,
  );
  expect(t.status).toBe(200);
  const s = await openSocket(t.data.url);
  s.send('hello', { from: 0 });
  await s.wait('bstart');
  return s;
}

async function server(battleId: string): Promise<{ log: LogRecord[]; snap: BattleSnapshot }> {
  return runInDurableObject(room(battleId), (r: BattleRoom) => {
    const core = (r as unknown as { core: { log(): LogRecord[]; snapshot(): BattleSnapshot } })
      .core;
    return { log: JSON.parse(JSON.stringify(core.log())), snap: core.snapshot() };
  });
}

/** Full state after every log record, replayed from the seats (INV-04). */
function statesOf(snap: BattleSnapshot, log: readonly LogRecord[]): GameState[] {
  let s = engine.newBattle({
    format: snap.format,
    white: { level: snap.seats.white.level, loadout: snap.seats.white.loadout },
    black: { level: snap.seats.black.level, loadout: snap.seats.black.loadout },
    ...(snap.fen !== null ? { fen: snap.fen } : {}),
    strict: true,
  }).state;
  const out = [s];
  for (const r of log.slice(1)) {
    if (!r.input) throw new Error(`record ${r.n} has no input`);
    s = engine.applyAction(s, r.input).state;
    out.push(s);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spectating (M7 7.2)', () => {
  it('R-SEC-006 spectator tickets: only listed battles, bound to the account and the battle, 60 seconds; forged, expired and player tickets are refused', async () => {
    const a = await signUp(env, 'Sta');
    const b = await signUp(env, 'Stb');
    const c = await signUp(env, 'Stc');
    const id = await startBattle(a, b, RANKED);
    const listed = (await live(c)).battles.find((x) => x.id === id);
    expect(listed).toMatchObject({
      format: 'full',
      kind: 'ranked',
      bracket: '1-2',
      white: { name: 'Wynn', level: 30 },
      black: { name: 'Bex', level: 30 },
      spectators: 0,
    });
    expect((await live(c)).delay).toBe(SPECTATE.delayPlies);
    // Signed out: nothing.
    expect((await call('GET', '/api/battles/live')).status).toBe(401);
    expect((await call('POST', `/api/battles/${id}/spectate`)).status).toBe(401);

    const t = await spectate(c, id);
    expect(t.status).toBe(200);
    expect(t.data.url).toMatch(new RegExp(`^/ws/spectate/${id}\\?t=`));
    const s = await openSocket(t.data.url);
    s.send('hello', { from: 0 });
    await s.wait('sstart');
    s.ws.close(1000);

    // A ticket is bound to its battle: another battle refuses it.
    const other = await startBattle(a, b, RANKED);
    await expect(
      openSocket(`/ws/spectate/${other}?t=${encodeURIComponent(t.data.token)}`),
    ).rejects.toThrow(/403/);
    await expect(openSocket(`/ws/spectate/${id}?t=forged.ticket`)).rejects.toThrow(/403/);
    // A player's battle ticket is not a spectator ticket, and the other way round.
    const bt = await call<{ token: string }>(
      'POST',
      `/api/battles/${id}/ticket`,
      undefined,
      a.cookie,
    );
    await expect(
      openSocket(`/ws/spectate/${id}?t=${encodeURIComponent(bt.data.token)}`),
    ).rejects.toThrow(/403/);
    await expect(
      openSocket(`/ws/battle/${id}?t=${encodeURIComponent(t.data.token)}`),
    ).rejects.toThrow(/403/);
    // Expired (older than 60 s).
    const old = await signTicket(env.AUTH_SECRET, c.id, `spectate:${id}`, Date.now() - 61_000);
    await expect(openSocket(`/ws/spectate/${id}?t=${encodeURIComponent(old)}`)).rejects.toThrow(
      /403/,
    );

    // Private kinds are not listed and cannot be watched, even with a signed ticket.
    for (const origin of [
      { kind: 'pvp' },
      { kind: 'npc', tier: 'wild' },
      { kind: 'challenge', zone: 'rookhaven', auto: false },
      { kind: 'wager', wagerId: 'w-1' },
    ] as BattleOrigin[]) {
      const hidden = await startBattle(a, b, origin);
      expect((await live(c)).battles.some((x) => x.id === hidden)).toBe(false);
      expect((await spectate(c, hidden)).status).toBe(404);
      const forged = await signTicket(env.AUTH_SECRET, c.id, `spectate:${hidden}`, Date.now());
      await expect(
        openSocket(`/ws/spectate/${hidden}?t=${encodeURIComponent(forged)}`),
      ).rejects.toThrow(/404/);
    }
    // Challenge-zone battles are public.
    const zone = await startBattle(a, b, { kind: 'challenge', zone: 'rookhaven', auto: true });
    expect((await live(c)).battles.find((x) => x.id === zone)?.kind).toBe('challenge_zone');
    expect((await spectate(c, 'no-such-battle')).status).toBe(404);
  });

  it('R-SEC-011 minors are not watchable by default and may opt in; adults may opt out; a block hides the battle both ways', async () => {
    const kid = await signUp(env, 'Kidd', '2012-05-05');
    const adult = await signUp(env, 'Adda');
    const watcher = await signUp(env, 'Wato');
    const get = async (a: Acct) =>
      (await call<SpectateSetting>('GET', '/api/settings/spectate', undefined, a.cookie)).data;
    const put = async (a: Acct, allow: boolean | null) =>
      call<SpectateSetting>('PUT', '/api/settings/spectate', { allow }, a.cookie);
    expect(await get(kid)).toEqual({ allow: false, custom: false, byDefault: false });
    expect(await get(adult)).toEqual({ allow: true, custom: false, byDefault: true });

    const first = await startBattle(kid, adult, RANKED);
    expect((await live(watcher)).battles.some((x) => x.id === first)).toBe(false);
    expect((await spectate(watcher, first)).status).toBe(404);

    // The minor opts in: their next public battle is listed.
    expect((await put(kid, true)).data).toEqual({ allow: true, custom: true, byDefault: false });
    const second = await startBattle(kid, adult, RANKED);
    expect((await live(watcher)).battles.some((x) => x.id === second)).toBe(true);
    // The adult opts out: not listed any more; back to the default lists again.
    expect((await put(adult, false)).data.allow).toBe(false);
    const third = await startBattle(kid, adult, RANKED);
    expect((await live(watcher)).battles.some((x) => x.id === third)).toBe(false);
    expect((await put(adult, null)).data).toEqual({ allow: true, custom: false, byDefault: true });
    expect((await put(kid, null)).data.allow).toBe(false);
    expect((await call('PUT', '/api/settings/spectate', { allow: 'yes' }, kid.cookie)).status).toBe(
      400,
    );

    // A block (either way) hides a listed battle from that viewer and refuses the ticket.
    const b1 = await signUp(env, 'Blka');
    const b2 = await signUp(env, 'Blkb');
    const blocked = await startBattle(b1, b2, RANKED);
    expect((await live(watcher)).battles.some((x) => x.id === blocked)).toBe(true);
    expect((await call('POST', '/api/blocks', { id: watcher.id }, b2.cookie)).status).toBe(200);
    expect((await live(watcher)).battles.some((x) => x.id === blocked)).toBe(false);
    expect((await spectate(watcher, blocked)).status).toBe(404);
  });

  it('R-SEC-001 R-INFO-005 R-SEC-005 a spectator gets only spectator projections, SPECTATE.delayPlies behind, never a player message; it is read-only and rate-limited', async () => {
    const a = await signUp(env, 'Spwa');
    const b = await signUp(env, 'Spwb');
    const c = await signUp(env, 'Spwc');
    const id = await startBattle(a, b, RANKED, [WHITE, BLACK]);
    const white = await player(a, id);
    const black = await player(b, id);
    const t = await spectate(c, id);
    const s = await openSocket(t.data.url);
    s.send('hello', { from: 0 });
    const start = await s.wait('sstart');
    expect((start.d.public as unknown as SpectatorState).ply).toBe(0);
    expect(start.d.delay).toBe(SPECTATE.delayPlies);
    // Players are told how many watch (optional feature of 10.4).
    await white.wait('watchers');
    const count = async () => {
      for (let k = 0; k < 100; k++) {
        const w = [...white.msgs].reverse().find((m) => m.t === 'watchers');
        if (w?.d.count === 1) return 1;
        await sleep(20);
      }
      return -1;
    };
    expect(await count()).toBe(1);
    expect((await live(a)).battles.find((x) => x.id === id)?.spectators).toBe(1);

    // Read-only: a spectator's move, resignation or chat changes nothing.
    s.send('mv', { move: 'e2e4' });
    s.send('resign');
    s.send('draw');
    await sleep(100);
    expect(white.msgs.filter((m) => m.t === 'bev')).toHaveLength(1);

    // e4 d5 exd5: White's Momentum is negated by its own Stopwatch, Black's veiled Poisoned Meat
    // takes the capturing pawn; then quiet moves.
    const plies: [Sock, string][] = [
      [white, 'e2e4'],
      [black, 'd7d5'],
      [white, 'e4d5'],
      [black, 'g8f6'],
      [white, 'g1f3'],
      [black, 'b8c6'],
    ];
    for (const [k, [sock, uci]] of plies.entries()) {
      const before = white.msgs.length;
      sock.send('mv', { move: uci });
      await white.wait('bev', before);
      await sleep(30);
      const shown = [...s.msgs].reverse().find((m) => m.t === 'sev' || m.t === 'sstart');
      const ply = (shown?.d.public as unknown as SpectatorState | undefined)?.ply ?? 0;
      // Live ply is k + 1; a spectator is never closer than the delay.
      expect(k + 1 - ply).toBeGreaterThanOrEqual(Math.min(SPECTATE.delayPlies, k + 1));
    }
    const latest = [...s.msgs].reverse().find((m) => m.t === 'sev');
    expect((latest?.d.public as unknown as SpectatorState).ply).toBe(
      plies.length - SPECTATE.delayPlies,
    );
    // A reconnecting spectator resumes from where it was.
    const s2 = await openSocket((await spectate(c, id)).data.url);
    s2.send('hello', { from: (latest?.d.to as number) ?? 0 });
    const again = await s2.wait('sev');
    expect(again.d.events).toEqual([]);

    // Flooding a spectator socket closes it (R-SEC-005); the battle goes on.
    const s3 = await openSocket((await spectate(c, id)).data.url);
    for (let k = 0; k < 80; k++) s3.ws.send('garbage');
    expect(await s3.closed).toBe(1008);

    // Resignation ends the battle: the rest is shown, then the result.
    white.send('resign');
    const end = await s.wait('send');
    expect(end.d.result).toEqual({ winner: 'black', reason: 'resign' });
    const final = [...s.msgs].reverse().find((m) => m.t === 'sev');
    expect((final?.d.public as unknown as SpectatorState).ply).toBe(plies.length);

    // Every frame either spectator received is a spectator message and passes the scan against the
    // exact state of the position it shows.
    const { log, snap } = await server(id);
    const states = statesOf(snap, log);
    let scanned = 0;
    for (const m of [...s.msgs, ...s2.msgs]) {
      let state = states.at(-1) as GameState;
      if (m.t === 'sev' || m.t === 'sstart') {
        const to = (m.t === 'sev' ? m.d.to : m.d.eventCount) as number;
        const n = log.findIndex((r) => r.from + r.events.length === to);
        expect(n, `${m.t} to ${to}`).toBeGreaterThanOrEqual(0);
        state = states[n] as GameState;
      }
      expect(checkSpectatorMessage(m, state)).toBeNull();
      scanned++;
    }
    expect(scanned).toBeGreaterThan(plies.length);
    // Not vacuous: Black's veiled ability, its glove and White's Stopwatch were in the raw log.
    const raw = JSON.stringify(log.map((r) => r.events));
    expect(raw).toContain('poisoned_meat');
    const wire = JSON.stringify(s.msgs);
    for (const hidden of ['poisoned_meat', 'veil', 'dual_adepts_glove'])
      expect(wire).not.toContain(`"${hidden}"`);
    expect(s.msgs.some((m) => ['bstart', 'bev', 'prompt', 'bend', 'opp'].includes(m.t))).toBe(
      false,
    );

    for (const x of [white, black, s, s2]) x.ws.close(1000);
  });

  it('R-SEC-005 a public battle takes at most SPECTATE.maxPerRoom spectators', async () => {
    const a = await signUp(env, 'Capa');
    const b = await signUp(env, 'Capb');
    const c = await signUp(env, 'Capc');
    const id = await startBattle(a, b, RANKED);
    const socks: Sock[] = [];
    for (let k = 0; k < SPECTATE.maxPerRoom; k++) {
      const t = await spectate(c, id);
      expect(t.status).toBe(200);
      socks.push(await openSocket(t.data.url));
    }
    const full = await spectate(c, id);
    expect(full.status).toBe(409);
    expect(full.data.error).toBe('full');
    // A ticket issued just before the room filled up is refused at the socket.
    const forged = await signTicket(env.AUTH_SECRET, c.id, `spectate:${id}`, Date.now());
    await expect(openSocket(`/ws/spectate/${id}?t=${encodeURIComponent(forged)}`)).rejects.toThrow(
      /429/,
    );
    for (const s of socks) s.ws.close(1000);
  });
});
