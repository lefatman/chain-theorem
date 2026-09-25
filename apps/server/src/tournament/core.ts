/**
 * TournamentCore (M7 7.1; spec 10.4 R-WORLD-004, 9.3 R-FMT-004, 12.2 TournamentRoom): the whole
 * tournament as a pure, deterministic state machine. No clock, no I/O: the TournamentRoom passes the
 * time in, runs the returned effects (battles, notices, the end), persists `snapshot()` and sets its
 * alarm to `nextAlarm()`.
 *
 * Lifecycle: `open` (registration until `startsAt`, at most `maxPlayers`) → at the start alarm the
 * host loads each entrant's rating and level (`start`): players no longer in the bracket are dropped,
 * too few players cancel the event, otherwise seeds follow the rating and round 1 is paired → each
 * round's pairings are public for `breakMs`, then an alarm starts its battles → results arrive from
 * `settleBattle` (idempotent per battle) → when every game of the round has a result, the next round
 * is paired → after the last round (Swiss) or the final (single elimination) the event is `finished`:
 * places, the winner and the prizes (the `settle` effect repeats until the host confirms it; grants
 * are idempotent by key, R-SEC-003).
 *
 * A game one player never started is a forfeit (a loss for the absent player), both absent is a
 * double loss; a player who misses `withdrawAfterNoShows` games is withdrawn from later rounds.
 */
import type {
  Bracket,
  TournamentNotice,
  TournamentPairing,
  TournamentStanding,
  TournamentView,
} from '@chain-theorem/protocol';
import { eliminationRounds, firstField, matches } from './elimination.ts';
import {
  advances,
  eliminationStandings,
  scoreLines,
  swissPlayers,
  swissStandings,
  type StandingRow,
} from './standings.ts';
import { colourFor, defaultSwissRounds, maxSwissRounds, pairSwiss } from './swiss.ts';
import type {
  Effect,
  Entrant,
  Game,
  GameOutcome,
  Outbox,
  Pairing,
  Place,
  PrizeGrant,
  Round,
  TournamentInit,
  TournamentSnapshot,
} from './types.ts';

export const DELETED_NAME = 'Deleted player';

/** The battle of a pairing: deterministic, so creating it twice is harmless (409 exists). */
export function battleIdFor(tournamentId: string, round: number, board: number): string {
  return `t-${tournamentId}-${round}-${board}`;
}

/** The grant key of a tournament prize: one per player and tournament (R-SEC-003). */
export function prizeKey(tournamentId: string, playerId: string): string {
  return `tournament:${tournamentId}:${playerId}`;
}

/** What the host learned about an entrant at the start. */
export interface EntrantFacts {
  rating: number;
  level: number;
  /** Still eligible: the account exists, is not suspended, and its level is in the bracket. */
  ok: boolean;
}

export type RegisterError = 'closed' | 'full' | 'already';
export type UnregisterResult = 'removed' | 'withdrawn' | 'not_registered' | 'closed';

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function checkInit(init: TournamentInit): void {
  if (!init.id || init.id.length > 40) throw new Error('TournamentCore: bad id');
  if (!Number.isSafeInteger(init.startsAt)) throw new Error('TournamentCore: bad startsAt');
  if (!Number.isInteger(init.maxPlayers) || init.maxPlayers < 2 || init.maxPlayers > 256)
    throw new Error('TournamentCore: bad maxPlayers');
  if (!Number.isInteger(init.breakMs) || init.breakMs < 0)
    throw new Error('TournamentCore: bad breakMs');
  if (init.rounds !== null && (!Number.isInteger(init.rounds) || init.rounds < 1))
    throw new Error('TournamentCore: bad rounds');
}

export class TournamentCore {
  private s: TournamentSnapshot;
  private out: Outbox = { effects: [], save: false, sync: false };

  private constructor(s: TournamentSnapshot) {
    this.s = s;
  }

  static create(init: TournamentInit): TournamentCore {
    checkInit(init);
    return new TournamentCore({
      v: 1,
      init: clone(init),
      status: 'open',
      entrants: [],
      plannedRounds: 0,
      rounds: [],
      startedAt: null,
      finishedAt: null,
      winner: null,
      places: [],
      settle: 'none',
      settleAt: null,
      rev: 1,
    });
  }

  static restore(snap: TournamentSnapshot): TournamentCore {
    if (snap.v !== 1) throw new Error(`TournamentCore: unknown snapshot version ${snap.v}`);
    return new TournamentCore(clone(snap));
  }

  snapshot(): TournamentSnapshot {
    return clone(this.s);
  }

  get id(): string {
    return this.s.init.id;
  }

  get status(): TournamentSnapshot['status'] {
    return this.s.status;
  }

  get init(): TournamentInit {
    return this.s.init;
  }

  get entrants(): readonly Entrant[] {
    return this.s.entrants;
  }

  // ---- registration ----------------------------------------------------------------------------

  /** Register before the start; null on success. */
  register(p: { id: string; name: string; level: number }, now: number): RegisterError | null {
    const s = this.s;
    if (s.status !== 'open' || now >= s.init.startsAt) return 'closed';
    if (s.entrants.some((e) => e.id === p.id)) return 'already';
    if (s.entrants.length >= s.init.maxPlayers) return 'full';
    s.entrants.push({
      id: p.id,
      name: cut(p.name, 40),
      level: p.level,
      registeredAt: now,
      rating: 0,
      seed: 0,
      withdrawn: false,
      noShows: 0,
    });
    s.rev++;
    return null;
  }

  /**
   * Before the start: leave the list. While running: withdraw (Swiss: not paired again; single
   * elimination: the next match is a forfeit). A game already started is still to be played.
   */
  unregister(id: string): UnregisterResult {
    const s = this.s;
    const e = s.entrants.find((x) => x.id === id);
    if (!e) return 'not_registered';
    if (s.status === 'open') {
      s.entrants = s.entrants.filter((x) => x !== e);
      s.rev++;
      return 'removed';
    }
    if (s.status === 'running') {
      if (!e.withdrawn) {
        e.withdrawn = true;
        s.rev++;
      }
      return 'withdrawn';
    }
    return 'closed';
  }

  // ---- time ------------------------------------------------------------------------------------

  /** The alarm fired (or any time the host wants to catch up). */
  alarm(now: number): Outbox {
    const s = this.s;
    if (s.status === 'open' && now >= s.init.startsAt) this.effect({ kind: 'start' });
    else if (s.status === 'running') {
      const r = this.current();
      if (r && !r.started && now >= r.startsAt) this.startRound(r, now);
      else if (r?.started && r.finishedAt === null && r.checkAt !== null && now >= r.checkAt) {
        const games = this.unfinished(r);
        if (games.length > 0) this.effect({ kind: 'check', round: r.n, games });
        r.checkAt = now + s.init.rules.watchdogMs;
        this.out.save = true;
      }
    } else if (
      s.status === 'finished' &&
      s.settle === 'pending' &&
      s.settleAt !== null &&
      now >= s.settleAt
    ) {
      this.effect(this.settleEffect());
      s.settleAt = now + s.init.rules.prizeRetryMs;
      this.out.save = true;
    }
    return this.flush();
  }

  /** When the host should call `alarm` next; null: nothing scheduled. */
  nextAlarm(): number | null {
    const s = this.s;
    switch (s.status) {
      case 'open':
        return s.init.startsAt;
      case 'running': {
        const r = this.current();
        if (!r) return null;
        if (!r.started) return r.startsAt;
        return r.finishedAt === null ? r.checkAt : null;
      }
      case 'finished':
        return s.settle === 'pending' ? s.settleAt : null;
      case 'cancelled':
        return null;
    }
  }

  /**
   * The start (after the `start` effect): drop players who are no longer eligible, cancel with too
   * few, otherwise seed by rating (then registration order) and pair round 1.
   */
  start(now: number, facts: ReadonlyMap<string, EntrantFacts>): Outbox {
    const s = this.s;
    if (s.status !== 'open') return this.flush();
    s.entrants = s.entrants.filter((e) => facts.get(e.id)?.ok === true);
    for (const e of s.entrants) {
      const f = facts.get(e.id);
      if (!f) continue;
      e.rating = f.rating;
      e.level = f.level;
    }
    s.rev++;
    this.out.save = true;
    if (s.entrants.length < s.init.rules.minPlayers) {
      this.cancelNow(now);
      return this.flush();
    }
    s.entrants.sort(
      (a, b) =>
        b.rating - a.rating ||
        a.registeredAt - b.registeredAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    s.entrants.forEach((e, i) => (e.seed = i + 1));
    const n = s.entrants.length;
    s.plannedRounds =
      s.init.system === 'swiss'
        ? s.init.rounds === null
          ? defaultSwissRounds(n, s.init.rules.extraSwissRounds)
          : Math.min(s.init.rounds, maxSwissRounds(n))
        : eliminationRounds(n);
    s.status = 'running';
    s.startedAt = now;
    this.out.sync = true;
    this.pairNext(now);
    return this.flush();
  }

  // ---- results ---------------------------------------------------------------------------------

  /** A battle of this tournament ended (idempotent: a second report of the same battle is ignored). */
  result(battleId: string, o: GameOutcome, now: number): Outbox {
    const s = this.s;
    if (s.status !== 'running') return this.flush();
    for (const r of s.rounds) {
      const p = r.pairings.find((x) => x.battleId === battleId);
      if (!p) continue;
      if (p.result !== null || p.black === null) return this.flush();
      this.record(p, o);
      s.rev++;
      this.out.save = true;
      this.maybeFinishRound(r, now);
      return this.flush();
    }
    return this.flush();
  }

  private record(p: Pairing, o: GameOutcome): void {
    const absent: string[] = [];
    if (o.absent.white) absent.push(p.white);
    if (o.absent.black && p.black !== null) absent.push(p.black);
    p.absent = absent;
    p.reason = cut(o.reason, 32);
    if (o.absent.white && o.absent.black) p.result = 'none';
    else if (o.absent.white) p.result = 'black';
    else if (o.absent.black) p.result = 'white';
    else p.result = o.winner ?? 'draw';
    for (const id of absent) {
      const e = this.s.entrants.find((x) => x.id === id);
      if (!e) continue;
      e.noShows++;
      if (e.noShows >= this.s.init.rules.withdrawAfterNoShows) e.withdrawn = true;
    }
  }

  /** The host confirmed (or failed) the end's database writes and prizes. */
  settled(ok: boolean, now: number): Outbox {
    const s = this.s;
    if (s.settle !== 'pending') return this.flush();
    if (ok) {
      s.settle = 'done';
      s.settleAt = null;
    } else s.settleAt = now + s.init.rules.prizeRetryMs;
    this.out.save = true;
    return this.flush();
  }

  /** An admin cancelled the event (open or running): no more rounds, no prizes. */
  cancel(now: number): Outbox {
    if (this.s.status === 'open' || this.s.status === 'running') this.cancelNow(now);
    return this.flush();
  }

  /** The account was deleted (R-SEC-010): off the list before the start, anonymized after it. */
  forget(playerId: string): Outbox {
    const s = this.s;
    const e = s.entrants.find((x) => x.id === playerId);
    if (!e) return this.flush();
    if (s.status === 'open') s.entrants = s.entrants.filter((x) => x !== e);
    else {
      e.name = DELETED_NAME;
      e.deleted = true;
      if (s.status === 'running') e.withdrawn = true;
    }
    s.rev++;
    this.out.save = true;
    return this.flush();
  }

  // ---- rounds ----------------------------------------------------------------------------------

  private current(): Round | undefined {
    return this.s.rounds[this.s.rounds.length - 1];
  }

  private unfinished(r: Round): Game[] {
    const out: Game[] = [];
    for (const p of r.pairings)
      if (p.battleId && p.black !== null && p.result === null)
        out.push({ battleId: p.battleId, white: p.white, black: p.black });
    return out;
  }

  private name(id: string | null): string | null {
    if (id === null) return null;
    return this.s.entrants.find((e) => e.id === id)?.name ?? '?';
  }

  private withdrawn(id: string): boolean {
    return this.s.entrants.find((e) => e.id === id)?.withdrawn === true;
  }

  /** Pair the next round, or finish when there is none. */
  private pairNext(now: number): void {
    const s = this.s;
    const n = s.rounds.length + 1;
    const pairings = s.init.system === 'swiss' ? this.pairSwissRound(n) : this.pairElimination(n);
    if (!pairings) {
      this.finish(now);
      return;
    }
    const round: Round = {
      n,
      startsAt: now + s.init.breakMs,
      started: false,
      finishedAt: null,
      pairings: pairings.list,
      checkAt: null,
      ...(pairings.field ? { field: pairings.field } : {}),
    };
    s.rounds.push(round);
    s.rev++;
    this.out.save = true;
    this.out.sync = true;
    for (const p of round.pairings) {
      for (const [me, them] of [
        [p.white, p.black],
        [p.black, p.white],
      ] as const) {
        if (me === null) continue;
        this.notify(me, {
          kind: 'paired',
          round: n,
          opponent: p.result === 'bye' ? null : this.name(them),
          startsAt: round.startsAt,
        });
      }
    }
    if (now >= round.startsAt) this.startRound(round, now);
  }

  private pairSwissRound(n: number): { list: Pairing[]; field?: undefined } | null {
    const s = this.s;
    const active = s.entrants.filter((e) => !e.withdrawn);
    if (n > s.plannedRounds || active.length < 2) return null;
    const lines = scoreLines(s.entrants, s.rounds, s.init.rules.byePoints);
    const pr = pairSwiss(swissPlayers(s.entrants, lines));
    const list: Pairing[] = pr.pairs.map((p) => ({
      board: p.board,
      white: p.white,
      black: p.black,
      battleId: battleIdFor(s.init.id, n, p.board),
      result: null,
      absent: [],
      reason: null,
    }));
    if (pr.bye !== null)
      list.push({
        board: list.length + 1,
        white: pr.bye,
        black: null,
        battleId: null,
        result: 'bye',
        absent: [],
        reason: 'bye',
      });
    return { list };
  }

  private pairElimination(n: number): { list: Pairing[]; field: (string | null)[] } | null {
    const s = this.s;
    if (n > s.plannedRounds) return null;
    let field: (string | null)[];
    if (n === 1) field = firstField(s.entrants.map((e) => e.id));
    else {
      const prev = s.rounds[n - 2];
      if (!prev?.field) return null;
      field = matches(prev.field).map((m) => {
        const p = prev.pairings.find((x) => x.slot === m.slot);
        return p ? advances(p, s.init.rules.seDrawAdvances) : null;
      });
    }
    if (field.filter((x) => x !== null).length < 2) return null;
    const lines = scoreLines(s.entrants, s.rounds, 1);
    const seed = (id: string) => s.entrants.find((e) => e.id === id)?.seed ?? 0;
    const list: Pairing[] = [];
    for (const m of matches(field)) {
      const board = m.slot + 1;
      if (m.a !== null && m.b !== null) {
        const [hi, lo] = seed(m.a) <= seed(m.b) ? [m.a, m.b] : [m.b, m.a];
        const white =
          colourFor(lines.get(hi)?.colours ?? [], lines.get(lo)?.colours ?? [], board) === 'w'
            ? hi
            : lo;
        const black = white === hi ? lo : hi;
        const p: Pairing = {
          board,
          slot: m.slot,
          white,
          black,
          battleId: battleIdFor(s.init.id, n, board),
          result: null,
          absent: [],
          reason: null,
        };
        // A withdrawn player forfeits the match without a battle.
        const ww = this.withdrawn(white);
        const bw = this.withdrawn(black);
        if (ww || bw) {
          p.battleId = null;
          p.absent = [...(ww ? [white] : []), ...(bw ? [black] : [])];
          p.result = ww && bw ? 'none' : ww ? 'black' : 'white';
          p.reason = 'withdrawn';
        }
        list.push(p);
      } else if (m.a !== null || m.b !== null) {
        list.push({
          board,
          slot: m.slot,
          white: (m.a ?? m.b) as string,
          black: null,
          battleId: null,
          result: 'bye',
          absent: [],
          reason: 'bye',
        });
      }
    }
    return { list, field };
  }

  /** The round's break is over: create its battles (games already decided need none). */
  private startRound(r: Round, now: number): void {
    const s = this.s;
    r.started = true;
    const games = this.unfinished(r);
    if (games.length > 0) {
      this.effect({ kind: 'battles', round: r.n, games });
      r.checkAt = now + s.init.rules.watchdogMs;
      for (const g of games) {
        this.notify(g.white, { kind: 'game', round: r.n, opponent: this.name(g.black) });
        this.notify(g.black, { kind: 'game', round: r.n, opponent: this.name(g.white) });
      }
    }
    s.rev++;
    this.out.save = true;
    this.out.sync = true;
    this.maybeFinishRound(r, now);
  }

  private maybeFinishRound(r: Round, now: number): void {
    if (!r.started || r.finishedAt !== null) return;
    if (r.pairings.some((p) => p.result === null)) return;
    r.finishedAt = now;
    r.checkAt = null;
    this.s.rev++;
    this.out.save = true;
    if (r === this.current()) this.pairNext(now);
  }

  // ---- the end ---------------------------------------------------------------------------------

  standings(): StandingRow[] {
    const s = this.s;
    return s.init.system === 'swiss'
      ? swissStandings(s.entrants, s.rounds, s.init.rules)
      : eliminationStandings(s.entrants, s.rounds, s.plannedRounds, s.init.rules.seDrawAdvances);
  }

  private finish(now: number): void {
    const s = this.s;
    const rows = this.standings();
    const top = rows[0];
    s.winner =
      top && (s.init.system === 'swiss' ? top.points > 0 : top.alive && top.rank === 1)
        ? top.id
        : null;
    s.places = rows.map((r) => ({ id: r.id, place: r.rank, points: r.points }));
    s.status = 'finished';
    s.finishedAt = now;
    s.settle = 'pending';
    s.settleAt = now + s.init.rules.prizeRetryMs;
    s.rev++;
    this.out.save = true;
    this.out.sync = true;
    this.effect(this.settleEffect());
    for (const e of s.entrants) {
      if (e.deleted) continue;
      this.notify(e.id, {
        kind: 'finished',
        place: s.places.find((p) => p.id === e.id)?.place ?? null,
      });
    }
  }

  /**
   * Prizes by place, for players who played (a point, or a game they did not forfeit) and whose
   * account still exists.
   */
  private grants(): PrizeGrant[] {
    const s = this.s;
    const played = new Set(
      this.standings()
        .filter((r) => r.points > 0 || r.games > r.forfeits)
        .map((r) => r.id),
    );
    const out: PrizeGrant[] = [];
    for (const prize of s.init.prizes)
      for (const p of s.places) {
        if (p.place !== prize.place || !played.has(p.id)) continue;
        if (s.entrants.find((e) => e.id === p.id)?.deleted) continue;
        out.push({
          playerId: p.id,
          place: p.place,
          key: prizeKey(s.init.id, p.id),
          xp: prize.xp,
          coins: prize.coins,
        });
      }
    return out;
  }

  private settleEffect(): Effect {
    return {
      kind: 'settle',
      winner: this.s.winner,
      places: this.s.places.map((p): Place => ({ ...p })),
      grants: this.grants(),
    };
  }

  private cancelNow(now: number): void {
    const s = this.s;
    s.status = 'cancelled';
    s.finishedAt = now;
    s.settle = 'done';
    s.settleAt = null;
    s.rev++;
    this.out.save = true;
    this.out.sync = true;
    for (const e of s.entrants) if (!e.deleted) this.notify(e.id, { kind: 'cancelled' });
  }

  // ---- views -----------------------------------------------------------------------------------

  /** The database summary row. */
  summary(): {
    status: TournamentSnapshot['status'];
    players: number;
    rounds: number;
    round: number;
    startedAt: number | null;
    finishedAt: number | null;
    winnerId: string | null;
  } {
    const s = this.s;
    return {
      status: s.status,
      players: s.entrants.length,
      rounds: s.plannedRounds,
      round: s.rounds.length,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      winnerId: s.winner,
    };
  }

  /** The player's game of the round being played, while it has no result. */
  gameFor(
    playerId: string,
  ): { battleId: string; round: number; colour: 'white' | 'black'; opponent: string } | null {
    const r = this.current();
    if (this.s.status !== 'running' || !r?.started || r.finishedAt !== null) return null;
    const p = r.pairings.find(
      (x) =>
        x.battleId !== null &&
        x.result === null &&
        x.black !== null &&
        (x.white === playerId || x.black === playerId),
    );
    if (!p?.battleId || p.black === null) return null;
    const white = p.white === playerId;
    return {
      battleId: p.battleId,
      round: r.n,
      colour: white ? 'white' : 'black',
      opponent: this.name(white ? p.black : p.white) ?? '?',
    };
  }

  /** Why `bracket` cannot register now (null: it can, or is registered). */
  cannotRegister(playerId: string, bracket: Bracket | null, now: number): string | null {
    const s = this.s;
    if (s.entrants.some((e) => e.id === playerId)) return null;
    if (s.status !== 'open' || now >= s.init.startsAt) return 'closed';
    if (bracket !== null && bracket !== s.init.bracket) return 'wrong_bracket';
    if (s.entrants.length >= s.init.maxPlayers) return 'full';
    return null;
  }

  view(viewer: { id: string; bracket: Bracket | null } | null, now: number): TournamentView {
    const s = this.s;
    const ref = (id: string) => ({ id, name: this.name(id) ?? '?' });
    const me = viewer?.id ?? null;
    const standings: TournamentStanding[] =
      s.status === 'open'
        ? []
        : this.standings().map((r) => ({
            rank: r.rank,
            id: r.id,
            name: this.name(r.id) ?? '?',
            seed: r.seed,
            points: r.points,
            buchholz: r.buchholz,
            sb: r.sb,
            wins: r.wins,
            games: r.games,
            forfeits: r.forfeits,
            withdrawn: r.withdrawn,
            alive: r.alive,
          }));
    const roundList = s.rounds.map((r) => ({
      n: r.n,
      startsAt: r.startsAt,
      started: r.started,
      finished: r.finishedAt !== null,
      pairings: r.pairings.map((p): TournamentPairing => {
        const mine = me !== null && (p.white === me || p.black === me);
        return {
          board: p.board,
          ...(p.slot !== undefined ? { slot: p.slot } : {}),
          white: ref(p.white),
          black: p.black === null ? null : ref(p.black),
          result: p.result,
          absent: p.absent,
          ...(mine && p.battleId && r.started ? { battleId: p.battleId } : {}),
        };
      }),
    }));
    const entrant = me === null ? undefined : s.entrants.find((e) => e.id === me);
    const r = this.current();
    let next: TournamentView['you']['next'] = null;
    if (me !== null && s.status === 'running' && r && !r.started) {
      const p = r.pairings.find((x) => x.white === me || x.black === me);
      if (p)
        next = {
          round: r.n,
          startsAt: r.startsAt,
          colour: p.black === null ? null : p.white === me ? 'white' : 'black',
          opponent: p.black === null ? null : this.name(p.white === me ? p.black : p.white),
        };
    }
    return {
      id: s.init.id,
      name: s.init.name,
      format: s.init.format,
      bracket: s.init.bracket,
      system: s.init.system,
      status: s.status,
      startsAt: s.init.startsAt,
      maxPlayers: s.init.maxPlayers,
      players: s.entrants.length,
      rounds: s.plannedRounds,
      round: s.rounds.length,
      breakMs: s.init.breakMs,
      winner: s.winner === null ? null : ref(s.winner),
      entrants: s.entrants.map((e) => ({
        id: e.id,
        name: e.name,
        level: e.level,
        seed: e.seed,
        withdrawn: e.withdrawn,
      })),
      standings,
      roundList,
      prizes: s.init.prizes.map((p) => ({ ...p })),
      you: {
        registered: entrant !== undefined,
        withdrawn: entrant?.withdrawn === true,
        game: me === null ? null : this.gameFor(me),
        next,
        place: me === null ? null : (s.places.find((p) => p.id === me)?.place ?? null),
        cannot: me === null ? null : this.cannotRegister(me, viewer?.bracket ?? null, now),
      },
      rev: s.rev,
      now,
    };
  }

  // ---- plumbing --------------------------------------------------------------------------------

  private notify(to: string, n: Omit<TournamentNotice, 'id' | 'name'>): void {
    const e = this.s.entrants.find((x) => x.id === to);
    if (!e || e.deleted) return;
    this.effect({
      kind: 'notify',
      to,
      notice: { id: this.s.init.id, name: this.s.init.name, ...n },
    });
  }

  private effect(e: Effect): void {
    this.out.effects.push(e);
  }

  private flush(): Outbox {
    const out = this.out;
    this.out = { effects: [], save: false, sync: false };
    return out;
  }
}
