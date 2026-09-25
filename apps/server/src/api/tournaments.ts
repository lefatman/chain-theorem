/**
 * Tournaments (M7 7.1; spec 10.4 R-WORLD-004, 9.3 R-FMT-004, 12.2 TournamentRoom). The listing and
 * history come from the database; the live state (registration, pairings, results) from the event's
 * TournamentRoom.
 *
 * | Method and path                         | Answer                                                                   |
 * | --------------------------------------- | ------------------------------------------------------------------------ |
 * | `GET /api/tournaments`                  | `TournamentList` (today's scheduled events are created when first listed) |
 * | `GET /api/tournaments/:id`              | `TournamentView`: bracket or standings, rounds, your game                 |
 * | `POST /api/tournaments/:id/register`    | `TournamentView`; 402/403 play gate; 409 closed, full, wrong_bracket     |
 * | `DELETE /api/tournaments/:id/register`  | `TournamentView`: off the list before the start, withdrawn after it      |
 * | `POST /api/tournaments/:id/ticket`      | `BattleTicket` for your game of the round; 404 `no_game`                 |
 *
 * Admin (ADMIN_EMAILS, audited; routes in `api/admin.ts`): `createTournament`, `cancelTournament`.
 */
import { TOURNAMENTS } from '@chain-theorem/content';
import type { Db, Player, Tournament } from '@chain-theorem/db';
import type {
  Bracket,
  CreateTournament,
  TournamentList,
  TournamentSummary,
  TournamentView,
} from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';
import { requirePlay } from '../billing/gate.ts';
import type { Env } from '../env.ts';
import { HttpError, json, type Router } from '../http.ts';
import { BRACKETS, bracketForLevel } from '../rating/ranked.ts';
import type { TournamentInit } from '../tournament/index.ts';
import { formatName, scheduledEvents, tournamentName } from '../tournament/schedule.ts';
import { tournamentStub } from '../world/tournament.ts';
import { battleTicket } from './battles.ts';
import type { Ctx } from './context.ts';

const MINUTE = 60_000;
/** An admin event starts this long after its creation when no start is given. */
const DEFAULT_START_IN_MS = 15 * MINUTE;

function summary(t: Tournament, registered: boolean): TournamentSummary {
  return {
    id: t.id,
    name: t.name,
    format: t.format as TournamentSummary['format'],
    bracket: t.bracket as Bracket,
    system: t.system,
    status: t.status,
    startsAt: t.startsAt,
    players: t.players,
    maxPlayers: t.maxPlayers,
    rounds: t.rounds,
    round: t.round,
    winner: t.winnerId ? { id: t.winnerId, name: t.winnerName ?? '?' } : null,
    registered,
    scheduled: t.scheduleKey !== null,
  };
}

/** The room's init for a new event: PLAYTEST rules and prizes copied from config (TOURNAMENTS). */
function initFor(
  t: Pick<Tournament, 'id' | 'name' | 'format' | 'bracket' | 'system' | 'startsAt' | 'maxPlayers'>,
  opts: { rounds: number | null; breakMs: number; now: number },
): TournamentInit {
  return {
    id: t.id,
    name: t.name,
    format: t.format as FormatId,
    bracket: t.bracket as Bracket,
    system: t.system,
    startsAt: t.startsAt,
    maxPlayers: t.maxPlayers,
    rounds: opts.rounds,
    breakMs: opts.breakMs,
    prizes: TOURNAMENTS.prizes.map((p) => ({ ...p })),
    rules: {
      minPlayers: TOURNAMENTS.minPlayers,
      extraSwissRounds: TOURNAMENTS.extraSwissRounds,
      byePoints: TOURNAMENTS.byePoints,
      seDrawAdvances: TOURNAMENTS.seDrawAdvances,
      withdrawAfterNoShows: TOURNAMENTS.withdrawAfterNoShows,
      watchdogMs: TOURNAMENTS.watchdogMs,
      prizeRetryMs: TOURNAMENTS.prizeRetryMs,
    },
    createdAt: opts.now,
  };
}

/** Hand the new row to its TournamentRoom; a room that refuses it takes the row away again. */
async function openRoom(env: Env, db: Db, t: Tournament, init: TournamentInit): Promise<void> {
  let ok = false;
  try {
    const res = await tournamentStub(env, t.id).fetch('https://tournament/create', {
      method: 'POST',
      body: JSON.stringify(init),
    });
    ok = res.ok;
  } finally {
    if (!ok) await db.tournaments.removeEmpty(t.id);
  }
  if (!ok) throw new HttpError(503, 'try_again');
}

/**
 * Today's scheduled events (config `TOURNAMENTS.schedule`, one per slot bracket), created once each
 * when first listed. Never throws: listing works without them.
 */
export async function ensureScheduled(env: Env, db: Db, now: number): Promise<void> {
  try {
    const want = scheduledEvents(
      now,
      TOURNAMENTS.schedule,
      BRACKETS,
      TOURNAMENTS.scheduleAheadMs,
      formatName,
    );
    if (want.length === 0) return;
    const have = new Set(
      (await db.tournaments.byScheduleKeys(want.map((w) => w.key))).map((t) => t.scheduleKey),
    );
    for (const w of want) {
      if (have.has(w.key)) continue;
      const r = await db.tournaments.createScheduled({
        name: w.name,
        format: w.format,
        bracket: w.bracket,
        system: w.system,
        startsAt: w.startsAt,
        maxPlayers: w.maxPlayers,
        scheduleKey: w.key,
        now,
      });
      if (!r.created) continue;
      await openRoom(
        env,
        db,
        r.tournament,
        initFor(r.tournament, { rounds: null, breakMs: TOURNAMENTS.breakMs, now }),
      );
    }
  } catch (err) {
    console.error(`scheduled tournaments: ${String(err)}`);
  }
}

/** An admin creates an event (validated body `CreateTournament`). */
export async function createTournament(
  env: Env,
  db: Db,
  input: CreateTournament,
  by: Player,
  now: number,
): Promise<Tournament> {
  if (!TOURNAMENTS.formats.includes(input.format)) throw new HttpError(400, 'bad_format');
  const startsAt = input.startsAt ?? now + (input.startInMs ?? DEFAULT_START_IN_MS);
  if (startsAt < now) throw new HttpError(400, 'bad_start');
  const maxPlayers = Math.min(
    input.maxPlayers ?? TOURNAMENTS.maxPlayers,
    TOURNAMENTS.maxPlayersLimit,
  );
  const t = await db.tournaments.create({
    name: input.name ?? tournamentName(formatName(input.format), input.system, input.bracket),
    format: input.format,
    bracket: input.bracket,
    system: input.system,
    startsAt,
    maxPlayers,
    createdBy: by.id,
    now,
  });
  await openRoom(
    env,
    db,
    t,
    initFor(t, {
      rounds: input.rounds ?? null,
      breakMs: input.breakMs ?? TOURNAMENTS.breakMs,
      now,
    }),
  );
  await db.audit.append({
    playerId: by.id,
    kind: 'admin.tournament_create',
    payload: {
      tournament: t.id,
      name: t.name,
      format: t.format,
      bracket: t.bracket,
      system: t.system,
      startsAt,
    },
    at: now,
  });
  return (await db.tournaments.get(t.id)) ?? t;
}

/** An admin cancels an open or running event: no more rounds, no prizes. */
export async function cancelTournament(
  env: Env,
  db: Db,
  id: string,
  by: Player,
  now: number,
): Promise<Tournament> {
  const t = await db.tournaments.get(id);
  if (!t) throw new HttpError(404, 'not_found');
  const res = await tournamentStub(env, id).fetch('https://tournament/cancel', { method: 'POST' });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 409, 'closed');
  await db.audit.append({
    playerId: by.id,
    kind: 'admin.tournament_cancel',
    payload: { tournament: id, name: t.name },
    at: now,
  });
  return (await db.tournaments.get(id)) ?? t;
}

/** Recent events of every status for the admin console. */
export async function adminList(db: Db): Promise<Tournament[]> {
  const [open, running, done] = await Promise.all([
    db.tournaments.list(['open'], { limit: 50 }),
    db.tournaments.list(['running'], { limit: 50 }),
    db.tournaments.list(['finished', 'cancelled'], { limit: 20, order: 'desc' }),
  ]);
  return [...running, ...open, ...done];
}

const idOf = (params: Record<string, string>) => {
  const id = params.id ?? '';
  if (id.length === 0 || id.length > 64) throw new HttpError(404, 'not_found');
  return id;
};

/** Forward a TournamentRoom answer (its JSON and status). */
async function relay(res: Response): Promise<Response> {
  const data = (await res.json()) as unknown;
  return json(data, res.status);
}

export function tournamentRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/tournaments', async (_req, ctx) => {
    const me = await ctx.requireMe();
    await ensureScheduled(ctx.env, ctx.db, ctx.now);
    const [open, running, done] = await Promise.all([
      ctx.db.tournaments.list(['open'], { limit: 20 }),
      ctx.db.tournaments.list(['running'], { limit: 20 }),
      ctx.db.tournaments.list(['finished', 'cancelled'], { limit: 20, order: 'desc' }),
    ]);
    const mine = await ctx.db.tournaments.registeredIn(
      me.id,
      [...open, ...running, ...done].map((t) => t.id),
    );
    const answer: TournamentList = {
      bracket: bracketForLevel(me.level),
      upcoming: open.map((t) => summary(t, mine.has(t.id))),
      live: running.map((t) => summary(t, mine.has(t.id))),
      finished: done.map((t) => summary(t, mine.has(t.id))),
    };
    return json(answer);
  });

  r.add('GET', '/api/tournaments/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const id = idOf(params);
    if (!(await ctx.db.tournaments.get(id))) throw new HttpError(404, 'not_found');
    const q = new URLSearchParams({ player: me.id, bracket: bracketForLevel(me.level) });
    const res = await tournamentStub(ctx.env, id).fetch(`https://tournament/view?${q}`);
    if (!res.ok) throw new HttpError(404, 'not_found');
    return json((await res.json()) as TournamentView);
  });

  r.add('POST', '/api/tournaments/:id/register', async (_req, ctx, params) => {
    // Tournament play is online play: the trial or a subscription, never while suspended (14.4).
    const me = await requirePlay(ctx);
    const id = idOf(params);
    const t = await ctx.db.tournaments.get(id);
    if (!t) throw new HttpError(404, 'not_found');
    if (t.status !== 'open') throw new HttpError(409, 'closed');
    const bracket = bracketForLevel(me.level);
    if (bracket !== t.bracket) throw new HttpError(409, 'wrong_bracket');
    const res = await tournamentStub(ctx.env, id).fetch('https://tournament/register', {
      method: 'POST',
      body: JSON.stringify({
        player: { id: me.id, name: me.displayName, level: me.level },
        bracket,
      }),
    });
    return relay(res);
  });

  r.add('DELETE', '/api/tournaments/:id/register', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const id = idOf(params);
    if (!(await ctx.db.tournaments.get(id))) throw new HttpError(404, 'not_found');
    const res = await tournamentStub(ctx.env, id).fetch('https://tournament/unregister', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id, bracket: bracketForLevel(me.level) }),
    });
    return relay(res);
  });

  r.add('POST', '/api/tournaments/:id/ticket', async (_req, ctx, params) => {
    // Like a rejoin ticket, not gated by the subscription: the player registered while entitled.
    const me = await ctx.requireMe();
    const id = idOf(params);
    if (!(await ctx.db.tournaments.get(id))) throw new HttpError(404, 'not_found');
    const q = new URLSearchParams({ player: me.id });
    const res = await tournamentStub(ctx.env, id).fetch(`https://tournament/game?${q}`);
    if (!res.ok) throw new HttpError(404, 'no_game');
    const game = (await res.json()) as { battleId: string };
    return json(await battleTicket(ctx, me.id, game.battleId));
  });
}
