/**
 * 0001: every table of spec 13.3 plus login_tokens, oauth_accounts and reward_grants (R-DATA-003).
 * Dialect branches are for column types only (spec 13.6): `ts` is BIGINT on PostgreSQL and INTEGER
 * on SQLite, `json` is JSONB or TEXT, `real` is DOUBLE PRECISION or REAL.
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0001Initial: Migration = {
  id: '0001_initial',
  up({ schema, t }) {
    return [
      schema
        .createTable('players')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('email', 'text', (c) => c.notNull())
        .addColumn('display_name', 'text', (c) => c.notNull())
        .addColumn('level', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('xp', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('zone_id', 'text')
        .addColumn('tile_x', 'integer')
        .addColumn('tile_y', 'integer')
        .addColumn('sub_status', 'text', (c) => c.notNull().defaultTo('none'))
        .addColumn('sub_expires_at', t.ts)
        .addColumn('trial_ends_at', t.ts)
        .addColumn('adult_from', t.ts, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('players_email_uq', ['email'])
        .addCheckConstraint('players_level_check', sql`level >= 1`)
        .addCheckConstraint('players_xp_check', sql`xp >= 0`)
        .compile(),

      schema
        .createTable('sessions')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('token_hash', 'text', (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('expires_at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('sessions_token_hash_uq', ['token_hash'])
        .compile(),
      schema
        .createIndex('sessions_player_idx')
        .ifNotExists()
        .on('sessions')
        .column('player_id')
        .compile(),
      schema
        .createIndex('sessions_expires_idx')
        .ifNotExists()
        .on('sessions')
        .column('expires_at')
        .compile(),

      schema
        .createTable('login_tokens')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('token_hash', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull())
        .addColumn('purpose', 'text', (c) => c.notNull())
        .addColumn('data_json', t.json)
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('expires_at', t.ts, (c) => c.notNull())
        .addColumn('used_at', t.ts)
        .addUniqueConstraint('login_tokens_token_hash_uq', ['token_hash'])
        .compile(),
      schema
        .createIndex('login_tokens_email_idx')
        .ifNotExists()
        .on('login_tokens')
        .columns(['email', 'created_at'])
        .compile(),
      schema
        .createIndex('login_tokens_expires_idx')
        .ifNotExists()
        .on('login_tokens')
        .column('expires_at')
        .compile(),

      schema
        .createTable('oauth_accounts')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('provider', 'text', (c) => c.notNull())
        .addColumn('provider_user_id', 'text', (c) => c.notNull())
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('oauth_accounts_identity_uq', ['provider', 'provider_user_id'])
        .compile(),
      schema
        .createIndex('oauth_accounts_player_idx')
        .ifNotExists()
        .on('oauth_accounts')
        .column('player_id')
        .compile(),

      schema
        .createTable('inventory_items')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('item_id', 'text', (c) => c.notNull())
        .addColumn('qty', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('inventory_items_pk', ['player_id', 'item_id'])
        .addCheckConstraint('inventory_items_qty_check', sql`qty >= 0`)
        .compile(),

      schema
        .createTable('inventory_cards')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('ability_id', 'text', (c) => c.notNull())
        .addColumn('qty', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('inventory_cards_pk', ['player_id', 'ability_id'])
        .addCheckConstraint('inventory_cards_qty_check', sql`qty >= 0`)
        .compile(),

      schema
        .createTable('loadouts')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('loadout_json', t.json, (c) => c.notNull())
        .addColumn('is_valid', 'integer', (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addCheckConstraint('loadouts_is_valid_check', sql`is_valid IN (0, 1)`)
        .compile(),
      schema
        .createIndex('loadouts_player_idx')
        .ifNotExists()
        .on('loadouts')
        .column('player_id')
        .compile(),

      schema
        .createTable('ratings')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('format', 'text', (c) => c.notNull())
        .addColumn('bracket', 'text', (c) => c.notNull())
        .addColumn('rating', t.real, (c) => c.notNull())
        .addColumn('rd', t.real, (c) => c.notNull())
        .addColumn('volatility', t.real, (c) => c.notNull())
        .addColumn('games', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('ratings_pk', ['player_id', 'format', 'bracket'])
        .addCheckConstraint('ratings_games_check', sql`games >= 0`)
        .compile(),

      schema
        .createTable('battles')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('format', 'text', (c) => c.notNull())
        .addColumn('white_id', 'text', (c) => c.references('players.id'))
        .addColumn('black_id', 'text', (c) => c.references('players.id'))
        .addColumn('result', 'text')
        .addColumn('reason', 'text')
        .addColumn('started_at', t.ts, (c) => c.notNull())
        .addColumn('ended_at', t.ts)
        .addColumn('log_key', 'text')
        .addCheckConstraint(
          'battles_result_check',
          sql`result IS NULL OR result IN ('white', 'black', 'draw', 'aborted')`,
        )
        .compile(),
      schema
        .createIndex('battles_white_idx')
        .ifNotExists()
        .on('battles')
        .columns(['white_id', 'started_at'])
        .compile(),
      schema
        .createIndex('battles_black_idx')
        .ifNotExists()
        .on('battles')
        .columns(['black_id', 'started_at'])
        .compile(),

      schema
        .createTable('wagers')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('battle_id', 'text', (c) => c.notNull().references('battles.id'))
        .addColumn('white_stake_json', t.json, (c) => c.notNull())
        .addColumn('black_stake_json', t.json, (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('settled_at', t.ts)
        .addUniqueConstraint('wagers_battle_uq', ['battle_id'])
        .compile(),

      schema
        .createTable('guilds')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('tag', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text', (c) => c.references('players.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('guilds_name_uq', ['name'])
        .addUniqueConstraint('guilds_tag_uq', ['tag'])
        .compile(),

      schema
        .createTable('guild_members')
        .ifNotExists()
        .addColumn('guild_id', 'text', (c) => c.notNull().references('guilds.id'))
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('rank', 'text', (c) => c.notNull())
        .addColumn('joined_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('guild_members_pk', ['guild_id', 'player_id'])
        .compile(),
      schema
        .createIndex('guild_members_player_idx')
        .ifNotExists()
        .on('guild_members')
        .column('player_id')
        .compile(),

      schema
        .createTable('trades')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('a_id', 'text', (c) => c.references('players.id'))
        .addColumn('b_id', 'text', (c) => c.references('players.id'))
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('offer_json', t.json, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('completed_at', t.ts)
        .compile(),
      schema.createIndex('trades_a_idx').ifNotExists().on('trades').column('a_id').compile(),
      schema.createIndex('trades_b_idx').ifNotExists().on('trades').column('b_id').compile(),

      schema
        .createTable('friends')
        .ifNotExists()
        .addColumn('a_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('b_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('friends_pk', ['a_id', 'b_id'])
        .compile(),
      schema.createIndex('friends_b_idx').ifNotExists().on('friends').column('b_id').compile(),

      schema
        .createTable('quest_progress')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('quest_id', 'text', (c) => c.notNull())
        .addColumn('step', 'integer', (c) => c.notNull())
        .addColumn('data_json', t.json, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('quest_progress_pk', ['player_id', 'quest_id'])
        .compile(),

      schema
        .createTable('audit_log')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('player_id', 'text', (c) => c.references('players.id'))
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('payload_json', t.json, (c) => c.notNull())
        .addColumn('at', t.ts, (c) => c.notNull())
        .compile(),
      schema
        .createIndex('audit_log_player_idx')
        .ifNotExists()
        .on('audit_log')
        .columns(['player_id', 'at'])
        .compile(),

      schema
        .createTable('reward_grants')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('grant_key', 'text', (c) => c.notNull())
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('payload_json', t.json, (c) => c.notNull())
        .addColumn('at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('reward_grants_key_uq', ['grant_key', 'player_id'])
        .compile(),
      schema
        .createIndex('reward_grants_player_idx')
        .ifNotExists()
        .on('reward_grants')
        .column('player_id')
        .compile(),
    ];
  },
};
