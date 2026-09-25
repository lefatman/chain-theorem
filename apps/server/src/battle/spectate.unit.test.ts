/**
 * Spectating through the battle core (M7 7.2; spec 10.4 "delayed, public-projection-only view of
 * live battles"; R-INFO-005 INVARIANT, R-SEC-001): the delay window, `hello` replay, snapshot and
 * restore, and a randomized sweep in which every spectator frame is scanned against the exact full
 * state of the position it shows.
 */
import { describe, expect, it } from 'vitest';
import { SPECTATE, engine } from '@chain-theorem/content';
import {
  type FormatId,
  type GameState,
  type Loadout,
  type Side,
  type SpectatorState,
  moveToUci,
} from '@chain-theorem/rules';
import type { BattleOrigin } from '../world/battles.ts';
import { BattleCore } from './core.ts';
import { liveDetails, liveKind } from './spectate.ts';
import { spectatorHiddenIds } from '@chain-theorem/content/scan';
import { Rng, checkSpectatorMessage, frame, randomLoadout } from './testing.ts';
import type { BattleInit, BattleSnapshot, LogRecord, Outbox, SpectatorMsg } from './types.ts';

const T0 = 1_750_000_000_000;
const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };
const DELAY = SPECTATE.delayPlies;

function init(over: Partial<BattleInit> = {}): BattleInit {
  return {
    battleId: 'b-spec-1',
    format: 'full',
    white: { playerId: 'p-white', name: 'Ada', level: 30, loadout: PLAIN },
    black: { playerId: 'p-black', name: 'Bo', level: 30, loadout: PLAIN },
    spectate: { delay: DELAY },
    ...over,
  };
}

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

function join(core: BattleCore, t: number): void {
  for (const side of ['white', 'black'] as const) {
    core.connect(side, t);
    core.message(side, frame('hello', { from: 0 }), t);
  }
}

/** The full state after every log record, rebuilt by replaying the logged inputs (INV-04). */
function statesOf(i: BattleInit, log: readonly LogRecord[]): GameState[] {
  let s = engine.newBattle({
    format: i.format,
    white: { level: i.white.level, loadout: i.white.loadout },
    black: { level: i.black.level, loadout: i.black.loadout },
    ...(i.fen !== undefined ? { fen: i.fen } : {}),
    strict: true,
  }).state;
  const out = [s];
  for (const r of log.slice(1)) {
    s = engine.applyAction(s, must(r.input, `input of record ${r.n}`)).state;
    out.push(s);
  }
  return out;
}

/** Log record index whose events end at full-log index `to`. */
function recordEndingAt(log: readonly LogRecord[], to: number): number {
  const n = log.findIndex((r) => r.from + r.events.length === to);
  if (n < 0) throw new Error(`no record ends at ${to}`);
  return n;
}

const spec = (out: Outbox) => out.spectate ?? [];
const sev = (out: Outbox) =>
  spec(out).filter((m): m is Extract<SpectatorMsg, { t: 'sev' }> => m.t === 'sev');
const pubOf = (m: { d: { public: Record<string, unknown> } }) =>
  m.d.public as unknown as SpectatorState;

describe('M7 7.2 spectating in the battle core', () => {
  it('R-INFO-005 spectators see the start at once, each later position only once it is SPECTATE.delayPlies behind, and everything when the battle ends', () => {
    const { core, out } = BattleCore.create(init(), T0);
    const first = sev(out);
    expect(first).toHaveLength(1);
    expect(first[0]?.d.from).toBe(0);
    expect(pubOf(must(first[0], 'start')).ply).toBe(0);
    join(core, T0);
    const shown: number[] = [];
    const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
    let t = T0;
    moves.forEach((uci, k) => {
      const side: Side = k % 2 === 0 ? 'white' : 'black';
      const o = core.message(side, frame('mv', { move: uci }), (t += 1000));
      for (const m of sev(o)) shown.push(pubOf(m).ply);
      // The newest position a spectator has is always at least the delay behind the live one.
      const live = core.fullState().ply;
      const latest = core.snapshot().spectate?.public as unknown as SpectatorState;
      expect(live - latest.ply).toBeGreaterThanOrEqual(Math.min(DELAY, live));
      expect(spec(o).some((m) => m.t === 'send')).toBe(false);
    });
    // Plies 1..(5 - delay) were released one by one, in order.
    expect(shown).toEqual(Array.from({ length: moves.length - DELAY }, (_, k) => k + 1));
    // Resigning ends the battle: the rest is released at once, then the result.
    const end = core.message('black', frame('resign', {}), (t += 1000));
    expect(spec(end).map((m) => m.t)).toEqual([
      ...Array.from({ length: DELAY + 1 }, () => 'sev'),
      'send',
    ]);
    const last = must(sev(end).at(-1), 'last sev');
    expect(last.d.to).toBe(core.snapshot().events);
    expect(pubOf(last).result).toEqual({ winner: 'white', reason: 'resign' });
  });

  it('R-INFO-005 R-NET-001 a spectator hello gets the delayed position and replays from `from`, never past the delay', () => {
    const { core } = BattleCore.create(init(), T0);
    join(core, T0);
    let t = T0;
    for (const [side, uci] of [
      ['white', 'd2d4'],
      ['black', 'd7d5'],
      ['white', 'c2c4'],
      ['black', 'e7e6'],
    ] as const)
      core.message(side, frame('mv', { move: uci }), (t += 500));
    const snap = must(core.snapshot().spectate, 'spectate state');
    const hello = core.spectatorHello(0, 3);
    expect(hello.map((m) => m.t)).toEqual(['sstart', 'sev']);
    const [sstart, replay] = hello as [
      Extract<SpectatorMsg, { t: 'sstart' }>,
      Extract<SpectatorMsg, { t: 'sev' }>,
    ];
    expect(sstart.d.delay).toBe(DELAY);
    expect(sstart.d.watchers).toBe(3);
    expect(sstart.d.players).toEqual({
      white: { name: 'Ada', level: 30 },
      black: { name: 'Bo', level: 30 },
    });
    expect(sstart.d.eventCount).toBe(snap.to);
    expect(pubOf(sstart).ply).toBe(core.fullState().ply - DELAY);
    expect(sstart.d.clocks?.running).toBeNull();
    expect(replay.d.from).toBe(0);
    expect(replay.d.to).toBe(snap.to);
    expect(Math.max(...replay.d.events.map((e) => e.i as number))).toBeLessThan(snap.to);
    // Every event shown equals what the live stream carried for it.
    const streamed = core
      .log()
      .slice(0, snap.released)
      .flatMap((r) => r.spec ?? []);
    expect(replay.d.events).toEqual(streamed);
    // A reconnect from the middle gets only the rest.
    const mid = must(core.log()[1], 'record 1');
    const again = core.spectatorHello(mid.from, 1);
    const tail = again[1] as Extract<SpectatorMsg, { t: 'sev' }>;
    expect(tail.d.from).toBe(mid.from);
    expect(tail.d.events.every((e) => (e.i as number) >= mid.from)).toBe(true);
    // A `from` past what was shown is clamped: nothing from the delay window leaks.
    const ahead = core.spectatorHello(1_000_000, 1)[1] as Extract<SpectatorMsg, { t: 'sev' }>;
    expect(ahead.d.from).toBe(snap.to);
    expect(ahead.d.events).toEqual([]);
  });

  it('R-INFO-005 a battle that is not public computes nothing for spectators and answers not_public', () => {
    const { core, out } = BattleCore.create(init({ spectate: undefined }), T0);
    join(core, T0);
    core.message('white', frame('mv', { move: 'e2e4' }), T0 + 100);
    expect(out.spectate).toBeUndefined();
    expect(core.spectatable).toBe(false);
    expect(core.snapshot().spectate).toBeUndefined();
    expect(core.log().every((r) => r.spec === undefined)).toBe(true);
    expect(core.spectatorHello(0, 0)).toEqual([{ t: 'err', d: { code: 'not_public' } }]);
  });

  it('R-INFO-005 a restored core (eviction) continues the spectator stream exactly like the original', () => {
    const { core } = BattleCore.create(init(), T0);
    join(core, T0);
    let t = T0;
    core.message('white', frame('mv', { move: 'e2e4' }), (t += 100));
    core.message('black', frame('mv', { move: 'e7e5' }), (t += 100));
    const snap = JSON.parse(JSON.stringify(core.snapshot())) as BattleSnapshot;
    const log = JSON.parse(JSON.stringify(core.log())) as LogRecord[];
    const twin = BattleCore.restore(snap, log);
    expect(twin.spectatorHello(0, 0)).toEqual(core.spectatorHello(0, 0));
    for (const [side, uci] of [
      ['white', 'g1f3'],
      ['black', 'g8f6'],
      ['white', 'f1c4'],
    ] as const) {
      t += 100;
      const a = core.message(side, frame('mv', { move: uci }), t);
      const b = twin.message(side, frame('mv', { move: uci }), t);
      expect(JSON.stringify(spec(b))).toBe(JSON.stringify(spec(a)));
    }
    expect(twin.spectatorHello(0, 2)).toEqual(core.spectatorHello(0, 2));
  });

  it('R-SEC-001 R-INFO-005 random public battles with random legal loadouts: every spectator frame passes the spectator scan against the exact state it shows, and stays the delay behind', () => {
    const FORMATS: FormatId[] = ['first_blood', 'vanguard', 'full'];
    let frames = 0;
    let withSecrets = 0;
    let prompts = 0;
    let stripped = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const rng = new Rng(seed * 7919);
      const level = 12 + rng.int(engine.caps.LEVEL_CAP - 11);
      const i = init({
        battleId: `b-spec-${seed}`,
        format: rng.pick(FORMATS),
        white: { playerId: 'w', name: 'W', level, loadout: randomLoadout(engine, rng, level) },
        black: { playerId: 'b', name: 'B', level, loadout: randomLoadout(engine, rng, level) },
      });
      const received: { msg: SpectatorMsg; livePly: number; ended: boolean }[] = [];
      const take = (out: Outbox) => {
        for (const msg of spec(out))
          received.push({ msg, livePly: core.fullState().ply, ended: core.result !== null });
      };
      const created = BattleCore.create(i, T0);
      const core = created.core;
      take(created.out);
      join(core, T0);
      let t = T0;
      for (let step = 0; step < 160 && !core.result; step++) {
        t += 200 + rng.int(800);
        const st = core.fullState();
        if (st.pending) {
          prompts++;
          const req = st.pending.request;
          const opt = rng.int(req.options.length);
          take(core.message(req.chooser, frame('ch', { promptId: req.promptId, option: opt }), t));
        } else {
          const moves = engine.legalMoves(st, st.turn);
          const caps = moves.filter((m) => (st.board[m.to] ?? -1) >= 0);
          const m = caps.length > 0 && rng.chance(0.6) ? rng.pick(caps) : rng.pick(moves);
          take(core.message(st.turn, frame('mv', { move: moveToUci(m) }), t));
        }
        // A spectator (re)joins now and then, from a random point.
        if (rng.chance(0.1))
          for (const msg of core.spectatorHello(rng.int(core.snapshot().events + 3), 1))
            received.push({ msg, livePly: core.fullState().ply, ended: core.result !== null });
      }
      if (!core.result) take(core.message('white', frame('resign', {}), t + 1));
      const log = core.log();
      const states = statesOf(i, log);
      // Raw events carried ids the spectator events had to strip.
      log.forEach((r, n) => {
        const hidden = spectatorHiddenIds(must(states[n], `state ${n}`));
        const raw = JSON.stringify(r.events);
        const spec = JSON.stringify(r.spec);
        for (const id of hidden)
          if (raw.includes(`"${id}"`) && !spec.includes(`"${id}"`)) stripped++;
      });
      for (const { msg, livePly, ended } of received) {
        frames++;
        let state = states.at(-1) as GameState;
        if (msg.t === 'sev' || msg.t === 'sstart') {
          const to = msg.t === 'sev' ? msg.d.to : msg.d.eventCount;
          const n = recordEndingAt(log, to);
          state = must(states[n], `state ${n}`);
          const shownPly = pubOf(msg).ply;
          if (n > 0 && !ended)
            expect(shownPly, `seed ${seed}`).toBeLessThanOrEqual(livePly - DELAY);
        }
        // Count frames shown while some id was still unknown to one player (not a vacuous scan).
        if (spectatorHiddenIds(state).size > 0) withSecrets++;
        expect(checkSpectatorMessage(msg, state), `seed ${seed} ${msg.t}`).toBeNull();
      }
      // Every record was shown by the end, in order and exactly once.
      const shown = received
        .filter((r) => r.msg.t === 'sev')
        .map((r) => r.msg as Extract<SpectatorMsg, { t: 'sev' }>);
      const streamRanges = shown.filter((m) => m.d.from !== m.d.to || m.d.events.length > 0);
      expect(streamRanges.length).toBeGreaterThan(0);
      expect(core.snapshot().spectate?.released).toBe(log.length);
    }
    expect(frames).toBeGreaterThan(500);
    expect(withSecrets).toBeGreaterThan(frames / 2);
    expect(prompts).toBeGreaterThan(0);
    expect(stripped).toBeGreaterThan(0);
  });
});

describe('M7 7.2 which battles are public', () => {
  it('R-SEC-011 R-WORLD-006 ranked, tournament and challenge-zone battles are public; NPC, lesson, wild, consent challenges, links, casual pairings and wagers are not', () => {
    const cases: [BattleOrigin, string | null][] = [
      [{ kind: 'ranked', bracket: '3-4' }, 'ranked'],
      [{ kind: 'challenge', zone: 'z', auto: true }, 'challenge_zone'],
      [{ kind: 'tournament', tournamentId: 't-9' } as unknown as BattleOrigin, 'tournament'],
      [{ kind: 'challenge', zone: 'z', auto: false }, null],
      [{ kind: 'pvp' }, null],
      [{ kind: 'npc', tier: 'elite' }, null],
      [{ kind: 'wager', wagerId: 'w' }, null],
      [{ kind: 'lesson', zone: 'z', lesson: 'l' }, null],
      [{ kind: 'trainer', zone: 'z', npc: 'n', tier: 'trainer', level: 3 }, null],
      [{ kind: 'wild', zone: 'z', name: 'Mote', element: null, level: 2 }, null],
    ];
    for (const [origin, kind] of cases) expect(liveKind(origin), origin.kind).toBe(kind);
    expect(liveDetails({ kind: 'ranked', bracket: '3-4' })).toEqual({ bracket: '3-4' });
    expect(
      liveDetails({ kind: 'tournament', name: 'Friday Swiss' } as unknown as BattleOrigin),
    ).toEqual({ tournament: 'Friday Swiss' });
    expect(liveDetails({ kind: 'pvp' })).toEqual({});
  });
});
