/**
 * TournamentRoom Durable Object (M7 7.1; spec 12.2, 10.4 R-WORLD-004): one instance per tournament,
 * named by its id. It wraps the pure TournamentCore: the core decides registration, pairings, results
 * and the end; the room persists the core snapshot before running any effect, and uses Alarms only
 * (the start, each round's start after its break, a watchdog while a round runs, the end's retries;
 * no intervals, loops or outbound sockets, R-COST-002). The tournament page polls `GET /view`, so the
 * room holds no sockets at all.
 *
 * Effects: `start` loads each entrant's level, bracket and rating; `battles` creates each game's
 * BattleRoom with the players' fighting loadouts (`loadFighter`, DD-78) and the origin
 * `{ kind: 'tournament', tournamentId, round }`, so `settleBattle` reports the result here
 * (`POST /result`, idempotent per battle); `check` re-reads unfinished battles from the database and
 * the log archive (a lost report) and re-creates a battle that never started; `notify` reaches a
 * player in the world through presence (`tourney` zone notice); `settle` writes the end (the row and
 * places) and grants the prizes once per player (`tournament:<id>:<player>`, R-SEC-003).
 *
 * Host calls (from the Worker): `POST /create`, `POST /register`, `POST /unregister`, `GET /view`,
 * `GET /game`, `POST /result`, `POST /cancel`, `POST /forget` (account deletion, R-SEC-010).
 */
import { DurableObject } from 'cloudflare:workers';
import { RANKED } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type { Bracket, TournamentNotice } from '@chain-theorem/protocol';
import type { BattleInit, SeatInit } from '../battle/index.ts';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import { isSuspended } from '../moderation/sanctions.ts';
import { bracketForLevel } from '../rating/ranked.ts';
import {
  TournamentCore,
  type Effect,
  type EntrantFacts,
  type Game,
  type GameOutcome,
  type Outbox,
  type TournamentInit,
  type TournamentSnapshot,
} from '../tournament/index.ts';
import type { BattleOrigin, Fighter } from '../world/battles.ts';
import { grantOnce, loadFighter, syncLevel } from '../world/progress.ts';
import { callPlayer } from '../world/routing.ts';
import { archivedOutcome } from '../world/tournament.ts';

const SNAP = 'snap';
const DEFAULT_RATING = 1500;

const json = (data: unknown, status = 200) => Response.json(data, { status });

export class TournamentRoom extends DurableObject<Env> {
  private core: TournamentCore | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const snap = await ctx.storage.get<TournamentSnapshot>(SNAP);
      if (snap) this.core = TournamentCore.restore(snap);
    });
  }

  /** Changes run one at a time: the core must not see a second call during an effect's awaits. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.chain.then(f, f);
    this.chain = run.catch(() => undefined);
    return run;
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = async <T>() => (await req.json()) as T;
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /create': {
        const init = await body<TournamentInit>();
        return this.serial(() => this.create(init));
      }
      case 'POST /register': {
        const b = await body<{
          player: { id: string; name: string; level: number };
          bracket: Bracket;
        }>();
        return this.serial(() => this.register(b.player, b.bracket));
      }
      case 'POST /unregister': {
        const b = await body<{ playerId: string; bracket: Bracket | null }>();
        return this.serial(() => this.unregister(b.playerId, b.bracket));
      }
      case 'GET /view': {
        const core = this.core;
        if (!core) return json({ error: 'not_found' }, 404);
        const player = url.searchParams.get('player');
        const bracket = url.searchParams.get('bracket') as Bracket | null;
        return json(core.view(player ? { id: player, bracket } : null, Date.now()));
      }
      case 'GET /game': {
        const game = this.core?.gameFor(url.searchParams.get('player') ?? '') ?? null;
        return game ? json(game) : json({ error: 'no_game' }, 404);
      }
      case 'POST /result': {
        const b = await body<{ battleId: string; outcome: GameOutcome }>();
        return this.serial(async () => {
          const core = this.core;
          if (!core) return json({ error: 'not_found' }, 404);
          await this.deliver(core.result(b.battleId, b.outcome, Date.now()));
          return json({ ok: true });
        });
      }
      case 'POST /cancel':
        return this.serial(async () => {
          const core = this.core;
          if (!core) return json({ error: 'not_found' }, 404);
          if (core.status !== 'open' && core.status !== 'running')
            return json({ error: 'closed' }, 409);
          await this.deliver(core.cancel(Date.now()));
          return json(core.view(null, Date.now()));
        });
      case 'POST /forget': {
        const b = await body<{ playerId: string }>();
        return this.serial(async () => {
          const core = this.core;
          if (core) await this.deliver(core.forget(b.playerId));
          return json({ ok: true });
        });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  }

  override async alarm(): Promise<void> {
    await this.serial(async () => {
      const core = this.core;
      if (core) await this.deliver(core.alarm(Date.now()));
    });
  }

  // ---- host calls --------------------------------------------------------------------------------

  private async create(init: TournamentInit): Promise<Response> {
    if (this.core)
      return this.core.id === init.id ? json({ ok: true }) : json({ error: 'exists' }, 409);
    try {
      this.core = TournamentCore.create(init);
    } catch (e) {
      return json({ error: 'bad_init', detail: String(e) }, 400);
    }
    await this.save();
    await this.arm();
    return json({ ok: true });
  }

  private async register(
    player: { id: string; name: string; level: number },
    bracket: Bracket,
  ): Promise<Response> {
    const core = this.core;
    if (!core) return json({ error: 'not_found' }, 404);
    const now = Date.now();
    const cannot = core.cannotRegister(player.id, bracket, now);
    if (cannot) return json({ error: cannot }, 409);
    const err = core.register(player, now);
    if (err) return json({ error: err }, 409);
    // The room decides (and stores its decision first); the database row mirrors it.
    await this.save();
    const db = await getDb(this.env);
    try {
      const r = await db.tournaments.addEntry(core.id, player.id, now);
      if (r !== 'added' && r !== 'exists') {
        core.unregister(player.id);
        await this.save();
        return json({ error: r === 'full' ? 'full' : 'not_found' }, 409);
      }
    } catch (e) {
      core.unregister(player.id);
      await this.save();
      throw e;
    } finally {
      await releaseDb(this.env, db);
    }
    return json(core.view({ id: player.id, bracket }, now));
  }

  private async unregister(playerId: string, bracket: Bracket | null): Promise<Response> {
    const core = this.core;
    if (!core) return json({ error: 'not_found' }, 404);
    const r = core.unregister(playerId);
    if (r === 'not_registered') return json({ error: 'not_registered' }, 404);
    if (r === 'closed') return json({ error: 'closed' }, 409);
    await this.save();
    if (r === 'removed') {
      const db = await getDb(this.env);
      try {
        await db.tournaments.removeEntry(core.id, playerId);
      } finally {
        await releaseDb(this.env, db);
      }
    }
    return json(core.view({ id: playerId, bracket }, Date.now()));
  }

  // ---- effects -----------------------------------------------------------------------------------

  private async save(): Promise<void> {
    if (this.core) await this.ctx.storage.put(SNAP, this.core.snapshot());
  }

  private async arm(): Promise<void> {
    const next = this.core?.nextAlarm() ?? null;
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  /**
   * Persist first, then run the effects in order; effects that report back to the core (a battle
   * that could not start, a battle read by the watchdog, the end) are applied after, each delivered
   * the same way. Then re-arm the alarm.
   */
  private async deliver(out: Outbox, shared?: Db): Promise<void> {
    const core = this.core;
    if (!core) return;
    if (out.save) await this.save();
    const db = shared ?? (await getDb(this.env));
    try {
      const follow: (() => Outbox)[] = [];
      for (const e of out.effects) await this.run(db, core, e, follow);
      if (out.sync) await this.sync(db, core);
      for (const f of follow) await this.deliver(f(), db);
    } finally {
      if (!shared) await releaseDb(this.env, db);
    }
    await this.arm();
  }

  private async run(db: Db, core: TournamentCore, e: Effect, follow: (() => Outbox)[]) {
    switch (e.kind) {
      case 'start': {
        const facts = await this.facts(db, core);
        follow.push(() => core.start(Date.now(), facts));
        // Players who can no longer take part leave the database list too.
        for (const [id, f] of facts)
          if (!f.ok) await db.tournaments.removeEntry(core.id, id).catch(() => false);
        return;
      }
      case 'battles':
        for (const g of e.games) {
          const failed = await this.createBattle(db, core, e.round, g);
          if (failed) follow.push(() => core.result(g.battleId, failed, Date.now()));
        }
        return;
      case 'check':
        for (const g of e.games) {
          const row = await db.battles.get(g.battleId);
          if (!row) {
            // The room was evicted before this battle was created: create it now.
            const failed = await this.createBattle(db, core, e.round, g);
            if (failed) follow.push(() => core.result(g.battleId, failed, Date.now()));
            continue;
          }
          const o = await archivedOutcome(this.env, row);
          if (o) follow.push(() => core.result(g.battleId, o, Date.now()));
        }
        return;
      case 'notify':
        await this.notify(db, e.to, e.notice);
        return;
      case 'settle': {
        const ok = await this.settle(db, core, e);
        follow.push(() => core.settled(ok, Date.now()));
        return;
      }
      case 'error':
        console.error(`tournament ${core.id}: ${e.message}`);
        return;
    }
  }

  /** Level, bracket, standing and rating of every entrant at the start (R-FMT-004). */
  private async facts(db: Db, core: TournamentCore): Promise<Map<string, EntrantFacts>> {
    const now = Date.now();
    const out = new Map<string, EntrantFacts>();
    for (const e of core.entrants) {
      const p = await db.players.getById(e.id);
      if (!p) {
        out.set(e.id, { rating: DEFAULT_RATING, level: e.level, ok: false });
        continue;
      }
      // Seeds follow the Glicko-2 rating of the event's format and bracket (1500 when unrated, or
      // when the format has no ranked queue).
      const rated = RANKED.formats.includes(core.init.format)
        ? await db.ratings.get(p.id, core.init.format, core.init.bracket)
        : null;
      out.set(e.id, {
        rating: rated?.rating ?? DEFAULT_RATING,
        level: p.level,
        ok: !isSuspended(p, now) && bracketForLevel(p.level) === core.init.bracket,
      });
    }
    return out;
  }

  /** Create one game's BattleRoom; the outcome to record when it cannot start, else null. */
  private async createBattle(
    db: Db,
    core: TournamentCore,
    round: number,
    g: Game,
  ): Promise<GameOutcome | null> {
    const [white, black] = [await loadFighter(db, g.white), await loadFighter(db, g.black)];
    if (!white || !black)
      return {
        winner: white ? 'white' : black ? 'black' : null,
        reason: 'abandon',
        absent: { white: !white, black: !black },
      };
    const seat = (f: Fighter): SeatInit => ({
      playerId: f.playerId,
      name: f.name,
      level: f.level,
      loadout: f.loadout,
    });
    const origin: BattleOrigin = { kind: 'tournament', tournamentId: core.id, round };
    const init: BattleInit & { origin: BattleOrigin } = {
      battleId: g.battleId,
      format: core.init.format,
      white: seat(white),
      black: seat(black),
      origin,
    };
    const res = await this.env.BATTLE_ROOM.get(this.env.BATTLE_ROOM.idFromName(g.battleId)).fetch(
      'https://room/init',
      { method: 'POST', body: JSON.stringify(init) },
    );
    // 409: it exists already (a retry after an eviction).
    if (res.ok || res.status === 409) return null;
    console.error(`tournament ${core.id}: battle ${g.battleId} failed: ${await res.text()}`);
    // A battle that cannot be created is adjudicated a draw (never charged to either player).
    return { winner: null, reason: 'error', absent: { white: false, black: false } };
  }

  /** A zone notice to a player in the world (never throws: the page shows the same). */
  private async notify(db: Db, to: string, notice: TournamentNotice): Promise<void> {
    try {
      await callPlayer(this.env, db, to, 'notify', { id: to, msg: { t: 'tourney', d: notice } });
    } catch (err) {
      console.error(`tournament ${notice.id}: notifying ${to} failed: ${String(err)}`);
    }
  }

  private async sync(db: Db, core: TournamentCore): Promise<void> {
    const s = core.summary();
    try {
      await db.tournaments.update(core.id, {
        status: s.status,
        rounds: s.rounds,
        round: s.round,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      });
    } catch (err) {
      console.error(`tournament ${core.id}: sync failed: ${String(err)}`);
    }
  }

  /**
   * The end: the row, winner and places in one atomic list, then each prize once
   * (`tournament:<id>:<player>`; a retry after a failure pays nobody twice, R-SEC-003).
   */
  private async settle(
    db: Db,
    core: TournamentCore,
    e: Extract<Effect, { kind: 'settle' }>,
  ): Promise<boolean> {
    try {
      const now = Date.now();
      const winner = e.winner && (await db.players.getById(e.winner)) ? e.winner : null;
      await db.tournaments.finish(core.id, {
        status: 'finished',
        finishedAt: core.summary().finishedAt ?? now,
        winnerId: winner,
        places: e.places.map((p) => ({ playerId: p.id, place: p.place, points: p.points })),
      });
      for (const g of e.grants) {
        if (!(await db.players.getById(g.playerId))) continue;
        const reward = { xp: g.xp, coins: g.coins };
        const granted = await grantOnce(db, g.playerId, { key: g.key, reward, flags: [] }, now);
        const level = await syncLevel(db, g.playerId);
        if (granted)
          await callPlayer(this.env, db, g.playerId, 'grant', {
            id: g.playerId,
            reward,
            level,
          }).catch(() => false);
      }
      return true;
    } catch (err) {
      console.error(`tournament ${core.id}: settling failed: ${String(err)}`);
      return false;
    }
  }
}
