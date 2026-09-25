/**
 * 0006: report, mute and block, and the moderation state (M6 6.4; spec 15 R-SEC-011, R-SEC-006,
 * R-SEC-010).
 *
 * - `players.suspended_at` / `suspended_until` (NULL until: indefinitely) and `chat_ban_until`:
 *   checked wherever play or chat starts (sign-in, tickets, socket upgrades, the zone core).
 * - `reports`: one row per report; the reporter is NULL once that account is deleted (the report
 *   stays for the moderators), a report about a deleted account goes with it (R-SEC-010). The
 *   reason is a CHECK over the fixed list, and the moderators' queue reads `(status, created_at)`.
 * - `mutes` and `blocks`: one row per (player, target); the target index serves account deletion
 *   and "who blocked me" checks.
 * - An index on `audit_log (player_id, kind, at)` for the trade invitation limits and the
 *   moderators' view of a player's recent entries.
 */
import { sql } from 'kysely';
import type { Migration } from './types.ts';

export const m0006Moderation: Migration = {
  id: '0006_moderation',
  up({ schema, t }) {
    return [
      schema.alterTable('players').addColumn('suspended_at', t.ts).compile(),
      schema.alterTable('players').addColumn('suspended_until', t.ts).compile(),
      schema.alterTable('players').addColumn('chat_ban_until', t.ts).compile(),
      schema
        .createTable('reports')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('reporter_id', 'text', (c) => c.references('players.id'))
        .addColumn('target_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('reason', 'text', (c) => c.notNull())
        .addColumn('note', 'text')
        .addColumn('context_json', t.json)
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('resolved_at', t.ts)
        .addColumn('resolved_by', 'text', (c) => c.references('players.id'))
        .addColumn('resolution_note', 'text')
        .addCheckConstraint(
          'reports_reason_check',
          sql`reason IN ('harassment', 'hate', 'cheating', 'spam', 'inappropriate_name', 'other')`,
        )
        .addCheckConstraint(
          'reports_status_check',
          sql`status IN ('open', 'reviewed', 'dismissed')`,
        )
        .compile(),
      schema
        .createIndex('reports_status_idx')
        .ifNotExists()
        .on('reports')
        .columns(['status', 'created_at'])
        .compile(),
      schema
        .createIndex('reports_target_idx')
        .ifNotExists()
        .on('reports')
        .columns(['target_id', 'created_at'])
        .compile(),
      schema
        .createIndex('reports_reporter_idx')
        .ifNotExists()
        .on('reports')
        .columns(['reporter_id', 'created_at'])
        .compile(),
      schema
        .createIndex('reports_resolved_by_idx')
        .ifNotExists()
        .on('reports')
        .column('resolved_by')
        .compile(),
      schema
        .createTable('mutes')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('target_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('mutes_pk', ['player_id', 'target_id'])
        .addCheckConstraint('mutes_self_check', sql`player_id <> target_id`)
        .compile(),
      schema
        .createIndex('mutes_target_idx')
        .ifNotExists()
        .on('mutes')
        .column('target_id')
        .compile(),
      schema
        .createTable('blocks')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('target_id', 'text', (c) => c.notNull().references('players.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('blocks_pk', ['player_id', 'target_id'])
        .addCheckConstraint('blocks_self_check', sql`player_id <> target_id`)
        .compile(),
      schema
        .createIndex('blocks_target_idx')
        .ifNotExists()
        .on('blocks')
        .column('target_id')
        .compile(),
      schema
        .createIndex('audit_log_kind_idx')
        .ifNotExists()
        .on('audit_log')
        .columns(['player_id', 'kind', 'at'])
        .compile(),
      schema
        .createIndex('guild_invites_created_idx')
        .ifNotExists()
        .on('guild_invites')
        .column('created_at')
        .compile(),
    ];
  },
};
