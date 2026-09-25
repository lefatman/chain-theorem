/**
 * The subscription plans of spec 14.3 (COMMITTED): $4 monthly, $11 quarterly, $40 yearly. One
 * subscription unlocks everything that affects play (14.4); nothing is sold for power. Prices are
 * shown in US dollars; the provider (merchant of record, DD-07) adds sales tax or VAT at checkout.
 */
import { PLAN_IDS, type BillingPlan, type PlanId } from '@chain-theorem/protocol';

export const PLANS: Readonly<Record<PlanId, BillingPlan>> = {
  monthly: { id: 'monthly', name: 'Monthly', priceCents: 400, months: 1 },
  quarterly: { id: 'quarterly', name: 'Quarterly', priceCents: 1100, months: 3 },
  yearly: { id: 'yearly', name: 'Yearly', priceCents: 4000, months: 12 },
};

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
}

/**
 * `months` calendar months after `ms` in UTC, clamped to the last day of the target month (Jan 31
 * plus one month is Feb 28 or 29), as billing periods are counted.
 */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

/** "$4.00" from 400 cents. */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
