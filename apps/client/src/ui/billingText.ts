/**
 * Words for the account's access and the plans (M6 6.3; spec 14.3, 14.4). The server decides access
 * (R-SEC-007); these only describe what `/api/me` and `/api/billing/*` report.
 */
import type { AccessView, BillingPlan } from '@chain-theorem/protocol';

const DAY = 24 * 60 * 60 * 1000;

/** Whole days left, rounded up (6.2 days left reads "7 days"), never below 0. */
export function daysLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / DAY));
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "$4.00 a month", "$11.00 every 3 months", "$40.00 a year". */
export function priceText(p: BillingPlan): string {
  if (p.months === 1) return `${usd(p.priceCents)} a month`;
  if (p.months === 12) return `${usd(p.priceCents)} a year`;
  return `${usd(p.priceCents)} every ${p.months} months`;
}

/** "About $3.67 a month" for the longer plans; null for the monthly one. */
export function perMonthText(p: BillingPlan): string | null {
  if (p.months <= 1) return null;
  return `About ${usd(Math.round(p.priceCents / p.months))} a month`;
}

export type Tone = 'ok' | 'info' | 'warn' | 'alert';

/** One sentence (or two) about where the account stands, and how urgent it is. */
export function accessText(
  a: AccessView,
  now: number,
  extra: { cancelAt?: number | null; planName?: string | null } = {},
): { text: string; tone: Tone } {
  const plan = extra.planName ? ` (${extra.planName.toLowerCase()} plan)` : '';
  if (a.status === 'trial') {
    const n = daysLeft(a.trialEndsAt, now);
    return {
      tone: n <= 2 ? 'warn' : 'info',
      text: `Free trial: ${n} ${n === 1 ? 'day' : 'days'} left (ends ${formatDate(a.trialEndsAt)}). Full access to play; trading and wagers need a subscription.`,
    };
  }
  if (a.status === 'subscriber') {
    const until = a.subExpiresAt !== null ? formatDate(a.subExpiresAt) : '';
    if (a.subStatus === 'past_due')
      return {
        tone: 'warn',
        text: `Your last payment did not go through. The payment provider is retrying; you keep access until ${until}. Update your payment method to keep playing.`,
      };
    if (a.subStatus === 'canceled')
      return { tone: 'info', text: `Subscription canceled. You keep access until ${until}.` };
    if (extra.cancelAt)
      return {
        tone: 'info',
        text: `Subscribed${plan}. It ends on ${formatDate(extra.cancelAt)}; you keep full access until then.`,
      };
    return { tone: 'ok', text: `Subscribed${plan}. Renews on ${until}.` };
  }
  return {
    tone: 'alert',
    text:
      a.subStatus === 'none'
        ? 'Your trial has ended. Subscribe to keep playing online.'
        : 'Your subscription has ended. Subscribe to keep playing online.',
  };
}

/** The headline of the "play is refused" state. */
export function lockedTitle(a: AccessView): string {
  return a.subStatus === 'none' ? 'Your trial has ended' : 'Your subscription has ended';
}

export function billingErrorText(code: string): string {
  const known: Record<string, string> = {
    subscription_required: 'Your trial has ended. Subscribe to keep playing online.',
    already_subscribed: 'You already have a subscription.',
    no_subscription: 'There is no subscription to change.',
    plan_unavailable: 'That plan is not available right now.',
    billing_unavailable: 'Payments are not available right now. Please try again later.',
    not_supported: 'That is not available with this payment provider.',
    offline: 'The server cannot be reached.',
    signed_out: 'Please sign in again.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}
