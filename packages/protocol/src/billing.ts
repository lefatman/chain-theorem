/**
 * Billing REST contract (M6 6.3, spec 14.3, 14.4; ARCHITECTURE 6). Entitlement is decided on the
 * server from the player row (R-SEC-007); these are only the shapes the client sees.
 */
import { z } from 'zod';

/** The three plans of spec 14.3 (COMMITTED prices: $4 monthly, $11 quarterly, $40 yearly). */
export const PLAN_IDS = ['monthly', 'quarterly', 'yearly'] as const;
export const PlanId = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof PlanId>;

/** `POST /api/billing/checkout` body. */
export const Checkout = z.object({ plan: PlanId });

/** `POST /api/billing/fake/simulate` body (local fake provider only; never in production). */
export const FakeSimulate = z.object({
  action: z.enum(['renew', 'fail_payment', 'cancel_now', 'expire_trial']),
});

/** A plan as offered (`GET /api/billing/plans`). Prices in US cents; tax is added at checkout. */
export interface BillingPlan {
  id: PlanId;
  name: string;
  priceCents: number;
  months: number;
}

/** Which provider this server bills through: `none` when billing is not configured. */
export type BillingProviderId = 'fake' | 'paddle' | 'none';

export interface BillingPlans {
  provider: BillingProviderId;
  plans: BillingPlan[];
  /** The provider can cancel a subscription from inside the app. */
  cancel: boolean;
  /** The provider has a customer portal (update the payment method, invoices). */
  portal: boolean;
}

/** The account's access, as `/api/me` reports it (computed on the server, R-SEC-007). */
export interface AccessView {
  /** `trial` (7 days, 14.4), `subscriber`, or `expired` (neither). */
  status: 'trial' | 'subscriber' | 'expired';
  /** The provider's subscription state: none, active, past_due, canceled, paused. */
  subStatus: string;
  trialEndsAt: number;
  /** The end of the paid period (epoch ms), or null. */
  subExpiresAt: number | null;
  /** Online play: the world, battles, queues. */
  canPlay: boolean;
  /** Trading and item wagers: subscribers only (14.4). */
  canTrade: boolean;
}

/** `GET /api/billing/subscription`: the account's access plus the plan and a scheduled cancel. */
export interface SubscriptionView {
  access: AccessView;
  plan: PlanId | null;
  /** When a cancellation takes effect (the end of the paid period), or null. */
  cancelAt: number | null;
}
