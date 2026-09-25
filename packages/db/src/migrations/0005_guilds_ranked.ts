/**
 * 0005: guilds and ranked play for M6 (spec 9.3 R-FMT-004, 10.4 R-WORLD-004, 15 R-SEC-008).
 *
 * Guilds: a case-insensitive name key (unique), the member count with the cap as a CHECK so every
 * join is race-safe inside its atomic list (DD-15), a roster version (every membership change bumps
 * it first, which also serializes changes of one guild on PostgreSQL and tells the GuildRoom cache it
 * is stale), one guild per player and one leader per guild as unique indexes, and invitations.
 * `guilds.owner_id` stays the founder (nulled when that account is deleted, R-SEC-010); the leader is
 * the member whose rank is `leader`.
 *
 * Ranked: one `rated_games` row per rated battle (its primary key makes a battle rated once), with
 * the pair stored sorted so the per-day same-opponent cap is one index range (R-SEC-008), and a
 * leaderboard index on ratings.
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0005GuildsRanked: Migration = {
  id: '0005_guilds_ranked',
  up({ schema, t }) {
    return [
      schema.alterTable('guilds').addColumn('name_key', 'text').compile(),
      schema
        .createIndex('guilds_name_key_uq')
        .ifNotExists()
        .unique()
        .on('guilds')
        .column('name_key')
        .compile(),
      schema
        .alterTable('guilds')
        .addColumn('max_size', 'integer', (c) => c.notNull().defaultTo(50))
        .compile(),
      schema
        .alterTable('guilds')
        .addColumn('size', 'integer', (c) =>
          c
            .notNull()
            .defaultTo(0)
            .check(sql`size >= 0 AND size <= max_size`),
        )
        .compile(),
      schema
        .alterTable('guilds')
        .addColumn('roster_version', 'integer', (c) => c.notNull().defaultTo(0))
        .compile(),
      schema
        .createIndex('guild_members_player_uq')
        .ifNotExists()
        .unique()
        .on('guild_members')
        .column('player_id')
        .compile(),
      schema
        .createIndex('guild_members_leader_uq')
        .ifNotExists()
        .unique()
        .on('guild_members')
        .column('guild_id')
        .where(sql.ref('rank'), '=', sql.lit('leader'))
        .compile(),
      schema
        .createTable('guild_invites')
        .ifNotExists()
        .addColumn('guild_id', 'text', (c) => c.notNull().references('guilds.id'))
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('invited_by', 'text', (c) => c.references('players.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('guild_invites_pk', ['guild_id', 'player_id'])
        .compile(),
      schema
        .createIndex('guild_invites_player_idx')
        .ifNotExists()
        .on('guild_invites')
        .column('player_id')
        .compile(),
      schema
        .createIndex('guild_invites_by_idx')
        .ifNotExists()
        .on('guild_invites')
        .column('invited_by')
        .compile(),
      schema
        .createTable('rated_games')
        .ifNotExists()
        .addColumn('battle_id', 'text', (c) => c.primaryKey().references('battles.id'))
        .addColumn('format', 'text', (c) => c.notNull())
        .addColumn('bracket', 'text', (c) => c.notNull())
        // The two players with a_id < b_id (NULL once that account is deleted, R-SEC-010).
        .addColumn('a_id', 'text', (c) => c.references('players.id'))
        .addColumn('b_id', 'text', (c) => c.references('players.id'))
        // a's score: 1 win, 0.5 draw, 0 loss.
        .addColumn('score_a', t.real, (c) => c.notNull())
        // 0 when the same-opponent cap held the ratings still (R-SEC-008).
        .addColumn('rated', 'integer', (c) => c.notNull())
        .addColumn('a_delta', t.real, (c) => c.notNull())
        .addColumn('b_delta', t.real, (c) => c.notNull())
        .addColumn('at', t.ts, (c) => c.notNull())
        .addCheckConstraint('rated_games_score_check', sql`score_a IN (0, 0.5, 1)`)
        .addCheckConstraint('rated_games_rated_check', sql`rated IN (0, 1)`)
        .compile(),
      schema
        .createIndex('rated_games_pair_idx')
        .ifNotExists()
        .on('rated_games')
        .columns(['a_id', 'b_id', 'at'])
        .compile(),
      schema
        .createIndex('rated_games_b_idx')
        .ifNotExists()
        .on('rated_games')
        .column('b_id')
        .compile(),
      schema
        .createIndex('ratings_board_idx')
        .ifNotExists()
        .on('ratings')
        .columns(['format', 'bracket', 'rating'])
        .compile(),
    ];
  },
};
