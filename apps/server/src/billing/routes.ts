/**
 * Billing routes (M6 6.3; spec 14.3, 14.4; R-SEC-007). REST contract in ARCHITECTURE 6:
 *
 * - `GET  /api/billing/plans`         the plans on sale and what the provider supports
 * - `GET  /api/billing/subscription`  the account's access, plan and scheduled cancel
 * - `POST /api/billing/checkout`      `{ plan }` -> `{ url }` (pay there; a webhook then subscribes)
 * - `POST /api/billing/cancel`        cancel at the end of the paid period
 * - `POST /api/billing/resume`        take back a scheduled cancel
 * - `POST /api/billing/portal`        `{ url }` of the provider's customer portal (Paddle)
 * - `POST /api/billing/webhook`       provider webhooks: raw body, signature verified first,
 *                                     idempotent by event id, out-of-order safe, audited
 * - `GET  /api/billing/fake/checkout` and `POST /api/billing/fake/pay`: the fake provider's page
 * - `POST /api/billing/fake/simulate` `{ action }`: renew, fail a payment, cancel now, or end the
 *                                     trial (fake provider only: local development and tests)
 * - `GET  /api/billing/paddle/pay`    the page hosting Paddle.js for a transaction (`_ptxn`)
 *
 * Entitlement lives in the player row and only verified webhooks change the subscription part of it.
 */
import {
  Checkout,
  FakeSimulate,
  type BillingPlans,
  type SubscriptionView,
} from '@chain-theorem/protocol';
import type { BillingEventOutcome, Db, Player } from '@chain-theorem/db';
import type { Ctx } from '../api/context.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import { access, accessView } from './entitlement.ts';
import type { BillingEvent } from './events.ts';
import { FakeBillingProvider } from './fake.ts';
import { checkoutExpiredHtml, fakeCheckoutHtml, paddlePayHtml } from './pages.ts';
import { PLANS, isPlanId } from './plans.ts';
import {
  BillingProviderError,
  type BillingProvider,
  type ProviderId,
  type SubscriptionRef,
} from './provider.ts';
import { billingProvider, providerId } from './select.ts';

/** Paddle's payloads are a few KB; anything this large is not a webhook. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

function html(body: string, status = 200, csp?: string): Response {
  const h = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    // same-origin: the checkout link's token never leaves in a Referer, and form posts keep their
    // Origin header (no-referrer would send "Origin: null", which checkOrigin refuses).
    'referrer-policy': 'same-origin',
  });
  if (csp) h.set('content-security-policy', csp);
  return new Response(body, { status, headers: h });
}

function provider(ctx: Ctx): Promise<BillingProvider | null> {
  return billingProvider(ctx.env, (req) => handleWebhook(req, ctx));
}

async function requireProvider(ctx: Ctx): Promise<BillingProvider> {
  const p = await provider(ctx);
  if (!p) throw new HttpError(503, 'billing_unavailable');
  return p;
}

async function requireFake(ctx: Ctx): Promise<FakeBillingProvider> {
  const p = await provider(ctx);
  if (!(p instanceof FakeBillingProvider)) throw new HttpError(404, 'not_found');
  return p;
}

/** Provider trouble is the provider's, not the player's: 502, and the detail goes to the log. */
async function viaProvider<T>(what: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof BillingProviderError) {
      console.error(JSON.stringify({ billing_error: what, message: e.message }));
      throw new HttpError(502, 'billing_unavailable');
    }
    throw e;
  }
}

/**
 * Applies one verified event: the player comes from our own `custom_data` (set at checkout), else
 * from the subscription or customer id we stored; an event for no known player is only recorded.
 */
export async function applyEvent(
  db: Db,
  providerName: ProviderId,
  ev: BillingEvent,
  now: number,
): Promise<BillingEventOutcome> {
  let playerId: string | null = null;
  if (ev.playerId && (await db.players.getById(ev.playerId))) playerId = ev.playerId;
  playerId ??= await db.billing.findPlayer(providerName, {
    subscriptionId: ev.subscriptionId,
    customerId: ev.customerId,
  });
  return db.billing.record({
    provider: providerName,
    eventId: ev.id,
    eventType: ev.type,
    occurredAt: ev.occurredAt,
    playerId,
    state: {
      subStatus: ev.subStatus,
      subExpiresAt: ev.paidUntil,
      ...(ev.customerId ? { customerId: ev.customerId } : {}),
      ...(ev.subscriptionId ? { subscriptionId: ev.subscriptionId } : {}),
      ...(ev.plan ? { plan: ev.plan } : {}),
      ...(ev.cancelAt !== undefined ? { cancelAt: ev.cancelAt } : {}),
    },
    receivedAt: now,
  });
}

/**
 * `POST /api/billing/webhook` (R-SEC-007): the raw body's signature is checked before anything is
 * parsed; a bad, tampered or stale signature is 401 and changes nothing; the event id makes retries
 * and replays no-ops. The fake provider delivers its events through this same function.
 */
export async function handleWebhook(req: Request, ctx: Ctx): Promise<Response> {
  const p = await provider(ctx);
  if (!p) return json({ error: 'not_found' }, 404);
  if (Number(req.headers.get('content-length') ?? '0') > MAX_WEBHOOK_BYTES)
    return json({ error: 'too_large' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return json({ error: 'too_large' }, 413);
  const check = await p.verifyWebhook(raw, req.headers, ctx.now);
  if (!check.ok) {
    console.warn(JSON.stringify({ billing_webhook: 'rejected', reason: check.reason }));
    return json({ error: check.reason }, check.reason === 'bad_payload' ? 400 : 401);
  }
  if (!check.event) return json({ ok: true, outcome: 'ignored' });
  const outcome = await applyEvent(ctx.db, p.id, check.event, ctx.now);
  return json({ ok: true, outcome });
}

async function subscriptionRef(
  db: Db,
  me: Player,
  providerName: ProviderId,
): Promise<SubscriptionRef | null> {
  const acct = await db.billing.account(me.id);
  if (!acct?.subscriptionId || acct.provider !== providerName) return null;
  return {
    playerId: me.id,
    subscriptionId: acct.subscriptionId,
    customerId: acct.customerId,
    plan: isPlanId(acct.plan) ? acct.plan : null,
    paidUntil: me.subExpiresAt,
  };
}

/** The account's subscription as the client sees it, read fresh (webhooks may just have run). */
export async function subscriptionView(
  db: Db,
  playerId: string,
  now: number,
): Promise<SubscriptionView> {
  const me = await db.players.getById(playerId);
  if (!me) throw new HttpError(401, 'signed_out');
  const acct = await db.billing.account(playerId);
  return {
    access: accessView(me, now),
    plan: isPlanId(acct?.plan) ? acct.plan : null,
    cancelAt: acct?.cancelAt ?? null,
  };
}

/**
 * Account deletion (R-SEC-010) ends a live subscription at once so a deleted account is never
 * billed again. Throws 502 when the provider cannot be reached (the account is kept; try again).
 */
export async function cancelForDeletion(ctx: Ctx, me: Player): Promise<void> {
  if (!['active', 'past_due', 'paused'].includes(me.subStatus)) return;
  const acct = await ctx.db.billing.account(me.id);
  if (!acct?.subscriptionId) return;
  const p = await provider(ctx);
  if (!p || p.id !== acct.provider) {
    console.error(
      JSON.stringify({ billing_error: 'delete_without_provider', provider: acct.provider }),
    );
    throw new HttpError(502, 'billing_unavailable');
  }
  const ref = await subscriptionRef(ctx.db, me, p.id);
  if (ref) await viaProvider('cancel_on_delete', () => p.cancel(ref, 'now', ctx.now));
}

export function billingRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/billing/plans', async (_req, ctx) => {
    const p = await provider(ctx);
    const ids = p ? p.plans() : [];
    return json({
      provider: providerId(ctx.env),
      plans: ids.map((id) => PLANS[id]),
      cancel: p !== null,
      portal: typeof p?.portal === 'function',
    } satisfies BillingPlans);
  });

  r.add('GET', '/api/billing/subscription', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json(await subscriptionView(ctx.db, me.id, ctx.now));
  });

  r.add('POST', '/api/billing/checkout', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { plan } = await body(req, Checkout);
    const p = await requireProvider(ctx);
    if (!p.plans().includes(plan)) throw new HttpError(400, 'plan_unavailable');
    // One subscription at a time: a live one is managed (cancel, resume, portal), not bought again.
    if (access(me, ctx.now) === 'subscriber' && ['active', 'past_due'].includes(me.subStatus))
      throw new HttpError(409, 'already_subscribed');
    const acct = await ctx.db.billing.account(me.id);
    const customerId = acct?.provider === p.id ? acct.customerId : null;
    const { url } = await viaProvider('checkout', () =>
      p.checkout({ plan, playerId: me.id, customerId, now: ctx.now }),
    );
    return json({ url });
  });

  r.add('POST', '/api/billing/cancel', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const p = await requireProvider(ctx);
    const ref = await subscriptionRef(ctx.db, me, p.id);
    const acct = await ctx.db.billing.account(me.id);
    if (!ref || !['active', 'past_due'].includes(me.subStatus) || acct?.cancelAt)
      throw new HttpError(409, 'no_subscription');
    await viaProvider('cancel', () => p.cancel(ref, 'period_end', ctx.now));
    return json(await subscriptionView(ctx.db, me.id, ctx.now));
  });

  r.add('POST', '/api/billing/resume', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const p = await requireProvider(ctx);
    const ref = await subscriptionRef(ctx.db, me, p.id);
    const acct = await ctx.db.billing.account(me.id);
    if (!ref || me.subStatus !== 'active' || !acct?.cancelAt || ctx.now >= acct.cancelAt)
      throw new HttpError(409, 'no_subscription');
    await viaProvider('resume', () => p.resume(ref, ctx.now));
    return json(await subscriptionView(ctx.db, me.id, ctx.now));
  });

  r.add('POST', '/api/billing/portal', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const p = await requireProvider(ctx);
    if (!p.portal) throw new HttpError(404, 'not_supported');
    const ref = await subscriptionRef(ctx.db, me, p.id);
    if (!ref) throw new HttpError(409, 'no_subscription');
    const portal = p.portal.bind(p);
    return json({ url: await viaProvider('portal', () => portal(ref)) });
  });

  r.add('POST', '/api/billing/webhook', (req, ctx) => handleWebhook(req, ctx));

  // ---- fake provider (local development and tests only) -----------------------------------------

  r.add('GET', '/api/billing/fake/checkout', async (req, ctx) => {
    const fake = await requireFake(ctx);
    const token = new URL(req.url).searchParams.get('session') ?? '';
    const session = await fake.openSession(token, ctx.now);
    const origin = ctx.env.APP_ORIGIN;
    const csp = `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${origin}; base-uri 'none'; frame-ancestors 'none'`;
    if (!session) return html(checkoutExpiredHtml(origin), 410, csp);
    return html(fakeCheckoutHtml(PLANS[session.plan], token, origin), 200, csp);
  });

  r.add('POST', '/api/billing/fake/pay', async (req, ctx) => {
    const fake = await requireFake(ctx);
    if (Number(req.headers.get('content-length') ?? '0') > 8192)
      throw new HttpError(413, 'too_large');
    let token = '';
    try {
      const v = (await req.formData()).get('session');
      if (typeof v === 'string') token = v;
    } catch {
      throw new HttpError(400, 'bad_request');
    }
    const session = await fake.openSession(token, ctx.now);
    if (!session) return html(checkoutExpiredHtml(ctx.env.APP_ORIGIN), 410);
    const acct = await ctx.db.billing.account(session.playerId);
    const customerId = acct?.provider === 'fake' ? acct.customerId : null;
    await viaProvider('fake_pay', () => fake.pay(session, customerId, ctx.now));
    return new Response(null, {
      status: 303,
      headers: {
        location: `${ctx.env.APP_ORIGIN}/#/account?checkout=success`,
        'cache-control': 'no-store',
      },
    });
  });

  r.add('POST', '/api/billing/fake/simulate', async (req, ctx) => {
    const fake = await requireFake(ctx);
    const me = await ctx.requireMe();
    const { action } = await body(req, FakeSimulate);
    if (action === 'expire_trial') {
      await ctx.db.billing.setTrialEndsAt(me.id, ctx.now - 1);
    } else {
      const ref = await subscriptionRef(ctx.db, me, 'fake');
      if (!ref) throw new HttpError(409, 'no_subscription');
      await viaProvider(`fake_${action}`, () =>
        action === 'renew'
          ? fake.renew(ref, ctx.now)
          : action === 'fail_payment'
            ? fake.failPayment(ref, ctx.now)
            : fake.cancel(ref, 'now', ctx.now),
      );
    }
    return json(await subscriptionView(ctx.db, me.id, ctx.now));
  });

  // ---- Paddle pay page ------------------------------------------------------------------------

  r.add('GET', '/api/billing/paddle/pay', async (_req, ctx) => {
    const p = await provider(ctx);
    const token = ctx.env.PADDLE_CLIENT_TOKEN;
    if (p?.id !== 'paddle' || !token) throw new HttpError(404, 'not_found');
    const env = ctx.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox';
    return html(paddlePayHtml(ctx.env.APP_ORIGIN, env, token));
  });
}
