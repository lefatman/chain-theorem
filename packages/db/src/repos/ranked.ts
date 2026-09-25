/**
 * Ranked play (spec 9.3 R-FMT-004, 10.4 R-WORLD-004, 15 R-SEC-008; M6 6.2): recording a rated battle
 * and both rating updates as one atomic list, the per-day same-opponent counter, and leaderboards.
 *
 * A battle is rated once: its `rated_games` row has the battle id as primary key, so a repeat aborts
 * the whole list and changes nothing. Rating updates are optimistic (DD-15, no SELECT ... FOR
 * UPDATE): the caller computes the new values from the rows it read, and the list checks that nobody
 * changed them meanwhile. A row that existed is updated unconditionally and then set to games = -1 if
 * its game count is not the one expected, which violates CHECK (games >= 0) and aborts the list; a
 * first rating is a plain insert that a concurrent first insert turns into a unique violation. Either
 * way the caller reads again and retries (`conflict`).
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { DbConstraintError } from '../errors.ts';
import type { RepoContext } from '../db-types.ts';
import type { JsonObject } from '../json.ts';
import type { RatedGamesTable } from '../schema.ts';
import { auditRepo } from './audit.ts';
import type { Rating } from './ratings.ts';

export interface RatedGame {
  battleId: string;
  format: string;
  bracket: string;
  /** The two players, aId < bId (null once that account is deleted). */
  aId: string | null;
  bId: string | null;
  scoreA: number;
  /** False when the same-opponent cap kept both ratings (R-SEC-008). */
  rated: boolean;
  aDelta: number;
  bDelta: number;
  at: number;
}

/** One side of a rated battle: the row read before (null: first game) and the values after. */
export interface RatedSide {
  playerId: string;
  /** The stored rating the update was computed from; null when the player had none. */
  before: Pick<Rating, 'games'> | null;
  after: { rating: number; rd: number; volatility: number };
  /** Rating change shown to the player (after minus before, 0 when unrated). */
  delta: number;
}

export interface RecordRatedInput {
  battleId: string;
  format: string;
  bracket: string;
  white: RatedSide;
  black: RatedSide;
  /** White's score: 1 win, 0.5 draw, 0 loss. */
  scoreWhite: 0 | 0.5 | 1;
  /** False: record the game but keep both ratings (the same-opponent cap, R-SEC-008). */
  rated: boolean;
  /** Audit entries written in the same list (a repeated pairing flag, R-SEC-008). */
  audit?: { playerId: string; kind: string; payload: JsonObject }[];
  at: number;
}

export type RecordRatedResult = 'recorded' | 'duplicate' | 'conflict';

export interface BoardRow {
  playerId: string;
  name: string;
  rating: number;
  rd: number;
  games: number;
  tag: string | null;
}

export interface BoardRules {
  maxRd: number;
  minGames: number;
}

export function toRatedGame(row: Selectable<RatedGamesTable>): RatedGame {
  return {
    battleId: row.battle_id,
    format: row.format,
    bracket: row.bracket,
    aId: row.a_id,
    bId: row.b_id,
    scoreA: Number(row.score_a),
    rated: row.rated === 1,
    aDelta: Number(row.a_delta),
    bDelta: Number(row.b_delta),
    at: row.at,
  };
}

/** The pair in stored order (a < b). */
export function sortedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function rankedRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  const audit = auditRepo(ctx);

  async function getGame(battleId: string): Promise<RatedGame | null> {
    const row = await k
      .selectFrom('rated_games')
      .selectAll()
      .where('battle_id', '=', battleId)
      .executeTakeFirst();
    return row ? toRatedGame(row) : null;
  }

  function sideStatements(
    format: string,
    bracket: string,
    side: RatedSide,
    at: number,
  ): CompiledQuery[] {
    if (side.before === null)
      return [
        k
          .insertInto('ratings')
          .values({
            player_id: side.playerId,
            format,
            bracket,
            rating: side.after.rating,
            rd: side.after.rd,
            volatility: side.after.volatility,
            games: 1,
            updated_at: at,
          })
          .compile(),
      ];
    const expected = side.before.games + 1;
    return [
      k
        .updateTable('ratings')
        .set((eb) => ({
          rating: side.after.rating,
          rd: side.after.rd,
          volatility: side.after.volatility,
          games: eb('games', '+', 1),
          updated_at: at,
        }))
        .where('player_id', '=', side.playerId)
        .where('format', '=', format)
        .where('bracket', '=', bracket)
        .compile(),
      // Optimistic check: a concurrent update moved `games` past the expected count. -1 violates
      // CHECK (games >= 0) and aborts the list, so the caller reads again and retries.
      k
        .updateTable('ratings')
        .set({ games: -1 })
        .where('player_id', '=', side.playerId)
        .where('format', '=', format)
        .where('bracket', '=', bracket)
        .where('games', '<>', expected)
        .compile(),
    ];
  }

  return {
    getGame,

    /**
     * Rated games between two players since `since` (epoch ms), in any format: `total` recorded and
     * `rated` that changed ratings (the R-SEC-008 per-day cap counts `rated`).
     */
    async pairGamesSince(
      x: string,
      y: string,
      since: number,
    ): Promise<{ total: number; rated: number }> {
      const [a, b] = sortedPair(x, y);
      const list = await k
        .selectFrom('rated_games')
        .select('rated')
        .where('a_id', '=', a)
        .where('b_id', '=', b)
        .where('at', '>', since)
        .execute();
      return { total: list.length, rated: list.filter((r) => r.rated === 1).length };
    },

    /**
     * Record a rated battle and both rating updates in one atomic list. `duplicate` when the battle
     * was rated already (nothing changed), `conflict` when a rating changed meanwhile (read again and
     * retry).
     */
    async record(input: RecordRatedInput): Promise<RecordRatedResult> {
      const w = input.white;
      const bl = input.black;
      if (w.playerId === bl.playerId)
        throw new RangeError('a player cannot be rated against itself');
      const whiteIsA = w.playerId < bl.playerId;
      const [a, b] = whiteIsA ? [w, bl] : [bl, w];
      const scoreA = whiteIsA ? input.scoreWhite : 1 - input.scoreWhite;
      const statements: CompiledQuery[] = [
        k
          .insertInto('rated_games')
          .values({
            battle_id: input.battleId,
            format: input.format,
            bracket: input.bracket,
            a_id: a.playerId,
            b_id: b.playerId,
            score_a: scoreA,
            rated: input.rated ? 1 : 0,
            a_delta: input.rated ? a.delta : 0,
            b_delta: input.rated ? b.delta : 0,
            at: input.at,
          })
          .compile(),
      ];
      if (input.rated)
        for (const side of [w, bl])
          statements.push(...sideStatements(input.format, input.bracket, side, input.at));
      for (const e of input.audit ?? [])
        statements.push(
          audit.appendStatement({
            playerId: e.playerId,
            kind: e.kind,
            payload: e.payload,
            at: input.at,
          }),
        );
      try {
        await ctx.atomic(statements);
        return 'recorded';
      } catch (err) {
        if (!(err instanceof DbConstraintError)) throw err;
        return (await getGame(input.battleId)) ? 'duplicate' : 'conflict';
      }
    },

    /** Rated games of a player, newest first (data export, R-SEC-010). */
    async gamesOf(playerId: string, limit = 1000): Promise<RatedGame[]> {
      const list = await k
        .selectFrom('rated_games')
        .selectAll()
        .where((eb) => eb.or([eb('a_id', '=', playerId), eb('b_id', '=', playerId)]))
        .orderBy('at', 'desc')
        .orderBy('battle_id')
        .limit(Math.max(1, Math.min(10_000, Math.floor(limit))))
        .execute();
      return list.map(toRatedGame);
    },

    /**
     * The leaderboard of one format and bracket (10.4): players with at least `minGames` rated games
     * and a deviation of at most `maxRd`, best first, with their guild tag.
     */
    async board(
      format: string,
      bracket: string,
      rules: BoardRules,
      limit: number,
    ): Promise<BoardRow[]> {
      const list = await k
        .selectFrom('ratings as r')
        .innerJoin('players as p', 'p.id', 'r.player_id')
        .leftJoin('guild_members as gm', 'gm.player_id', 'r.player_id')
        .leftJoin('guilds as g', 'g.id', 'gm.guild_id')
        .select(['r.player_id', 'p.display_name', 'r.rating', 'r.rd', 'r.games', 'g.tag'])
        .where('r.format', '=', format)
        .where('r.bracket', '=', bracket)
        .where('r.rd', '<=', rules.maxRd)
        .where('r.games', '>=', rules.minGames)
        .orderBy('r.rating', 'desc')
        .orderBy('r.player_id')
        .limit(Math.max(1, Math.min(500, Math.floor(limit))))
        .execute();
      return list.map((r) => ({
        playerId: r.player_id,
        name: r.display_name,
        rating: Number(r.rating),
        rd: Number(r.rd),
        games: r.games,
        tag: r.tag,
      }));
    },

    /**
     * A listed player's place on the board (1 = best; ties share the better place), or null when
     * the player is not listed (no rating there, too few games or too high a deviation).
     */
    async rankOf(
      playerId: string,
      format: string,
      bracket: string,
      rules: BoardRules,
    ): Promise<number | null> {
      const mine = await k
        .selectFrom('ratings')
        .select(['rating', 'rd', 'games'])
        .where('player_id', '=', playerId)
        .where('format', '=', format)
        .where('bracket', '=', bracket)
        .executeTakeFirst();
      if (!mine || mine.rd > rules.maxRd || mine.games < rules.minGames) return null;
      const above = await k
        .selectFrom('ratings')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('format', '=', format)
        .where('bracket', '=', bracket)
        .where('rd', '<=', rules.maxRd)
        .where('games', '>=', rules.minGames)
        .where('rating', '>', mine.rating)
        .executeTakeFirst();
      return Number(above?.n ?? 0) + 1;
    },
  };
}

export type RankedRepo = ReturnType<typeof rankedRepo>;
