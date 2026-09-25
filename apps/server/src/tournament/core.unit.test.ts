/**
 * The tournament core (M7 7.1; spec 10.4 R-WORLD-004, 9.3 R-FMT-004, R-SEC-003): registration and
 * its limits, the start by alarm with rating seeds and bracket checks, rounds paired and started by
 * alarms, idempotent results, forfeits and double losses, withdrawal, the end with places, the winner
 * and prizes granted once, cancellation, account deletion, and determinism.
 */
import { describe, expect, it } from 'vitest';
import { TournamentCore, battleIdFor, prizeKey, type EntrantFacts } from './core.ts';
import type { Effect, GameOutcome, Outbox, TournamentInit } from './types.ts';

const T0 = Date.UTC(2026, 8, 25, 12);
const ID = '01900000-0000-7000-8000-000000000001';

function init(over: Partial<TournamentInit> = {}): TournamentInit {
  return {
    id: ID,
    name: 'Test Swiss',
    format: 'full',
    bracket: '1-2',
    system: 'swiss',
    startsAt: T0 + 60_000,
    maxPlayers: 8,
    rounds: null,
    breakMs: 10_000,
    prizes: [
      { place: 1, xp: 250, coins: 200 },
      { place: 2, xp: 150, coins: 100 },
      { place: 3, xp: 100, coins: 50 },
    ],
    rules: {
      minPlayers: 2,
      extraSwissRounds: 1,
      byePoints: 1,
      seDrawAdvances: 'black',
      withdrawAfterNoShows: 1,
      watchdogMs: 300_000,
      prizeRetryMs: 60_000,
    },
    createdAt: T0,
    ...over,
  };
}

const pid = (i: number) => `player-${String(i).padStart(2, '0')}`;

function withPlayers(core: TournamentCore, n: number, at = T0): void {
  for (let i = 1; i <= n; i++)
    expect(core.register({ id: pid(i), name: `P${i}`, level: 3 }, at + i)).toBeNull();
}

/** Ratings that seed player-01 first. */
function facts(core: TournamentCore, over: Record<string, Partial<EntrantFacts>> = {}) {
  return new Map(
    core.entrants.map((e, i) => [
      e.id,
      { rating: 1600 - i * 10, level: 3, ok: true, ...over[e.id] },
    ]),
  );
}

const of = <K extends Effect['kind']>(out: Outbox, kind: K) =>
  out.effects.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);

/** Start the tournament: the start alarm, then the host's facts. */
function begin(core: TournamentCore, f = facts(core)): Outbox {
  const due = core.alarm(init().startsAt);
  expect(of(due, 'start')).toHaveLength(1);
  return core.start(init().startsAt, f);
}

const win = (winner: 'white' | 'black' | null): GameOutcome => ({
  winner,
  reason: winner ? 'checkmate' : 'agreement',
  absent: { white: false, black: false },
});

/**
 * Run every round to the end with `pick` deciding each game (games come from `battles` effects, and
 * from watchdog `check` effects for games started before); returns every outbox.
 */
function playOut(
  core: TournamentCore,
  pick: (round: number, board: number) => GameOutcome,
  from: number,
  initial: Outbox[] = [],
): Outbox[] {
  const outs: Outbox[] = [];
  const done = new Set<string>();
  let now = from;
  const queue = [...initial];
  for (let guard = 0; guard < 500 && core.status === 'running'; guard++) {
    const out = queue.shift() ?? core.alarm((now = Math.max(now, core.nextAlarm() ?? now)));
    outs.push(out);
    const games = [
      ...of(out, 'battles').flatMap((b) => b.games),
      ...of(out, 'check').flatMap((c) => c.games),
    ];
    for (const g of games) {
      if (done.has(g.battleId)) continue;
      done.add(g.battleId);
      const [round, board] = g.battleId.split('-').slice(-2).map(Number) as [number, number];
      queue.push(core.result(g.battleId, pick(round, board), (now += 1000)));
    }
  }
  return [...outs, ...queue];
}

describe('tournament core (M7 7.1)', () => {
  it('R-WORLD-004 registration: once each, up to the field size, until the start', () => {
    const core = TournamentCore.create(init({ maxPlayers: 3 }));
    expect(core.register({ id: 'a', name: 'A', level: 1 }, T0)).toBeNull();
    expect(core.register({ id: 'a', name: 'A', level: 1 }, T0)).toBe('already');
    expect(core.register({ id: 'b', name: 'B', level: 1 }, T0)).toBeNull();
    expect(core.register({ id: 'c', name: 'C', level: 1 }, T0)).toBeNull();
    expect(core.register({ id: 'd', name: 'D', level: 1 }, T0)).toBe('full');
    expect(core.unregister('b')).toBe('removed');
    expect(core.register({ id: 'd', name: 'D', level: 1 }, T0)).toBeNull();
    expect(core.register({ id: 'e', name: 'E', level: 1 }, init().startsAt)).toBe('closed');
    expect(core.cannotRegister('e', '1-2', T0)).toBe('full');
    expect(core.cannotRegister('e', '3-4', T0)).toBe('wrong_bracket');
    expect(core.cannotRegister('a', '1-2', T0)).toBeNull();
    // Nothing happens before the start; the alarm is the start time.
    expect(core.nextAlarm()).toBe(init().startsAt);
    expect(core.alarm(T0 + 1).effects).toEqual([]);
  });

  it('R-FMT-004 the start drops players no longer in the bracket and seeds by rating', () => {
    const core = TournamentCore.create(init());
    withPlayers(core, 5);
    const out = begin(
      core,
      facts(core, {
        [pid(3)]: { ok: false },
        [pid(5)]: { rating: 1900 },
      }),
    );
    expect(core.status).toBe('running');
    expect(core.entrants.map((e) => [e.id, e.seed])).toEqual([
      [pid(5), 1],
      [pid(1), 2],
      [pid(2), 3],
      [pid(4), 4],
    ]);
    expect(out.sync).toBe(true);
    const view = core.view({ id: pid(5), bracket: '1-2' }, init().startsAt);
    // 4 players: ceil(log2 4) + 1 = 3 rounds; round 1 is paired and starts after the break.
    expect(view.rounds).toBe(3);
    expect(view.round).toBe(1);
    expect(view.you.next).toEqual({
      round: 1,
      startsAt: init().startsAt + 10_000,
      colour: 'white',
      opponent: 'P2',
    });
    expect(view.you.game).toBeNull();
    // Everyone paired is told (zone notices).
    expect(
      of(out, 'notify')
        .map((n) => n.to)
        .sort(),
    ).toEqual([pid(1), pid(2), pid(4), pid(5)].sort());
    expect(of(out, 'notify')[0]?.notice.kind).toBe('paired');
  });

  it('R-WORLD-004 too few players at the start cancel the event', () => {
    const core = TournamentCore.create(init());
    withPlayers(core, 1);
    const out = begin(core);
    expect(core.status).toBe('cancelled');
    expect(of(out, 'notify').map((n) => n.notice.kind)).toEqual(['cancelled']);
    expect(core.nextAlarm()).toBeNull();
  });

  it('R-WORLD-004 a Swiss event of 8 runs 4 rounds by alarms and finishes with a winner and prizes once (R-SEC-003)', () => {
    const core = TournamentCore.create(init());
    withPlayers(core, 8);
    begin(core);
    const roundStart = core.nextAlarm();
    expect(roundStart).toBe(init().startsAt + 10_000);
    const first = core.alarm(roundStart ?? 0);
    const battles = of(first, 'battles');
    expect(battles).toHaveLength(1);
    expect(battles[0]?.games.map((g) => g.battleId)).toEqual(
      [1, 2, 3, 4].map((b) => battleIdFor(ID, 1, b)),
    );
    expect(of(first, 'notify').every((n) => n.notice.kind === 'game')).toBe(true);
    const g = battles[0]?.games[0];
    if (!g) throw new Error('no game');
    // A player's game of the round, and the watchdog alarm while it runs.
    expect(core.gameFor(g.white)).toMatchObject({ battleId: g.battleId, colour: 'white' });
    expect(core.nextAlarm()).toBe((roundStart ?? 0) + 300_000);
    // White wins every game; a repeated result is ignored.
    const now = (roundStart ?? 0) + 5000;
    core.result(g.battleId, win('white'), now);
    expect(core.result(g.battleId, win('black'), now).effects).toEqual([]);
    const outs = [first, ...playOut(core, () => win('white'), now, [first])];
    expect(core.status).toBe('finished');
    const view = core.view(null, now);
    expect(view.rounds).toBe(4);
    expect(view.roundList).toHaveLength(4);
    // No repeat pairing in 4 rounds of 8.
    const pairs = new Set<string>();
    for (const r of view.roundList)
      for (const p of r.pairings) {
        const key = [p.white.id, p.black?.id].sort().join('|');
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      }
    expect(view.winner?.id).toBe(view.standings[0]?.id);
    expect(view.standings.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const settles = outs.flatMap((o) => of(o, 'settle'));
    expect(settles).toHaveLength(1);
    const grants = settles[0]?.grants ?? [];
    expect(grants.map((x) => x.place)).toEqual([1, 2, 3]);
    expect(grants.map((x) => x.key)).toEqual(
      view.standings.slice(0, 3).map((s) => prizeKey(ID, s.id)),
    );
    expect(grants[0]).toMatchObject({ xp: 250, coins: 200 });
    // Until the host confirms, the end repeats on the retry alarm; after, nothing is scheduled.
    const retryAt = core.nextAlarm();
    expect(retryAt).not.toBeNull();
    const again = core.alarm(retryAt ?? 0);
    expect(of(again, 'settle')[0]?.grants).toEqual(grants);
    core.settled(true, retryAt ?? 0);
    expect(core.nextAlarm()).toBeNull();
    expect(core.alarm((retryAt ?? 0) + 10 ** 9).effects).toEqual([]);
  });

  it('R-WORLD-004 a game never started is a forfeit; both absent is a double loss; no-shows are withdrawn', () => {
    const core = TournamentCore.create(init({ breakMs: 0 }));
    withPlayers(core, 4);
    const out = begin(core);
    const games = of(out, 'battles')[0]?.games ?? [];
    expect(games).toHaveLength(2);
    const [g1, g2] = games as [(typeof games)[0], (typeof games)[0]];
    const t = init().startsAt + 70_000;
    core.result(
      g1.battleId,
      { winner: 'white', reason: 'abandon', absent: { white: false, black: true } },
      t,
    );
    const out2 = core.result(
      g2.battleId,
      { winner: 'black', reason: 'abandon', absent: { white: true, black: true } },
      t,
    );
    const view = core.view(null, t);
    const r1 = view.roundList[0];
    expect(r1?.pairings.map((p) => [p.result, p.absent.length])).toEqual([
      ['white', 1],
      ['none', 2],
    ]);
    // Three no-shows are withdrawn: one active player left, so the event ends with round 1.
    expect(
      view.entrants
        .filter((e) => e.withdrawn)
        .map((e) => e.id)
        .sort(),
    ).toEqual([g1.black, g2.white, g2.black].sort());
    expect(core.status).toBe('finished');
    expect(view.winner?.id).toBe(g1.white);
    expect(view.standings.find((s) => s.id === g2.white)?.points).toBe(0);
    // Only players with points win prizes.
    expect(of(out2, 'settle')[0]?.grants.map((x) => x.playerId)).toEqual([g1.white]);
  });

  it('R-WORLD-004 withdrawing mid-event leaves the standings but not the pairings', () => {
    const core = TournamentCore.create(init({ breakMs: 0 }));
    withPlayers(core, 6);
    const out = begin(core);
    const games = of(out, 'battles')[0]?.games ?? [];
    const quitter = games[0]?.black ?? '';
    expect(core.unregister(quitter)).toBe('withdrawn');
    let now = init().startsAt;
    let next: Outbox = { effects: [], save: false, sync: false };
    for (const g of games) next = core.result(g.battleId, win('white'), (now += 1000));
    const round2 = of(next, 'battles')[0]?.games ?? [];
    expect(round2.flatMap((g) => [g.white, g.black])).not.toContain(quitter);
    const view = core.view({ id: quitter, bracket: '1-2' }, now);
    // 5 active players: one bye this round.
    expect(view.roundList[1]?.pairings.filter((p) => p.result === 'bye')).toHaveLength(1);
    expect(view.you).toMatchObject({ registered: true, withdrawn: true, game: null });
  });

  it('R-FMT-004 single elimination of 5: byes to the top seeds, a draw sends Black through, places 1, 2, 3, 3, 5', () => {
    const core = TournamentCore.create(init({ system: 'se', name: 'Test SE', breakMs: 0 }));
    withPlayers(core, 5);
    const out = begin(core);
    const view1 = core.view(null, init().startsAt);
    expect(view1.rounds).toBe(3);
    const r1 = view1.roundList[0];
    expect(
      r1?.pairings
        .filter((p) => p.result === 'bye')
        .map((p) => p.white.id)
        .sort(),
    ).toEqual([pid(1), pid(2), pid(3)].sort());
    const games = of(out, 'battles')[0]?.games ?? [];
    expect(games).toHaveLength(1);
    expect([games[0]?.white, games[0]?.black].sort()).toEqual([pid(4), pid(5)]);
    let now = init().startsAt + 1000;
    // Seed 4 or 5 wins as White; round 2 is paired at once.
    const r2out = core.result(games[0]?.battleId ?? '', win('white'), now);
    const r2 = of(r2out, 'battles')[0]?.games ?? [];
    expect(r2).toHaveLength(2);
    // Every round-2 game is drawn: Black advances (draw odds).
    let finalOut: Outbox = { effects: [], save: false, sync: false };
    const blacks = r2.map((g) => g.black);
    for (const g of r2) finalOut = core.result(g.battleId, win(null), (now += 1000));
    const final = of(finalOut, 'battles')[0]?.games ?? [];
    expect(final).toHaveLength(1);
    expect([final[0]?.white, final[0]?.black].sort()).toEqual([...blacks].sort());
    const end = core.result(final[0]?.battleId ?? '', win('black'), (now += 1000));
    expect(core.status).toBe('finished');
    const view = core.view(null, now);
    expect(view.winner?.id).toBe(final[0]?.black);
    expect(view.standings.map((s) => s.rank)).toEqual([1, 2, 3, 3, 5]);
    // Prizes: 1st, 2nd and both 3rd places.
    expect(of(end, 'settle')[0]?.grants.map((g) => g.place)).toEqual([1, 2, 3, 3]);
  });

  it('R-FMT-004 a two-player knockout: a draw sends Black through, and the final loser still takes 2nd prize', () => {
    const core = TournamentCore.create(init({ system: 'se', breakMs: 0 }));
    withPlayers(core, 2);
    const out = begin(core);
    const g = of(out, 'battles')[0]?.games[0];
    const end = core.result(g?.battleId ?? '', win(null), init().startsAt + 1);
    const view = core.view(null, 0);
    expect(view.winner?.id).toBe(g?.black);
    expect(view.standings.map((s) => [s.id, s.rank, s.points])).toEqual([
      [g?.black, 1, 1],
      [g?.white, 2, 0],
    ]);
    expect(of(end, 'settle')[0]?.grants.map((x) => [x.playerId, x.place])).toEqual([
      [g?.black, 1],
      [g?.white, 2],
    ]);
  });

  it('R-FMT-004 single elimination: a withdrawn player forfeits the next match without a battle', () => {
    const core = TournamentCore.create(init({ system: 'se', breakMs: 0 }));
    withPlayers(core, 4);
    const out = begin(core);
    const games = of(out, 'battles')[0]?.games ?? [];
    const w = games[0]?.white ?? '';
    core.result(games[0]?.battleId ?? '', win('white'), init().startsAt + 1);
    expect(core.unregister(w)).toBe('withdrawn');
    const next = core.result(games[1]?.battleId ?? '', win('black'), init().startsAt + 2);
    // The final is decided at once: the withdrawn winner forfeits it.
    expect(of(next, 'battles')).toEqual([]);
    expect(core.status).toBe('finished');
    expect(core.view(null, 0).winner?.id).toBe(games[1]?.black);
  });

  it('R-WORLD-004 results for unknown battles, before the start or after the end change nothing', () => {
    const core = TournamentCore.create(init());
    withPlayers(core, 2);
    expect(core.result('t-x-1-1', win('white'), T0).effects).toEqual([]);
    begin(core);
    expect(core.result('nope', win('white'), T0).effects).toEqual([]);
    expect(core.cancel(T0).sync).toBe(true);
    expect(core.status).toBe('cancelled');
    expect(core.result(battleIdFor(ID, 1, 1), win('white'), T0).effects).toEqual([]);
  });

  it('R-WORLD-004 the watchdog asks the host to re-read unfinished battles', () => {
    const core = TournamentCore.create(init({ breakMs: 0 }));
    withPlayers(core, 2);
    begin(core);
    const at = core.nextAlarm() ?? 0;
    const out = core.alarm(at);
    expect(of(out, 'check')[0]?.games.map((g) => g.battleId)).toEqual([battleIdFor(ID, 1, 1)]);
    expect(core.nextAlarm()).toBe(at + 300_000);
  });

  it('R-SEC-010 a deleted account leaves the list before the start and is anonymized after it', () => {
    const open = TournamentCore.create(init());
    withPlayers(open, 3);
    open.forget(pid(2));
    expect(open.entrants.map((e) => e.id)).toEqual([pid(1), pid(3)]);
    const running = TournamentCore.create(init());
    withPlayers(running, 3);
    begin(running);
    running.forget(pid(2));
    const e = running.entrants.find((x) => x.id === pid(2));
    expect(e).toMatchObject({ name: 'Deleted player', withdrawn: true, deleted: true });
    expect(JSON.stringify(running.snapshot())).not.toContain('"P2"');
  });

  it('R-WORLD-004 deterministic: the same inputs give the same snapshots, and restore resumes', () => {
    const run = () => {
      const core = TournamentCore.create(init({ breakMs: 0 }));
      withPlayers(core, 7);
      const first = begin(core);
      playOut(
        core,
        (round, board) => win((round + board) % 3 === 0 ? null : board % 2 ? 'white' : 'black'),
        init().startsAt,
        [first],
      );
      return core.snapshot();
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.status).toBe('finished');
    const restored = TournamentCore.restore(a);
    expect(restored.snapshot()).toEqual(a);
    // 7 players: 4 rounds, one bye per round, never twice to the same player.
    const byes = a.rounds.flatMap((r) =>
      r.pairings.filter((p) => p.result === 'bye').map((p) => p.white),
    );
    expect(byes).toHaveLength(4);
    expect(new Set(byes).size).toBe(4);
  });
});
