/**
 * 0002: overworld and social tables for M5 (spec 10): coins (soft currency, 10.5) in a wallet with
 * CHECK (coins >= 0), key items (10.2, never in item slots), progress flags (lessons done, once-only
 * trainers defeated), parties (10.4, at most four members, one party per player), and presence and
 * chat-filter columns on players (R-SEC-011). Positions keep using players.zone_id/tile_x/tile_y.
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0002World: Migration = {
  id: '0002_world',
  up({ schema, t }) {
    return [
      schema
        .createTable('wallets')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.primaryKey().references('players.id'))
        .addColumn('coins', 'integer', (c) => c.notNull().defaultTo(0))
        .addCheckConstraint('wallets_coins_check', sql`coins >= 0`)
        .compile(),
      schema
        .createTable('key_items')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('key_id', 'text', (c) => c.notNull())
        .addColumn('acquired_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('key_items_pk', ['player_id', 'key_id'])
        .compile(),
      schema
        .createTable('progress_flags')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('flag', 'text', (c) => c.notNull())
        .addColumn('at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('progress_flags_pk', ['player_id', 'flag'])
        .compile(),
      schema
        .createTable('parties')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('leader_id', 'text', (c) => c.notNull().references('players.id'))
        // Member count, raised in the same atomic list as each member insert: the CHECK makes the
        // four-member cap race-safe on every engine (DD-15).
        .addColumn('size', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addCheckConstraint('parties_size_check', sql`size >= 0 AND size <= 4`)
        .compile(),
      schema
        .createTable('party_members')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.primaryKey().references('players.id'))
        .addColumn('party_id', 'text', (c) => c.notNull().references('parties.id'))
        .addColumn('joined_at', t.ts, (c) => c.notNull())
        .compile(),
      schema
        .createIndex('party_members_party_idx')
        .ifNotExists()
        .on('party_members')
        .column('party_id')
        .compile(),
      schema.alterTable('players').addColumn('presence_zone', 'text').compile(),
      schema.alterTable('players').addColumn('presence_channel', 'integer').compile(),
      schema
        .alterTable('players')
        .addColumn('filter_chat', 'integer', (c) => c.notNull().defaultTo(0))
        .compile(),
    ];
  },
};
