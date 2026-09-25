/**
 * Paddle Billing webhook events (API v1) normalized into what entitlement needs (R-SEC-007). Both
 * providers speak this format: Paddle in production, and the local fake provider, which signs and
 * delivers Paddle-shaped events to the same endpoint.
 *
 * Mapping (spec 14.4; the entitlement rules are in entitlement.ts):
 * - subscription.created / activated / updated / resumed / trialing / past_due / canceled / paused:
 *   the subscription's own status (`trialing` counts as `active`: the game's trial never involves the
 *   provider). Paid until: the current billing period's end; for `canceled`, the moment the cancel
 *   took effect (`canceled_at`), so access ends then; for `paused`, no access (entitlement.ts).
 *   `past_due` keeps the period's end while the provider retries the payment; the provider cancels
 *   or pauses the subscription when its retries run out, which ends access (DD).
 *   A scheduled cancel (`scheduled_change.action = cancel`) is kept to show "cancels on".
 * - transaction.completed with a subscription id: a payment went through, so the subscription is
 *   `active` until the transaction's billing period ends. It says nothing about the plan or a
 *   scheduled cancel, so those stay as stored.
 * - Anything else is verified and acknowledged but changes nothing (`event: null`).
 * Ordering uses the event's `occurred_at` (webhooks can arrive out of order).
 */
import { z } from 'zod';
import type { PlanId } from '@chain-theorem/protocol';
import type { SubStatus } from './entitlement.ts';

export interface BillingEvent {
  /** Provider event id (Paddle `event_id`): the idempotency key. */
  id: string;
  type: string;
  /** Epoch ms of `occurred_at`: the ordering key. */
  occurredAt: number;
  /** `custom_data.player_id` set by our own checkout, or null. */
  playerId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** From the price id; null when not in the event or not one of ours. */
  plan: PlanId | null;
  subStatus: SubStatus;
  /** End of the paid period, or null. */
  paidUntil: number | null;
  /** A scheduled cancel (ms), null for none, undefined when the event does not say. */
  cancelAt?: number | null;
}

export type ParsedEvent = { ok: true; event: BillingEvent | null } | { ok: false };

export const SUBSCRIPTION_EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.resumed',
  'subscription.trialing',
  'subscription.past_due',
  'subscription.canceled',
  'subscription.paused',
] as const;

const Id = z.string().min(1).max(200);
const Time = z.string().min(10).max(40);
const Period = z.object({ starts_at: Time, ends_at: Time }).nullish();
const CustomData = z.record(z.string(), z.unknown()).nullish();
const Items = z
  .array(
    z.object({
      price_id: Id.nullish(),
      price: z.object({ id: Id }).nullish(),
    }),
  )
  .max(100)
  .nullish();

const Envelope = z.object({
  event_id: Id,
  event_type: z.string().min(1).max(100),
  occurred_at: Time,
  data: z.record(z.string(), z.unknown()),
});

const Subscription = z.object({
  id: Id,
  status: z.enum(['active', 'trialing', 'past_due', 'paused', 'canceled']),
  customer_id: Id.nullish(),
  custom_data: CustomData,
  items: Items,
  current_billing_period: Period,
  scheduled_change: z.object({ action: z.string().max(40), effective_at: Time }).nullish(),
  canceled_at: Time.nullish(),
});

const Transaction = z.object({
  id: Id,
  status: z.string().max(40),
  customer_id: Id.nullish(),
  subscription_id: Id.nullish(),
  custom_data: CustomData,
  items: Items,
  billing_period: Period,
});

/** RFC 3339 (Paddle sends microseconds) to epoch ms; null when not a date. */
export function parseTime(s: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}.${(m[2] ?? '0').slice(0, 3).padEnd(3, '0')}${m[3]}`);
  return Number.isFinite(ms) ? ms : null;
}

function playerOf(custom: Record<string, unknown> | null | undefined): string | null {
  const p = custom?.player_id;
  return typeof p === 'string' && p.length > 0 && p.length <= 64 ? p : null;
}

function planOf(
  items: z.infer<typeof Items>,
  priceToPlan: (priceId: string) => PlanId | null,
): PlanId | null {
  for (const it of items ?? []) {
    const id = it.price?.id ?? it.price_id;
    const plan = id ? priceToPlan(id) : null;
    if (plan) return plan;
  }
  return null;
}

/** Parses a verified raw body. `ok: false` means malformed; `event: null` means not ours to act on. */
export function parseEvent(
  raw: string,
  priceToPlan: (priceId: string) => PlanId | null,
): ParsedEvent {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const env = Envelope.safeParse(json);
  if (!env.success) return { ok: false };
  const { event_id: id, event_type: type, data } = env.data;
  const occurredAt = parseTime(env.data.occurred_at);
  if (occurredAt === null) return { ok: false };

  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(type)) {
    const s = Subscription.safeParse(data);
    if (!s.success) return { ok: false };
    const sub = s.data;
    const periodEnd = sub.current_billing_period
      ? parseTime(sub.current_billing_period.ends_at)
      : null;
    const canceledAt = sub.canceled_at ? parseTime(sub.canceled_at) : null;
    const change = sub.scheduled_change;
    const cancelAt = change && change.action === 'cancel' ? parseTime(change.effective_at) : null;
    let subStatus: SubStatus;
    let paidUntil: number | null;
    switch (sub.status) {
      case 'active':
      case 'trialing':
        subStatus = 'active';
        paidUntil = periodEnd;
        break;
      case 'past_due':
        subStatus = 'past_due';
        paidUntil = periodEnd;
        break;
      case 'canceled':
        subStatus = 'canceled';
        paidUntil = canceledAt ?? occurredAt;
        break;
      case 'paused':
        subStatus = 'paused';
        paidUntil = null;
        break;
    }
    return {
      ok: true,
      event: {
        id,
        type,
        occurredAt,
        playerId: playerOf(sub.custom_data),
        customerId: sub.customer_id ?? null,
        subscriptionId: sub.id,
        plan: planOf(sub.items, priceToPlan),
        subStatus,
        paidUntil,
        cancelAt: sub.status === 'canceled' ? null : cancelAt,
      },
    };
  }

  if (type === 'transaction.completed') {
    const t = Transaction.safeParse(data);
    if (!t.success) return { ok: false };
    const txn = t.data;
    const ends = txn.billing_period ? parseTime(txn.billing_period.ends_at) : null;
    // A one-off transaction (no subscription) or one without a period grants nothing.
    if (!txn.subscription_id || ends === null) return { ok: true, event: null };
    return {
      ok: true,
      event: {
        id,
        type,
        occurredAt,
        playerId: playerOf(txn.custom_data),
        customerId: txn.customer_id ?? null,
        subscriptionId: txn.subscription_id,
        plan: planOf(txn.items, priceToPlan),
        subStatus: 'active',
        paidUntil: ends,
      },
    };
  }

  return { ok: true, event: null };
}
