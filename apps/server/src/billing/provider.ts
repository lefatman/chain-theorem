/**
 * `BillingProvider` (ARCHITECTURE 6): `FakeBillingProvider` locally and in tests, and
 * `PaddleBillingProvider` in production (DD-07). Both verify webhooks with the same signature scheme
 * and parse the same event format (signature.ts, events.ts), so the fake exercises the production
 * verification path end to end.
 */
import type { PlanId } from '@chain-theorem/protocol';
import type { BillingEvent } from './events.ts';

export type ProviderId = 'fake' | 'paddle';

export interface CheckoutInput {
  plan: PlanId;
  playerId: string;
  /** The provider customer from an earlier subscription, reused when known. */
  customerId: string | null;
  now: number;
}

/** The player's subscription at the provider (from `billing_accounts` and the player row). */
export interface SubscriptionRef {
  playerId: string;
  subscriptionId: string;
  customerId: string | null;
  plan: PlanId | null;
  /** End of the paid period, or null. */
  paidUntil: number | null;
}

export type WebhookCheck =
  | { ok: true; event: BillingEvent | null }
  | { ok: false; reason: 'bad_signature' | 'stale_signature' | 'bad_payload' };

export interface BillingProvider {
  readonly id: ProviderId;
  /** Plans this provider can sell (Paddle: those with a price id configured). */
  plans(): PlanId[];
  /** A URL where the player pays for `plan`; the provider's webhook then sets the entitlement. */
  checkout(input: CheckoutInput): Promise<{ url: string }>;
  /** Verifies the signature of the raw body first, then parses it (R-SEC-007). */
  verifyWebhook(rawBody: string, headers: Headers, now: number): Promise<WebhookCheck>;
  /**
   * Cancels at the end of the paid period (the player keeps what they paid for) or now (account
   * deletion). The entitlement changes when the provider's webhook arrives.
   */
  cancel(sub: SubscriptionRef, when: 'period_end' | 'now', now: number): Promise<void>;
  /** Takes back a scheduled cancel: the subscription renews as before. */
  resume(sub: SubscriptionRef, now: number): Promise<void>;
  /** The provider's customer portal (payment method, invoices), when it has one. */
  portal?(sub: SubscriptionRef): Promise<string>;
}

/** The provider answered with an error or could not be reached. */
export class BillingProviderError extends Error {
  override readonly name = 'BillingProviderError';
}
