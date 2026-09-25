/**
 * `FakeBillingProvider` (ARCHITECTURE 6): a complete local billing provider for development and
 * tests, with no external calls. Checkout opens a page the Worker serves itself
 * (`/api/billing/fake/checkout`); paying there makes the provider sign Paddle-shaped webhook events
 * with its secret and deliver them to the Worker's own `POST /api/billing/webhook` handler, so they
 * pass through exactly the verification and parsing production uses (R-SEC-007). Renewals, failed
 * payments and cancellations are delivered the same way.
 *
 * Never selected in production: only on a local origin or with FAKE_BILLING=on (select.ts).
 */
import { PLAN_IDS, type PlanId } from '@chain-theorem/protocol';
import { base64url, fromBase64url, hmac, hmacVerify, randomToken } from '../auth/crypto.ts';
import { parseEvent } from './events.ts';
import { PLANS, addMonths, isPlanId } from './plans.ts';
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutInput,
  type SubscriptionRef,
  type WebhookCheck,
} from './provider.ts';
import { SIGNATURE_HEADER, signBody, verifySignature } from './signature.ts';

/** The fake provider's price ids (Paddle-style), one per plan. */
export const FAKE_PRICES: Readonly<Record<PlanId, string>> = {
  monthly: 'pri_fake_monthly',
  quarterly: 'pri_fake_quarterly',
  yearly: 'pri_fake_yearly',
};

/** A checkout session link stays valid for 30 minutes. */
export const FAKE_SESSION_TTL_MS = 30 * 60_000;

export interface FakeSession {
  playerId: string;
  plan: PlanId;
  /** Random per checkout: names the subscription and makes paying twice a duplicate event. */
  nonce: string;
  exp: number;
}

export interface FakeOptions {
  /** HMAC key for session links and webhook signatures. */
  secret: string;
  /** The app's origin (links back to the app, and the webhook URL). */
  origin: string;
  /** Hands a signed webhook request to the Worker's webhook handler. */
  deliver: (req: Request) => Promise<Response>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const iso = (ms: number) => new Date(ms).toISOString();

function planOfPrice(priceId: string): PlanId | null {
  return PLAN_IDS.find((p) => FAKE_PRICES[p] === priceId) ?? null;
}

interface SubShape {
  id: string;
  status: 'active' | 'past_due' | 'canceled' | 'paused';
  customerId: string | null;
  playerId: string;
  plan: PlanId | null;
  starts: number | null;
  ends: number | null;
  cancelAt?: number | null;
  canceledAt?: number | null;
}

/** A Paddle Billing subscription entity (the fields the parser reads, plus a few for realism). */
function subscriptionData(s: SubShape): Record<string, unknown> {
  return {
    id: s.id,
    status: s.status,
    customer_id: s.customerId,
    custom_data: { player_id: s.playerId },
    currency_code: 'USD',
    collection_mode: 'automatic',
    items: s.plan ? [{ status: 'active', quantity: 1, price: { id: FAKE_PRICES[s.plan] } }] : [],
    current_billing_period:
      s.starts !== null && s.ends !== null
        ? { starts_at: iso(s.starts), ends_at: iso(s.ends) }
        : null,
    next_billed_at: s.status === 'active' && !s.cancelAt && s.ends !== null ? iso(s.ends) : null,
    scheduled_change: s.cancelAt
      ? { action: 'cancel', effective_at: iso(s.cancelAt), resume_at: null }
      : null,
    canceled_at: s.canceledAt ? iso(s.canceledAt) : null,
  };
}

export class FakeBillingProvider implements BillingProvider {
  readonly id = 'fake' as const;
  private readonly opts: FakeOptions;

  constructor(opts: FakeOptions) {
    this.opts = opts;
  }

  plans(): PlanId[] {
    return [...PLAN_IDS];
  }

  async checkout(input: CheckoutInput): Promise<{ url: string }> {
    const session: FakeSession = {
      playerId: input.playerId,
      plan: input.plan,
      nonce: randomToken(12),
      exp: input.now + FAKE_SESSION_TTL_MS,
    };
    const body = base64url(enc.encode(JSON.stringify(session)));
    const token = `${body}.${await hmac(this.opts.secret, `fake-checkout.${body}`)}`;
    return {
      url: `${this.opts.origin}/api/billing/fake/checkout?session=${encodeURIComponent(token)}`,
    };
  }

  /** The session behind a checkout link, when it is authentic and unexpired. */
  async openSession(token: string, now: number): Promise<FakeSession | null> {
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined || token.length > 1024) return null;
    if (!(await hmacVerify(this.opts.secret, `fake-checkout.${body}`, sig))) return null;
    const raw = fromBase64url(body);
    if (!raw) return null;
    try {
      const s = JSON.parse(dec.decode(raw)) as Partial<FakeSession>;
      if (
        typeof s.playerId !== 'string' ||
        !isPlanId(s.plan) ||
        typeof s.nonce !== 'string' ||
        typeof s.exp !== 'number' ||
        now > s.exp
      )
        return null;
      return { playerId: s.playerId, plan: s.plan, nonce: s.nonce, exp: s.exp };
    } catch {
      return null;
    }
  }

  async verifyWebhook(rawBody: string, headers: Headers, now: number): Promise<WebhookCheck> {
    const sig = await verifySignature(
      headers.get(SIGNATURE_HEADER),
      rawBody,
      this.opts.secret,
      now,
    );
    if (!sig.ok)
      return { ok: false, reason: sig.reason === 'stale' ? 'stale_signature' : 'bad_signature' };
    const parsed = parseEvent(rawBody, planOfPrice);
    return parsed.ok ? { ok: true, event: parsed.event } : { ok: false, reason: 'bad_payload' };
  }

  /**
   * Pays for a checkout session: the new subscription, then its first completed transaction (the
   * same two events Paddle sends). Event ids come from the session, so paying twice is a no-op.
   */
  async pay(session: FakeSession, customerId: string | null, now: number): Promise<void> {
    const sub: SubShape = {
      id: `sub_fake_${session.nonce}`,
      status: 'active',
      customerId: customerId ?? `ctm_fake_${session.nonce}`,
      playerId: session.playerId,
      plan: session.plan,
      starts: now,
      ends: addMonths(now, PLANS[session.plan].months),
    };
    await this.send(`evt_fake_${session.nonce}_created`, 'subscription.created', now, sub);
    await this.sendTransaction(`evt_fake_${session.nonce}_paid`, sub, now);
  }

  /** The next period is paid: the subscription runs until one more plan length. */
  async renew(ref: SubscriptionRef, now: number): Promise<void> {
    const plan = ref.plan ?? 'monthly';
    const starts = Math.max(ref.paidUntil ?? now, now);
    const sub = this.shape(ref, 'active', starts, addMonths(starts, PLANS[plan].months));
    await this.send(`evt_fake_${randomToken(12)}`, 'subscription.updated', now, sub);
    await this.sendTransaction(`evt_fake_${randomToken(12)}`, sub, now);
  }

  /** A renewal payment failed: `past_due` while the provider would retry (access holds, 14.4). */
  async failPayment(ref: SubscriptionRef, now: number): Promise<void> {
    const sub = this.shape(ref, 'past_due', now, ref.paidUntil ?? now);
    await this.send(`evt_fake_${randomToken(12)}`, 'subscription.past_due', now, sub);
  }

  async cancel(ref: SubscriptionRef, when: 'period_end' | 'now', now: number): Promise<void> {
    if (when === 'now') {
      const sub = { ...this.shape(ref, 'canceled', null, null), canceledAt: now };
      await this.send(`evt_fake_${randomToken(12)}`, 'subscription.canceled', now, sub);
      return;
    }
    // Paddle keeps the subscription active with a scheduled cancel at the end of the period.
    const ends = ref.paidUntil ?? now;
    const sub = { ...this.shape(ref, 'active', now, ends), cancelAt: ends };
    await this.send(`evt_fake_${randomToken(12)}`, 'subscription.updated', now, sub);
  }

  async resume(ref: SubscriptionRef, now: number): Promise<void> {
    const sub = { ...this.shape(ref, 'active', now, ref.paidUntil ?? now), cancelAt: null };
    await this.send(`evt_fake_${randomToken(12)}`, 'subscription.updated', now, sub);
  }

  private shape(
    ref: SubscriptionRef,
    status: SubShape['status'],
    starts: number | null,
    ends: number | null,
  ): SubShape {
    return {
      id: ref.subscriptionId,
      status,
      customerId: ref.customerId,
      playerId: ref.playerId,
      plan: ref.plan,
      starts,
      ends,
    };
  }

  private async sendTransaction(eventId: string, sub: SubShape, now: number): Promise<void> {
    await this.post(eventId, 'transaction.completed', now, {
      id: `txn_fake_${randomToken(12)}`,
      status: 'completed',
      customer_id: sub.customerId,
      subscription_id: sub.id,
      custom_data: { player_id: sub.playerId },
      currency_code: 'USD',
      origin: 'web',
      items: sub.plan ? [{ quantity: 1, price: { id: FAKE_PRICES[sub.plan] } }] : [],
      billing_period:
        sub.starts !== null && sub.ends !== null
          ? { starts_at: iso(sub.starts), ends_at: iso(sub.ends) }
          : null,
    });
  }

  private send(eventId: string, type: string, now: number, sub: SubShape): Promise<void> {
    return this.post(eventId, type, now, subscriptionData(sub));
  }

  /** Signs a Paddle-shaped event and delivers it to the webhook endpoint. */
  private async post(
    eventId: string,
    type: string,
    now: number,
    data: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({
      event_id: eventId,
      event_type: type,
      occurred_at: iso(now),
      notification_id: `ntf_fake_${randomToken(12)}`,
      data,
    });
    const res = await this.opts.deliver(
      new Request(`${this.opts.origin}/api/billing/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: await signBody(this.opts.secret, body, now),
        },
        body,
      }),
    );
    if (!res.ok) throw new BillingProviderError(`fake webhook ${type} answered ${res.status}`);
  }
}
