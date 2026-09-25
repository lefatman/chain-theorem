/**
 * Billing end to end inside workerd (M6 6.3 done-when for the fake provider): sign up -> trial ->
 * the trial ends -> online play answers 402 -> checkout -> pay on the fake checkout page -> the
 * signed webhook goes through the production verification path -> subscribed -> play again. Also
 * the webhook's refusals (unsigned, tampered, stale, wrong secret), idempotency and ordering, the
 * subscription lifecycle, deletion and export.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db.ts';
import { addMonths } from '../src/billing/plans.ts';
import { fakeSecret } from '../src/billing/select.ts';
import { signBody } from '../src/billing/signature.ts';
import { BASE, call, signUp } from './helpers.ts';

const TIDE = { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] };
const DAY = 24 * 60 * 60 * 1000;

interface Access {
  status: 'trial' | 'subscriber' | 'expired';
  subStatus: string;
  trialEndsAt: number;
  subExpiresAt: number | null;
  canPlay: boolean;
  canTrade: boolean;
}

async function accessOf(cookie: string): Promise<Access> {
  const r = await call<{ me: { access: Access } }>('GET', '/api/me', undefined, cookie);
  expect(r.status).toBe(200);
  return r.data.me.access;
}

async function saveLoadout(cookie: string): Promise<string> {
  const r = await call<{ id: string; valid: boolean }>(
    'PUT',
    '/api/loadouts',
    { name: 'Tide', loadout: TIDE },
    cookie,
  );
  expect(r.data.valid).toBe(true);
  return r.data.id;
}

async function expireTrial(playerId: string): Promise<void> {
  const db = await getDb(env);
  expect(await db.billing.setTrialEndsAt(playerId, Date.now() - 1)).toBe(true);
}

/** Every online-play entry point answers 402 subscription_required (or passes). */
async function playStatuses(cookie: string, loadoutId: string): Promise<number[]> {
  const out: number[] = [];
  for (const [path, body] of [
    ['/api/world/ticket', undefined],
    ['/api/battles', { kind: 'npc', format: 'first_blood', loadoutId, tier: 'wild' }],
    ['/api/challenges/AbCdEf1234/accept', { loadoutId }],
    ['/api/queue/ticket', { format: 'first_blood', loadoutId }],
  ] as const) {
    const r = await call<{ error?: string }>('POST', path, body, cookie);
    if (r.status === 402) expect(r.data.error).toBe('subscription_required');
    out.push(r.status);
  }
  return out;
}

/** Walks the fake checkout like a browser: create, open the page, press Pay. */
async function payThroughFakeCheckout(cookie: string, plan: string): Promise<string> {
  const co = await call<{ url: string }>('POST', '/api/billing/checkout', { plan }, cookie);
  expect(co.status).toBe(200);
  const url = new URL(co.data.url);
  expect(url.pathname).toBe('/api/billing/fake/checkout');
  const page = await SELF.fetch(`${BASE}${url.pathname}${url.search}`, { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toContain('text/html');
  const html = await page.text();
  expect(html).toContain('Test mode');
  const session = /name="session" value="([^"]+)"/.exec(html)?.[1] ?? '';
  expect(session).toBe(url.searchParams.get('session'));
  const pay = await SELF.fetch(`${BASE}/api/billing/fake/pay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE,
      cookie,
    },
    body: new URLSearchParams({ session }).toString(),
    redirect: 'manual',
  });
  expect(pay.status).toBe(303);
  expect(pay.headers.get('location')).toBe(`${env.APP_ORIGIN}/#/account?checkout=success`);
  return session;
}

async function postWebhook(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['paddle-signature'] = signature;
  const res = await SELF.fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers, body });
  return {
    status: res.status,
    data: (await res.json()) as { ok?: boolean; outcome?: string; error?: string },
  };
}

function subscriptionEvent(
  playerId: string,
  eventId: string,
  occurredAt: number,
  status: string,
  endsAt: number,
): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: status === 'canceled' ? 'subscription.canceled' : 'subscription.updated',
    occurred_at: new Date(occurredAt).toISOString(),
    notification_id: `ntf_${eventId}`,
    data: {
      id: `sub_${playerId.slice(-8)}`,
      status,
      customer_id: `ctm_${playerId.slice(-8)}`,
      custom_data: { player_id: playerId },
      items: [{ price: { id: 'pri_fake_monthly' }, quantity: 1 }],
      current_billing_period:
        status === 'canceled'
          ? null
          : {
              starts_at: new Date(occurredAt).toISOString(),
              ends_at: new Date(endsAt).toISOString(),
            },
      scheduled_change: null,
      canceled_at: status === 'canceled' ? new Date(endsAt).toISOString() : null,
    },
  });
}

describe('billing (M6 6.3)', () => {
  it('R-COST-005 R-SEC-007 trial, expiry, 402, fake checkout, verified webhook, subscribed, play again', async () => {
    const a = await signUp(env, 'Payer');
    const start = Date.now();

    // 1. A new account is on the 7-day trial: full play, no trading (14.4).
    const trial = await accessOf(a.cookie);
    expect(trial).toMatchObject({
      status: 'trial',
      subStatus: 'none',
      canPlay: true,
      canTrade: false,
      subExpiresAt: null,
    });
    expect(Math.abs(trial.trialEndsAt - (start + 7 * DAY))).toBeLessThan(60_000);
    const loadoutId = await saveLoadout(a.cookie);
    const worldTicket = await call<{ url: string }>(
      'POST',
      '/api/world/ticket',
      undefined,
      a.cookie,
    );
    expect(worldTicket.status).toBe(200);
    const queueTicket = await call<{ url: string }>(
      'POST',
      '/api/queue/ticket',
      { format: 'first_blood', loadoutId },
      a.cookie,
    );
    expect(queueTicket.status).toBe(200);

    // 2. The trial ends: online play is refused, the account itself still works.
    await expireTrial(a.id);
    expect(await accessOf(a.cookie)).toMatchObject({ status: 'expired', canPlay: false });
    expect(await playStatuses(a.cookie, loadoutId)).toEqual([402, 402, 402, 402]);
    // Tickets issued during the trial are re-checked at the socket upgrade.
    for (const t of [worldTicket.data.url, queueTicket.data.url]) {
      const up = await SELF.fetch(`${BASE}${t}`, { headers: { upgrade: 'websocket' } });
      expect(up.status, t).toBe(402);
      expect(await up.json()).toEqual({ error: 'subscription_required' });
    }
    expect((await call('GET', '/api/me/export', undefined, a.cookie)).status).toBe(200);
    expect((await call('GET', '/api/loadouts', undefined, a.cookie)).status).toBe(200);
    const plans = await call<{ provider: string; plans: { id: string; priceCents: number }[] }>(
      'GET',
      '/api/billing/plans',
    );
    expect(plans.data.provider).toBe('fake');
    expect(plans.data.plans.map((p) => [p.id, p.priceCents])).toEqual([
      ['monthly', 400],
      ['quarterly', 1100],
      ['yearly', 4000],
    ]);

    // 3. Opening a checkout grants nothing by itself: only the provider's webhook does.
    const pending = await call<{ url: string }>(
      'POST',
      '/api/billing/checkout',
      { plan: 'monthly' },
      a.cookie,
    );
    expect(pending.status).toBe(200);
    expect((await accessOf(a.cookie)).status).toBe('expired');

    // 4. Pay on the fake checkout page: the Worker signs and delivers the webhooks to itself.
    const paidAt = Date.now();
    const session = await payThroughFakeCheckout(a.cookie, 'monthly');
    const sub = await accessOf(a.cookie);
    expect(sub).toMatchObject({
      status: 'subscriber',
      subStatus: 'active',
      canPlay: true,
      canTrade: true,
    });
    expect(Math.abs((sub.subExpiresAt ?? 0) - addMonths(paidAt, 1))).toBeLessThan(60_000);
    const view = await call<{ plan: string; cancelAt: number | null }>(
      'GET',
      '/api/billing/subscription',
      undefined,
      a.cookie,
    );
    expect(view.data).toMatchObject({ plan: 'monthly', cancelAt: null });

    // 5. Play is allowed again.
    expect((await call('POST', '/api/world/ticket', undefined, a.cookie)).status).toBe(200);
    const npc = await call<{ battleId: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'first_blood', loadoutId, tier: 'wild' },
      a.cookie,
    );
    expect(npc.status).toBe(200);

    // 6. One subscription at a time; pressing Pay again changes nothing (same event ids).
    expect((await call('POST', '/api/billing/checkout', { plan: 'yearly' }, a.cookie)).status).toBe(
      409,
    );
    const again = await SELF.fetch(`${BASE}/api/billing/fake/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
      body: new URLSearchParams({ session }).toString(),
      redirect: 'manual',
    });
    expect(again.status).toBe(303);
    const db = await getDb(env);
    const events = await db.billing.events(a.id);
    expect(events.map((e) => e.eventType)).toEqual([
      'subscription.created',
      'transaction.completed',
    ]);
    const audit = await db.audit.listForPlayer(a.id);
    expect(audit.filter((x) => x.kind === 'billing_event')).toHaveLength(2);
  });

  it('R-SEC-007 renewal, failed payment, cancel at period end, resume and cancel now', async () => {
    const a = await signUp(env, 'Cycle');
    await expireTrial(a.id);
    await payThroughFakeCheckout(a.cookie, 'quarterly');
    const first = await accessOf(a.cookie);
    expect(first.status).toBe('subscriber');

    const sim = (action: string) =>
      call<{ access: Access; cancelAt: number | null; plan: string }>(
        'POST',
        '/api/billing/fake/simulate',
        { action },
        a.cookie,
      );
    const renewed = await sim('renew');
    expect(renewed.data.plan).toBe('quarterly');
    expect(renewed.data.access.subExpiresAt).toBe(addMonths(first.subExpiresAt ?? 0, 3));

    const failed = await sim('fail_payment');
    expect(failed.data.access).toMatchObject({
      subStatus: 'past_due',
      status: 'subscriber',
      canPlay: true,
    });

    const canceled = await call<{ cancelAt: number | null; access: Access }>(
      'POST',
      '/api/billing/cancel',
      undefined,
      a.cookie,
    );
    expect(canceled.status).toBe(200);
    expect(canceled.data.cancelAt).toBe(renewed.data.access.subExpiresAt);
    expect(canceled.data.access.status).toBe('subscriber');
    expect((await call('POST', '/api/billing/cancel', undefined, a.cookie)).status).toBe(409);

    const resumed = await call<{ cancelAt: number | null }>(
      'POST',
      '/api/billing/resume',
      undefined,
      a.cookie,
    );
    expect(resumed.status).toBe(200);
    expect(resumed.data.cancelAt).toBeNull();

    const ended = await sim('cancel_now');
    expect(ended.data.access).toMatchObject({
      subStatus: 'canceled',
      status: 'expired',
      canPlay: false,
    });
    expect((await call('POST', '/api/world/ticket', undefined, a.cookie)).status).toBe(402);
  });

  it('R-SEC-007 the webhook refuses unsigned, tampered, stale and wrongly signed bodies; replays and older events change nothing', async () => {
    const a = await signUp(env, 'Hooks');
    await expireTrial(a.id);
    const secret = await fakeSecret(env);
    const now = Date.now();
    // Event times (provider clock) a little in the past; every delivery is signed now.
    const t0 = now - 10_000;
    const body = subscriptionEvent(a.id, `evt_h_${now}`, t0, 'active', now + 30 * DAY);

    expect(await postWebhook(body, null)).toMatchObject({
      status: 401,
      data: { error: 'bad_signature' },
    });
    const good = await signBody(secret, body, now);
    const tampered = body.replace('"active"', '"past_due"');
    expect((await postWebhook(tampered, good)).status).toBe(401);
    expect((await postWebhook(body, await signBody('guessed-secret', body, now))).status).toBe(401);
    expect(await postWebhook(body, await signBody(secret, body, now - 6 * 60_000))).toMatchObject({
      status: 401,
      data: { error: 'stale_signature' },
    });
    expect((await accessOf(a.cookie)).status).toBe('expired');

    expect(await postWebhook(body, good)).toMatchObject({
      status: 200,
      data: { outcome: 'applied' },
    });
    expect((await accessOf(a.cookie)).status).toBe('subscriber');
    // A replay of the same delivery (inside the 5-minute window) is a duplicate.
    expect(await postWebhook(body, good)).toMatchObject({
      status: 200,
      data: { outcome: 'duplicate' },
    });

    // A newer cancel, then a late older update: the older one is recorded but applies nothing.
    const cancel = subscriptionEvent(a.id, `evt_c_${now}`, t0 + 2000, 'canceled', t0 + 2000);
    expect(await postWebhook(cancel, await signBody(secret, cancel, now))).toMatchObject({
      data: { outcome: 'applied' },
    });
    const late = subscriptionEvent(a.id, `evt_l_${now}`, t0 + 1000, 'active', now + 60 * DAY);
    expect(await postWebhook(late, await signBody(secret, late, now))).toMatchObject({
      data: { outcome: 'stale' },
    });
    expect(await accessOf(a.cookie)).toMatchObject({ subStatus: 'canceled', status: 'expired' });

    // Signed but malformed: 400; signed but not ours to act on: acknowledged.
    const junk = '{"event_id":"x"}';
    expect((await postWebhook(junk, await signBody(secret, junk, now))).status).toBe(400);
    const other = JSON.stringify({
      event_id: `evt_o_${now}`,
      event_type: 'customer.created',
      occurred_at: new Date(now).toISOString(),
      data: { id: 'ctm_1' },
    });
    expect(await postWebhook(other, await signBody(secret, other, now))).toMatchObject({
      status: 200,
      data: { outcome: 'ignored' },
    });
  });

  it('R-SEC-007 entitlement comes only from the server: forged checkout sessions and client claims do nothing', async () => {
    const a = await signUp(env, 'Forger');
    await expireTrial(a.id);
    const forged = await SELF.fetch(`${BASE}/api/billing/fake/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
      body: new URLSearchParams({ session: 'eyJwbGF5ZXJJZCI6IngifQ.AAAA' }).toString(),
      redirect: 'manual',
    });
    expect(forged.status).toBe(410);
    const page = await SELF.fetch(`${BASE}/api/billing/fake/checkout?session=nope`);
    expect(page.status).toBe(410);
    // No route takes an entitlement from the client; unknown fields are ignored.
    await call(
      'PUT',
      '/api/loadouts',
      { name: 'x', loadout: TIDE, access: 'subscriber' },
      a.cookie,
    );
    expect((await accessOf(a.cookie)).status).toBe('expired');
    // A cross-site form cannot drive checkout.
    const csrf = await SELF.fetch(`${BASE}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        cookie: a.cookie,
      },
      body: JSON.stringify({ plan: 'monthly' }),
    });
    expect(csrf.status).toBe(403);
    expect(
      (await call('POST', '/api/billing/checkout', { plan: 'lifetime' }, a.cookie)).status,
    ).toBe(400);
    expect((await call('POST', '/api/billing/checkout', { plan: 'monthly' })).status).toBe(401);
  });

  it('R-COST-005 /api/me reports canTrade: false on the trial, true once subscribed', async () => {
    const a = await signUp(env, 'Trader');
    expect(await accessOf(a.cookie)).toMatchObject({
      status: 'trial',
      canPlay: true,
      canTrade: false,
    });
    await payThroughFakeCheckout(a.cookie, 'yearly');
    expect(await accessOf(a.cookie)).toMatchObject({ status: 'subscriber', canTrade: true });
  });

  it('R-SEC-010 export includes billing; deleting the account cancels the subscription first', async () => {
    const a = await signUp(env, 'Leaver');
    await payThroughFakeCheckout(a.cookie, 'monthly');
    const exp = await call<{ billing: { account: { plan: string }; events: unknown[] } }>(
      'GET',
      '/api/me/export',
      undefined,
      a.cookie,
    );
    expect(exp.data.billing.account.plan).toBe('monthly');
    expect(exp.data.billing.events).toHaveLength(2);
    const db = await getDb(env);
    const acct = await db.billing.account(a.id);
    expect(acct?.subscriptionId).toMatch(/^sub_fake_/);
    const del = await call('DELETE', '/api/me', undefined, a.cookie);
    expect(del.status).toBe(204);
    expect(await db.players.getById(a.id)).toBeNull();
    expect(await db.billing.account(a.id)).toBeNull();
    expect(await db.billing.events(a.id)).toEqual([]);

    // The subscription is ended at the provider before anything is deleted: when that fails (here
    // a subscription at a provider this server no longer runs), the account is kept for a retry.
    const b = await signUp(env, 'Stuck');
    expect(
      await db.billing.record({
        provider: 'paddle',
        eventId: `evt_stuck_${b.id}`,
        eventType: 'subscription.created',
        occurredAt: Date.now(),
        playerId: b.id,
        state: {
          subStatus: 'active',
          subExpiresAt: Date.now() + 30 * DAY,
          subscriptionId: 'sub_elsewhere',
        },
      }),
    ).toBe('applied');
    const refused = await call<{ error: string }>('DELETE', '/api/me', undefined, b.cookie);
    expect(refused).toMatchObject({ status: 502, data: { error: 'billing_unavailable' } });
    expect(await db.players.getById(b.id)).not.toBeNull();
  });

  it('R-SEC-009 billing answers never carry the Worker secrets', async () => {
    const a = await signUp(env, 'Secretive');
    const secret = await fakeSecret(env);
    const texts: string[] = [];
    for (const [m, p, b] of [
      ['GET', '/api/billing/plans', undefined],
      ['GET', '/api/billing/subscription', undefined],
      ['GET', '/api/me', undefined],
      ['POST', '/api/billing/checkout', { plan: 'monthly' }],
    ] as const) {
      texts.push(JSON.stringify((await call(m, p, b, a.cookie)).data));
    }
    for (const t of texts) {
      expect(t).not.toContain(env.AUTH_SECRET);
      expect(t).not.toContain(secret);
    }
  });
});
