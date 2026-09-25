/**
 * Ratings per player, format and bracket (spec 13.3). Rated battles update them through the ranked
 * repository (`ranked.ts`, M6 6.2), one atomic list per battle.
 */
import type { Selectable } from 'kysely';
import type { RepoContext } from '../db-types.ts';
import type { RatingsTable } from '../schema.ts';

export interface Rating {
  playerId: string;
  format: string;
  bracket: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  updatedAt: number;
}

export type RatingInput = Omit<Rating, 'updatedAt'> & { updatedAt?: number };

export function toRating(row: Selectable<RatingsTable>): Rating {
  return {
    playerId: row.player_id,
    format: row.format,
    bracket: row.bracket,
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    games: row.games,
    updatedAt: row.updated_at,
  };
}

export function ratingRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  return {
    async get(playerId: string, format: string, bracket: string): Promise<Rating | null> {
      const row = await k
        .selectFrom('ratings')
        .selectAll()
        .where('player_id', '=', playerId)
        .where('format', '=', format)
        .where('bracket', '=', bracket)
        .executeTakeFirst();
      return row ? toRating(row) : null;
    },

    async listForPlayer(playerId: string): Promise<Rating[]> {
      const list = await k
        .selectFrom('ratings')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('format')
        .orderBy('bracket')
        .execute();
      return list.map(toRating);
    },

    /** Inserts or replaces the rating row for (player, format, bracket). */
    async upsert(input: RatingInput): Promise<Rating> {
      const row = {
        player_id: input.playerId,
        format: input.format,
        bracket: input.bracket,
        rating: input.rating,
        rd: input.rd,
        volatility: input.volatility,
        games: input.games,
        updated_at: input.updatedAt ?? ctx.now(),
      };
      await k
        .insertInto('ratings')
        .values(row)
        .onConflict((oc) =>
          oc.columns(['player_id', 'format', 'bracket']).doUpdateSet((eb) => ({
            rating: eb.ref('excluded.rating'),
            rd: eb.ref('excluded.rd'),
            volatility: eb.ref('excluded.volatility'),
            games: eb.ref('excluded.games'),
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
      return toRating(row);
    },
  };
}

export type RatingRepo = ReturnType<typeof ratingRepo>;
