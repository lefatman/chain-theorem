/**
 * Tournaments (M7 7.1; spec 10.4 R-WORLD-004): the listing and history rows of events whose live
 * state a TournamentRoom holds. The room is the only writer of an event's registrations, so these
 * statements mirror its decisions; the database still enforces the invariants on its own (one entry
 * per player, the field size by CHECK, one scheduled event per schedule key by UNIQUE), atomically
 * with the registered count (DD-15).
 */
import { sql, type CompiledQuery, type Kysely, type Selectable, type Updateable } from 'kysely';
import { DbConstraintError, mapDbError } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import type { Schema, TournamentsTable } from '../schema.ts';

export const TOURNAMENT_STATUSES = ['open', 'running', 'finished', 'cancelled'] as const;
export type TournamentStatusName = (typeof TOURNAMENT_STATUSES)[number];

export interface Tournament {
  id: string;
  name: string;
  format: string;
  bracket: string;
  system: 'swiss' | 'se';
  status: TournamentStatusName;
  startsAt: number;
  maxPlayers: number;
  players: number;
  rounds: number;
  round: number;
  createdBy: string | null;
  scheduleKey: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
  /** The winner's display name (joined), or null. */
  winnerName: string | null;
}

export interface NewTournament {
  id?: string;
  name: string;
  format: string;
  bracket: string;
  system: 'swiss' | 'se';
  startsAt: number;
  maxPlayers: number;
  createdBy?: string | null;
  scheduleKey?: string | null;
  now?: number;
}

export interface TournamentPatch {
  status?: TournamentStatusName;
  players?: number;
  rounds?: number;
  round?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  winnerId?: string | null;
}

export interface TournamentEntry {
  tournamentId: string;
  playerId: string;
  registeredAt: number;
  place: number | null;
  points: number | null;
}

export type AddEntryResult = 'added' | 'exists' | 'full' | 'no_player' | 'no_tournament';

type Row = Selectable<TournamentsTable> & { winner_name: string | null };

function toTournament(r: Row): Tournament {
  return {
    id: r.id,
    name: r.name,
    format: r.format,
    bracket: r.bracket,
    system: r.system === 'se' ? 'se' : 'swiss',
    status: (TOURNAMENT_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as TournamentStatusName)
      : 'cancelled',
    startsAt: r.starts_at,
    maxPlayers: r.max_players,
    players: r.players,
    rounds: r.rounds,
    round: r.round,
    createdBy: r.created_by,
    scheduleKey: r.schedule_key,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    winnerId: r.winner_id,
    winnerName: r.winner_name,
  };
}

/** `players` := the number of entries of the tournament (keeps the count exact after any change). */
function recount(k: Kysely<Schema>, tournamentId: string): CompiledQuery {
  return k
    .updateTable('tournaments')
    .set({
      players: sql<number>`(SELECT COUNT(*) FROM tournament_entries WHERE tournament_id = ${tournamentId})`,
    })
    .where('id', '=', tournamentId)
    .compile();
}

/**
 * Account deletion (R-SEC-010): the player's entries go; an open event's count is recomputed without
 * them (a running or finished event keeps its field size); the winner and creator references clear.
 * The recount runs before the delete (it needs the entries to find the events).
 */
export function tournamentRemovalStatements(k: Kysely<Schema>, playerId: string): CompiledQuery[] {
  return [
    k
      .updateTable('tournaments')
      .set({
        players: sql<number>`(SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = tournaments.id AND e.player_id <> ${playerId})`,
      })
      .where('status', '=', 'open')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('tournament_entries')
          .select('tournament_id')
          .where('player_id', '=', playerId),
      )
      .compile(),
    k.deleteFrom('tournament_entries').where('player_id', '=', playerId).compile(),
    k
      .updateTable('tournaments')
      .set({ winner_id: null })
      .where('winner_id', '=', playerId)
      .compile(),
    k
      .updateTable('tournaments')
      .set({ created_by: null })
      .where('created_by', '=', playerId)
      .compile(),
  ];
}

export function tournamentRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  const select = () =>
    k
      .selectFrom('tournaments')
      .leftJoin('players', 'players.id', 'tournaments.winner_id')
      .selectAll('tournaments')
      .select('players.display_name as winner_name');

  async function get(id: string): Promise<Tournament | null> {
    const r = await select().where('tournaments.id', '=', id).executeTakeFirst();
    return r ? toTournament(r) : null;
  }

  function values(input: NewTournament) {
    if (!Number.isSafeInteger(input.startsAt)) throw new RangeError('startsAt must be epoch ms');
    if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 2)
      throw new RangeError('maxPlayers must be at least 2');
    const now = input.now ?? ctx.now();
    return {
      id: input.id ?? uuidv7(now),
      name: input.name.trim().slice(0, 60),
      format: input.format,
      bracket: input.bracket,
      system: input.system,
      status: 'open',
      starts_at: input.startsAt,
      max_players: input.maxPlayers,
      players: 0,
      rounds: 0,
      round: 0,
      created_by: input.createdBy ?? null,
      schedule_key: input.scheduleKey ?? null,
      created_at: now,
      started_at: null,
      finished_at: null,
      winner_id: null,
    };
  }

  return {
    /** A new open event. A taken schedule key or a bad value rejects with `DbConstraintError`. */
    async create(input: NewTournament): Promise<Tournament> {
      const row = values(input);
      try {
        await k.insertInto('tournaments').values(row).execute();
      } catch (err) {
        throw mapDbError(err);
      }
      const t = await get(row.id);
      if (!t) throw new Error('tournament vanished after insert');
      return t;
    },

    /**
     * A scheduled event, once per schedule key: `created` is false when another request created it
     * first (the UNIQUE key decides the race); the existing row is returned then.
     */
    async createScheduled(
      input: NewTournament & { scheduleKey: string },
    ): Promise<{ created: boolean; tournament: Tournament }> {
      const row = values(input);
      const r = await k
        .insertInto('tournaments')
        .values(row)
        .onConflict((oc) => oc.column('schedule_key').doNothing())
        .executeTakeFirst();
      const created = rows(r.numInsertedOrUpdatedRows) === 1;
      const t = await select()
        .where('tournaments.schedule_key', '=', input.scheduleKey)
        .executeTakeFirst();
      if (!t) throw new Error('scheduled tournament vanished');
      return { created, tournament: toTournament(t) };
    },

    get,

    /** Events with these schedule keys. */
    async byScheduleKeys(keys: readonly string[]): Promise<Tournament[]> {
      if (keys.length === 0) return [];
      const list = await select()
        .where('tournaments.schedule_key', 'in', [...keys])
        .execute();
      return list.map(toTournament);
    },

    /**
     * Events in `statuses`: by start time, soonest first (`asc`) or latest first (`desc`, history).
     */
    async list(
      statuses: readonly TournamentStatusName[],
      opts: { limit?: number; order?: 'asc' | 'desc' } = {},
    ): Promise<Tournament[]> {
      if (statuses.length === 0) return [];
      const order = opts.order ?? 'asc';
      const list = await select()
        .where('tournaments.status', 'in', [...statuses])
        .orderBy('tournaments.starts_at', order)
        .orderBy('tournaments.id', order)
        .limit(Math.max(1, Math.min(200, Math.floor(opts.limit ?? 20))))
        .execute();
      return list.map(toTournament);
    },

    /** Delete an event nobody registered for (a creation whose room failed). */
    async removeEmpty(id: string): Promise<boolean> {
      const r = await k
        .deleteFrom('tournaments')
        .where('id', '=', id)
        .where('players', '=', 0)
        .where('status', '=', 'open')
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('tournament_entries')
                .select('player_id')
                .where('tournament_id', '=', id),
            ),
          ),
        )
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },

    /** Mirror the room's summary (status, rounds, round, times, winner). */
    async update(id: string, patch: TournamentPatch): Promise<boolean> {
      const set: Updateable<TournamentsTable> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.rounds !== undefined) set.rounds = patch.rounds;
      if (patch.round !== undefined) set.round = patch.round;
      if (patch.startedAt !== undefined) set.started_at = patch.startedAt;
      if (patch.finishedAt !== undefined) set.finished_at = patch.finishedAt;
      if (patch.winnerId !== undefined) set.winner_id = patch.winnerId;
      if (Object.keys(set).length === 0) return true;
      try {
        const r = await k
          .updateTable('tournaments')
          .set(set)
          .where('id', '=', id)
          .executeTakeFirst();
        return rows(r.numUpdatedRows) === 1;
      } catch (err) {
        throw mapDbError(err);
      }
    },

    /**
     * Register: the entry and the recount in one atomic list. The primary key refuses a second entry
     * (`exists`), the CHECK on the count refuses one past the field size (`full`), the foreign keys
     * an unknown player or event.
     */
    async addEntry(tournamentId: string, playerId: string, at: number): Promise<AddEntryResult> {
      try {
        await ctx.atomic([
          k
            .insertInto('tournament_entries')
            .values({
              tournament_id: tournamentId,
              player_id: playerId,
              registered_at: at,
              place: null,
              points: null,
            })
            .compile(),
          recount(k, tournamentId),
        ]);
        return 'added';
      } catch (err) {
        const e = err instanceof DbConstraintError ? err : mapDbError(err);
        if (e instanceof DbConstraintError) {
          if (e.kind === 'unique') return 'exists';
          if (e.kind === 'check') return 'full';
          if (e.kind === 'foreign_key') {
            const t = await k
              .selectFrom('tournaments')
              .select('id')
              .where('id', '=', tournamentId)
              .executeTakeFirst();
            return t ? 'no_player' : 'no_tournament';
          }
        }
        throw e;
      }
    },

    /** Unregister (before the start): the entry and the recount in one atomic list. */
    async removeEntry(tournamentId: string, playerId: string): Promise<boolean> {
      const counts = await ctx.atomic([
        k
          .deleteFrom('tournament_entries')
          .where('tournament_id', '=', tournamentId)
          .where('player_id', '=', playerId)
          .compile(),
        recount(k, tournamentId),
      ]);
      return counts[0] === 1;
    },

    /** Entries of an event, in registration order. */
    async entries(tournamentId: string): Promise<TournamentEntry[]> {
      const list = await k
        .selectFrom('tournament_entries')
        .selectAll()
        .where('tournament_id', '=', tournamentId)
        .orderBy('registered_at')
        .orderBy('player_id')
        .execute();
      return list.map((e) => ({
        tournamentId: e.tournament_id,
        playerId: e.player_id,
        registeredAt: e.registered_at,
        place: e.place,
        points: e.points === null ? null : Number(e.points),
      }));
    },

    /**
     * The end of an event, in one atomic list: the summary row and every entry's place and points
     * (idempotent: writing the same end twice changes nothing).
     */
    async finish(
      id: string,
      end: {
        status: 'finished' | 'cancelled';
        finishedAt: number;
        winnerId: string | null;
        places: readonly { playerId: string; place: number; points: number }[];
      },
    ): Promise<void> {
      await ctx.atomic([
        k
          .updateTable('tournaments')
          .set({ status: end.status, finished_at: end.finishedAt, winner_id: end.winnerId })
          .where('id', '=', id)
          .compile(),
        ...end.places.map((p) =>
          k
            .updateTable('tournament_entries')
            .set({ place: p.place, points: p.points })
            .where('tournament_id', '=', id)
            .where('player_id', '=', p.playerId)
            .compile(),
        ),
      ]);
    },

    /** Of `ids`, the events `playerId` is registered in. */
    async registeredIn(playerId: string, ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const list = await k
        .selectFrom('tournament_entries')
        .select('tournament_id')
        .where('player_id', '=', playerId)
        .where('tournament_id', 'in', [...ids])
        .execute();
      return new Set(list.map((r) => r.tournament_id));
    },

    /** Every event the player is registered in (their TournamentRooms forget them on deletion). */
    async idsForPlayer(playerId: string): Promise<string[]> {
      const list = await k
        .selectFrom('tournament_entries')
        .select('tournament_id')
        .where('player_id', '=', playerId)
        .orderBy('tournament_id')
        .execute();
      return list.map((r) => r.tournament_id);
    },
  };
}

export type TournamentRepo = ReturnType<typeof tournamentRepo>;
