/**
 * Subscription billing (M6 6.3; spec 14.3, 14.4; R-SEC-007). The server keeps entitlement in
 * `players.sub_status` / `sub_expires_at` / `trial_ends_at`; only verified provider webhooks change
 * the first two, through `record()`:
 *
 * - Idempotent: the `billing_events` row (UNIQUE (provider, event_id)) comes first in the atomic
 *   list, so a retried or replayed event aborts the list and reports `duplicate`.
 * - Out-of-order safe: the player's entitlement and the billing account change only when the event
 *   is not older than the last applied one (`players.sub_event_at`, `billing_accounts.state_at`).
 *   Both are conditions inside the write on the row being written, so they hold under concurrency on
 *   every engine and inside a D1 batch, which cannot branch (DD-15). An older event is still
 *   recorded (and audited) and reports `stale`.
 * - Atomic: the event row, the entitlement, the billing account and the audit entry are one list.
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { isUniqueViolation } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { JsonObject } from '../json.ts';
import type { BillingAccountsTable, BillingEventsTable } from '../schema.ts';
import { auditRepo } from './audit.ts';

export interface BillingAccount {
  playerId: string;
  provider: string;
  customerId: string | null;
  subscriptionId: string | null;
  plan: string | null;
  cancelAt: number | null;
  /** Provider time of the latest applied event. */
  stateAt: number;
  updatedAt: number;
}

export interface BillingEventRecord {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  playerId: string | null;
  occurredAt: number;
  receivedAt: number;
  payload: JsonObject;
}

/** The entitlement a provider event leaves the player with. */
export interface BillingState {
  /** 'none' | 'active' | 'past_due' | 'canceled' | 'paused'. */
  subStatus: string;
  /** End of the paid period (epoch ms), or null. */
  subExpiresAt: number | null;
  /** Provider ids and plan; `undefined` keeps the stored value. */
  customerId?: string | null;
  subscriptionId?: string | null;
  plan?: string | null;
  /** A scheduled cancellation (epoch ms) or null for none; `undefined` keeps the stored value. */
  cancelAt?: number | null;
}

export interface BillingEventInput {
  provider: string;
  /** The provider's event id (Paddle `event_id`): the idempotency key. */
  eventId: string;
  eventType: string;
  /** Provider time of the event (epoch ms): the ordering key. */
  occurredAt: number;
  /** The player the event is for, or null when it names no known player (recorded only). */
  playerId: string | null;
  /** The entitlement after this event; omitted for events that are only recorded. */
  state?: BillingState;
  receivedAt?: number;
}

/**
 * `applied`: the entitlement changed; `stale`: recorded, but a newer event had already applied;
 * `recorded`: recorded without a player or state; `duplicate`: seen before, nothing changed.
 */
export type BillingEventOutcome = 'applied' | 'stale' | 'recorded' | 'duplicate';

const MAX_ID = 200;

export function toBillingAccount(row: Selectable<BillingAccountsTable>): BillingAccount {
  return {
    playerId: row.player_id,
    provider: row.provider,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    plan: row.plan,
    cancelAt: row.cancel_at,
    stateAt: row.state_at,
    updatedAt: row.updated_at,
  };
}

export function toBillingEvent(
  ctx: Pick<RepoContext, 'json'>,
  row: Selectable<BillingEventsTable>,
): BillingEventRecord {
  return {
    id: row.id,
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type,
    playerId: row.player_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    payload: ctx.json.decode('billing_events.payload_json', JsonObject, row.payload_json),
  };
}

function checkId(name: string, v: string | null | undefined): void {
  if (typeof v === 'string' && (v.length === 0 || v.length > MAX_ID))
    throw new RangeError(`${name} must be 1..${MAX_ID} chars`);
}

export function billingRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  const audit = auditRepo(ctx);

  return {
    /**
     * Records one verified provider event and applies its entitlement when it is the newest seen
     * for the player (see the module comment). Safe to call again with the same event.
     */
    async record(input: BillingEventInput): Promise<BillingEventOutcome> {
      checkId('provider', input.provider);
      checkId('eventId', input.eventId);
      checkId('eventType', input.eventType);
      if (!Number.isSafeInteger(input.occurredAt)) throw new RangeError('occurredAt must be ms');
      const s = input.state;
      if (s) {
        checkId('customerId', s.customerId);
        checkId('subscriptionId', s.subscriptionId);
        checkId('plan', s.plan);
      }
      const at = input.receivedAt ?? ctx.now();
      const payload: JsonObject = {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        occurredAt: input.occurredAt,
        ...(s
          ? {
              subStatus: s.subStatus,
              subExpiresAt: s.subExpiresAt,
              ...(s.plan !== undefined ? { plan: s.plan } : {}),
              ...(s.subscriptionId !== undefined ? { subscriptionId: s.subscriptionId } : {}),
              ...(s.cancelAt !== undefined ? { cancelAt: s.cancelAt } : {}),
            }
          : {}),
      };
      const statements: CompiledQuery[] = [
        k
          .insertInto('billing_events')
          .values({
            id: uuidv7(at),
            provider: input.provider,
            event_id: input.eventId,
            event_type: input.eventType,
            player_id: input.playerId,
            occurred_at: input.occurredAt,
            received_at: at,
            payload_json: ctx.json.encode('billing_events.payload_json', JsonObject, payload),
          })
          .compile(),
      ];
      const apply = input.playerId !== null && s !== undefined;
      if (apply) {
        const id = input.playerId as string;
        const t = input.occurredAt;
        statements.push(
          k
            .updateTable('players')
            .set({ sub_status: s.subStatus, sub_expires_at: s.subExpiresAt, sub_event_at: t })
            .where('id', '=', id)
            .where((eb) => eb.or([eb('sub_event_at', 'is', null), eb('sub_event_at', '<=', t)]))
            .compile(),
        );
        statements.push(
          k
            .insertInto('billing_accounts')
            .values({
              player_id: id,
              provider: input.provider,
              customer_id: s.customerId ?? null,
              subscription_id: s.subscriptionId ?? null,
              plan: s.plan ?? null,
              cancel_at: s.cancelAt ?? null,
              state_at: t,
              updated_at: at,
            })
            .onConflict((oc) =>
              oc
                .column('player_id')
                .doUpdateSet((eb) => ({
                  provider: eb.ref('excluded.provider'),
                  // Ids and plan: a value in the event wins, a missing one keeps the stored value.
                  customer_id: eb.fn.coalesce(
                    eb.ref('excluded.customer_id'),
                    eb.ref('billing_accounts.customer_id'),
                  ),
                  subscription_id: eb.fn.coalesce(
                    eb.ref('excluded.subscription_id'),
                    eb.ref('billing_accounts.subscription_id'),
                  ),
                  plan: eb.fn.coalesce(eb.ref('excluded.plan'), eb.ref('billing_accounts.plan')),
                  cancel_at:
                    s.cancelAt === undefined
                      ? eb.ref('billing_accounts.cancel_at')
                      : eb.ref('excluded.cancel_at'),
                  state_at: eb.ref('excluded.state_at'),
                  updated_at: eb.ref('excluded.updated_at'),
                }))
                .where('billing_accounts.state_at', '<=', t),
            )
            .compile(),
        );
      }
      statements.push(
        audit.appendStatement({
          playerId: input.playerId,
          kind: 'billing_event',
          payload,
          at,
        }),
      );
      try {
        const counts = await ctx.atomic(statements);
        if (!apply) return 'recorded';
        return counts[1] === 1 ? 'applied' : 'stale';
      } catch (err) {
        if (isUniqueViolation(err, 'billing_events')) return 'duplicate';
        throw err;
      }
    },

    async account(playerId: string): Promise<BillingAccount | null> {
      const row = await k
        .selectFrom('billing_accounts')
        .selectAll()
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return row ? toBillingAccount(row) : null;
    },

    /** The player a provider subscription or customer belongs to (events without our custom data). */
    async findPlayer(
      provider: string,
      ids: { subscriptionId?: string | null; customerId?: string | null },
    ): Promise<string | null> {
      if (ids.subscriptionId) {
        const row = await k
          .selectFrom('billing_accounts')
          .select('player_id')
          .where('provider', '=', provider)
          .where('subscription_id', '=', ids.subscriptionId)
          .executeTakeFirst();
        if (row) return row.player_id;
      }
      if (ids.customerId) {
        const row = await k
          .selectFrom('billing_accounts')
          .select('player_id')
          .where('provider', '=', provider)
          .where('customer_id', '=', ids.customerId)
          .orderBy('updated_at', 'desc')
          .executeTakeFirst();
        if (row) return row.player_id;
      }
      return null;
    },

    /** The player's recorded billing events, oldest first (data export, R-SEC-010). */
    async events(playerId: string): Promise<BillingEventRecord[]> {
      const list = await k
        .selectFrom('billing_events')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();
      return list.map((r) => toBillingEvent(ctx, r));
    },

    /** Sets when the free trial ends (sign-up sets now + 7 days; tests and local tools move it). */
    async setTrialEndsAt(playerId: string, at: number): Promise<boolean> {
      if (!Number.isSafeInteger(at)) throw new RangeError('trialEndsAt must be ms');
      const r = await k
        .updateTable('players')
        .set({ trial_ends_at: at })
        .where('id', '=', playerId)
        .executeTakeFirst();
      return Number(r.numUpdatedRows) === 1;
    },
  };
}

export type BillingRepo = ReturnType<typeof billingRepo>;
