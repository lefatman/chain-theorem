/**
 * 0004: subscription billing (M6 6.3; spec 14.3, 14.4; R-SEC-007).
 *
 * - `billing_events`: every verified provider webhook, once. UNIQUE (provider, event_id) makes the
 *   webhook idempotent: a retried or replayed delivery violates it and changes nothing.
 * - `billing_accounts`: the provider's customer and subscription ids, the plan and a scheduled cancel
 *   for each player who ever subscribed. Kept out of `players` so the players table stays the minimum
 *   personal data (R-SEC-010).
 * - `players.sub_event_at`: the provider time of the event that last set `sub_status` and
 *   `sub_expires_at`. Webhooks can arrive out of order; an update applies only when its event is not
 *   older than this (a conditional update on the same row, so it is race-safe on every engine).
 * - Backfill: accounts made before M6 get `trial_ends_at = created_at + 7 days`, the rule the server
 *   already applied to them (14.4: the 7-day trial is COMMITTED).
 */
import { CompiledQuery } from 'kysely';
import type { Migration } from './types.ts';

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

export const m0004Billing: Migration = {
  id: '0004_billing',
  up({ schema, t }) {
    return [
      schema
        .createTable('billing_accounts')
        .ifNotExists()
        .addColumn('player_id', 'text', (c) => c.primaryKey().references('players.id'))
        .addColumn('provider', 'text', (c) => c.notNull())
        .addColumn('customer_id', 'text')
        .addColumn('subscription_id', 'text')
        .addColumn('plan', 'text')
        .addColumn('cancel_at', t.ts)
        .addColumn('state_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .compile(),
      schema
        .createIndex('billing_accounts_subscription_idx')
        .ifNotExists()
        .on('billing_accounts')
        .columns(['provider', 'subscription_id'])
        .compile(),
      schema
        .createIndex('billing_accounts_customer_idx')
        .ifNotExists()
        .on('billing_accounts')
        .columns(['provider', 'customer_id'])
        .compile(),
      schema
        .createTable('billing_events')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('provider', 'text', (c) => c.notNull())
        .addColumn('event_id', 'text', (c) => c.notNull())
        .addColumn('event_type', 'text', (c) => c.notNull())
        // Null when the event names no player we know (recorded, then ignored).
        .addColumn('player_id', 'text', (c) => c.references('players.id'))
        .addColumn('occurred_at', t.ts, (c) => c.notNull())
        .addColumn('received_at', t.ts, (c) => c.notNull())
        .addColumn('payload_json', t.json, (c) => c.notNull())
        .addUniqueConstraint('billing_events_event_key', ['provider', 'event_id'])
        .compile(),
      schema
        .createIndex('billing_events_player_idx')
        .ifNotExists()
        .on('billing_events')
        .column('player_id')
        .compile(),
      schema.alterTable('players').addColumn('sub_event_at', t.ts).compile(),
      CompiledQuery.raw(
        `UPDATE players SET trial_ends_at = created_at + ${TRIAL_MS} WHERE trial_ends_at IS NULL`,
      ),
    ];
  },
};
