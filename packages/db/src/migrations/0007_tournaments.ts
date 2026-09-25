/**
 * 0007: tournaments (M7 7.1; spec 10.4 R-WORLD-004, 12.2 TournamentRoom, R-SEC-010).
 *
 * The TournamentRoom holds the live state (pairings, results); these rows are the listing and the
 * history:
 * - `tournaments`: one row per event: format, slot bracket, system (CHECK swiss|se), status (CHECK),
 *   the start, the field size and the registered count (CHECK 0 <= players <= max_players, so a
 *   registration past the cap aborts its atomic list), rounds, the winner. `schedule_key` is UNIQUE
 *   (NULL for admin events), so a scheduled event is created once however many requests race.
 * - `tournament_entries`: one row per (tournament, player): registration time, then the final place
 *   and points. Deleted with the account (R-SEC-010).
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0007Tournaments: Migration = {
  id: '0007_tournaments',
  up({ schema, t }) {
    return [
      schema
        .createTable('tournaments')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('format', 'text', (c) => c.notNull())
        .addColumn('bracket', 'text', (c) => c.notNull())
        .addColumn('system', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open'))
        .addColumn('starts_at', t.ts, (c) => c.notNull())
        .addColumn('max_players', 'integer', (c) => c.notNull())
        .addColumn('players', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('rounds', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('round', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_by', 'text', (c) => c.references('players.id'))
        .addColumn('schedule_key', 'text')
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('started_at', t.ts)
        .addColumn('finished_at', t.ts)
        .addColumn('winner_id', 'text', (c) => c.references('players.id'))
        .addCheckConstraint('tournaments_system_check', sql`system IN ('swiss', 'se')`)
        .addCheckConstraint(
          'tournaments_status_check',
          sql`status IN ('open', 'running', 'finished', 'cancelled')`,
        )
        .addCheckConstraint(
          'tournaments_players_check',
          sql`players >= 0 AND players <= max_players AND max_players >= 2`,
        )
        .compile(),
      schema
        .createIndex('tournaments_schedule_key_idx')
        .ifNotExists()
        .unique()
        .on('tournaments')
        .column('schedule_key')
        .compile(),
      schema
        .createIndex('tournaments_status_idx')
        .ifNotExists()
        .on('tournaments')
        .columns(['status', 'starts_at'])
        .compile(),
      schema
        .createIndex('tournaments_winner_idx')
        .ifNotExists()
        .on('tournaments')
        .column('winner_id')
        .compile(),
      schema
        .createIndex('tournaments_created_by_idx')
        .ifNotExists()
        .on('tournaments')
        .column('created_by')
        .compile(),
      schema
        .createTable('tournament_entries')
        .ifNotExists()
        .addColumn('tournament_id', 'text', (c) => c.notNull().references('tournaments.id'))
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('registered_at', t.ts, (c) => c.notNull())
        .addColumn('place', 'integer')
        .addColumn('points', t.real)
        .addPrimaryKeyConstraint('tournament_entries_pk', ['tournament_id', 'player_id'])
        .compile(),
      schema
        .createIndex('tournament_entries_player_idx')
        .ifNotExists()
        .on('tournament_entries')
        .column('player_id')
        .compile(),
    ];
  },
};
