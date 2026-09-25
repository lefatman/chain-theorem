/**
 * 0003: item wager escrow for M6 (spec 9.5 R-FMT-006, R-SEC-004).
 *
 * `wager_escrows` holds the stakes the server took from both players when a wager battle starts.
 * The row is written before the BattleRoom exists (so the stakes are gone from both inventories
 * before the first move), which is why it has no foreign key to `battles`; the settled wager is also
 * recorded in the `wagers` table of 0001 once the battle row exists. Settlement raises `releases`
 * by one inside the settling atomic list: CHECK (releases <= 1) makes a second settlement (a retry,
 * a replay, a race) abort the whole list on every engine, D1 batches included (DD-15), so the
 * stakes are paid out exactly once.
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0003Economy: Migration = {
  id: '0003_economy',
  up({ schema, t }) {
    return [
      schema
        .createTable('wager_escrows')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('battle_id', 'text', (c) => c.notNull())
        .addColumn('format', 'text', (c) => c.notNull())
        // The inviter (a) and the invitee (b); NULL after that account was deleted (R-SEC-010).
        .addColumn('a_id', 'text', (c) => c.references('players.id'))
        .addColumn('b_id', 'text', (c) => c.references('players.id'))
        .addColumn('a_stake_json', t.json, (c) => c.notNull())
        .addColumn('b_stake_json', t.json, (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('releases', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('outcome', 'text')
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('settled_at', t.ts)
        .addUniqueConstraint('wager_escrows_battle_uq', ['battle_id'])
        .addCheckConstraint(
          'wager_escrows_status_check',
          sql`status IN ('escrowed', 'settled', 'returned')`,
        )
        .addCheckConstraint('wager_escrows_releases_check', sql`releases >= 0 AND releases <= 1`)
        .addCheckConstraint(
          'wager_escrows_outcome_check',
          sql`outcome IS NULL OR outcome IN ('a', 'b', 'draw', 'aborted')`,
        )
        .compile(),
      schema
        .createIndex('wager_escrows_a_idx')
        .ifNotExists()
        .on('wager_escrows')
        .column('a_id')
        .compile(),
      schema
        .createIndex('wager_escrows_b_idx')
        .ifNotExists()
        .on('wager_escrows')
        .column('b_id')
        .compile(),
    ];
  },
};
