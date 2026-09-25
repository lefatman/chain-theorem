/**
 * Billing units (M6 6.3): webhook signatures (R-SEC-007), Paddle event mapping, plans (14.3) and
 * provider selection.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../env.ts';
import { parseEvent, parseTime } from './events.ts';
import { PLANS, addMonths } from './plans.ts';
import { isLocalOrigin, providerId } from './select.ts';
import { signBody, signatureHex, verifySignature } from './signature.ts';

const SECRET = 'unit-test-notification-secret';
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const BODY = JSON.stringify({ event_id: 'evt_1', event_type: 'subscription.created' });

describe('webhook signatures (R-SEC-007)', () => {
  it('R-SEC-007 a correctly signed body verifies', async () => {
    const header = await signBody(SECRET, BODY, NOW);
    expect(header).toMatch(/^ts=\d+;h1=[0-9a-f]{64}$/);
    expect(await verifySignature(header, BODY, SECRET, NOW)).toEqual({
      ok: true,
      ts: Math.floor(NOW / 1000),
    });
  });

  it('R-SEC-007 a tampered body, a wrong secret or a forged signature is rejected', async () => {
    const header = await signBody(SECRET, BODY, NOW);
    const tampered = BODY.replace('evt_1', 'evt_2');
    expect(await verifySignature(header, tampered, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(await verifySignature(header, BODY, 'another-secret', NOW)).toMatchObject({
      ok: false,
      reason: 'mismatch',
    });
    const ts = Math.floor(NOW / 1000);
    const forged = `ts=${ts};h1=${'0'.repeat(64)}`;
    expect((await verifySignature(forged, BODY, SECRET, NOW)).ok).toBe(false);
    // The timestamp is part of what is signed: moving it breaks the signature.
    const moved = header.replace(`ts=${ts}`, `ts=${ts + 1}`);
    expect(await verifySignature(moved, BODY, SECRET, NOW)).toMatchObject({ reason: 'mismatch' });
  });

  it('R-SEC-007 a missing or malformed header is rejected', async () => {
    expect(await verifySignature(null, BODY, SECRET, NOW)).toMatchObject({ reason: 'missing' });
    for (const h of ['garbage', 'ts=1', 'h1=abc', 'ts=abc;h1=00', `ts=1;h1=${'z'.repeat(64)}`]) {
      expect(await verifySignature(h, BODY, SECRET, NOW), h).toMatchObject({ reason: 'malformed' });
    }
  });

  it('R-SEC-007 a signature older (or newer) than 5 minutes is stale: no late replays', async () => {
    const old = await signBody(SECRET, BODY, NOW - 5 * 60_000 - 1000);
    expect(await verifySignature(old, BODY, SECRET, NOW)).toMatchObject({ reason: 'stale' });
    const future = await signBody(SECRET, BODY, NOW + 5 * 60_000 + 1000);
    expect(await verifySignature(future, BODY, SECRET, NOW)).toMatchObject({ reason: 'stale' });
    const recent = await signBody(SECRET, BODY, NOW - 4 * 60_000);
    expect((await verifySignature(recent, BODY, SECRET, NOW)).ok).toBe(true);
  });

  it('R-SEC-007 during a secret rotation any listed h1 may match', async () => {
    const ts = Math.floor(NOW / 1000);
    const good = await signatureHex(SECRET, ts, BODY);
    const other = await signatureHex('old-secret', ts, BODY);
    expect((await verifySignature(`ts=${ts};h1=${other};h1=${good}`, BODY, SECRET, NOW)).ok).toBe(
      true,
    );
  });
});

/** A Paddle Billing `subscription.*` notification as Paddle documents it (trimmed). */
function paddleSubscription(over: Record<string, unknown> = {}, type = 'subscription.created') {
  return JSON.stringify({
    event_id: 'evt_01hv8x2acma2gz3he3f4bkx5cx',
    event_type: type,
    occurred_at: '2026-09-25T10:18:49.621022Z',
    notification_id: 'ntf_01hv8x2af2zqj7c0y0x3gpn9x0',
    data: {
      id: 'sub_01hv8x29kz0t586xy6zn1a62ny',
      items: [{ price: { id: 'pri_month', product_id: 'pro_1' }, status: 'active', quantity: 1 }],
      status: 'active',
      paused_at: null,
      address_id: 'add_01hv8gq3318ktkfengj2r75gfx',
      created_at: '2026-09-25T10:18:47.635628Z',
      started_at: '2026-09-25T10:18:47.635628Z',
      updated_at: '2026-09-25T10:18:47.635628Z',
      canceled_at: null,
      custom_data: { player_id: 'player-1' },
      customer_id: 'ctm_01hv6y1jedq4p1n0yqn5ba3ky4',
      billing_cycle: { interval: 'month', frequency: 1 },
      currency_code: 'USD',
      next_billed_at: '2026-10-25T10:18:47.635628Z',
      collection_mode: 'automatic',
      scheduled_change: null,
      current_billing_period: {
        starts_at: '2026-09-25T10:18:47.635628Z',
        ends_at: '2026-10-25T10:18:47.635628Z',
      },
      ...over,
    },
  });
}

const prices = (id: string) => (id === 'pri_month' ? 'monthly' : null);

describe('Paddle event mapping (R-SEC-007, R-COST-005)', () => {
  it('R-SEC-007 subscription.created: active until the billing period ends, player from custom_data', () => {
    const r = parseEvent(paddleSubscription(), prices);
    expect(r).toEqual({
      ok: true,
      event: {
        id: 'evt_01hv8x2acma2gz3he3f4bkx5cx',
        type: 'subscription.created',
        occurredAt: Date.parse('2026-09-25T10:18:49.621Z'),
        playerId: 'player-1',
        customerId: 'ctm_01hv6y1jedq4p1n0yqn5ba3ky4',
        subscriptionId: 'sub_01hv8x29kz0t586xy6zn1a62ny',
        plan: 'monthly',
        subStatus: 'active',
        paidUntil: Date.parse('2026-10-25T10:18:47.635Z'),
        cancelAt: null,
      },
    });
  });

  it('R-SEC-007 statuses map to entitlement: past_due, scheduled cancel, canceled, paused, trialing', () => {
    const ev = (over: Record<string, unknown>, type?: string) => {
      const r = parseEvent(paddleSubscription(over, type), prices);
      if (!r.ok || !r.event) throw new Error('not parsed');
      return r.event;
    };
    expect(ev({ status: 'past_due' }, 'subscription.past_due')).toMatchObject({
      subStatus: 'past_due',
      paidUntil: Date.parse('2026-10-25T10:18:47.635Z'),
    });
    expect(
      ev({ scheduled_change: { action: 'cancel', effective_at: '2026-10-25T10:18:47Z' } }),
    ).toMatchObject({ subStatus: 'active', cancelAt: Date.parse('2026-10-25T10:18:47Z') });
    expect(
      ev(
        {
          status: 'canceled',
          canceled_at: '2026-10-25T10:18:47Z',
          current_billing_period: null,
          scheduled_change: null,
        },
        'subscription.canceled',
      ),
    ).toMatchObject({ subStatus: 'canceled', paidUntil: Date.parse('2026-10-25T10:18:47Z') });
    expect(
      ev({ status: 'paused', current_billing_period: null }, 'subscription.paused'),
    ).toMatchObject({ subStatus: 'paused', paidUntil: null });
    expect(ev({ status: 'trialing' }, 'subscription.trialing')).toMatchObject({
      subStatus: 'active',
    });
    expect(ev({ items: [{ price: { id: 'pri_other' } }] }).plan).toBeNull();
    expect(ev({ custom_data: null }).playerId).toBeNull();
  });

  it('R-SEC-007 transaction.completed extends the subscription; other events are acknowledged only', () => {
    const txn = JSON.stringify({
      event_id: 'evt_txn',
      event_type: 'transaction.completed',
      occurred_at: '2026-09-25T10:18:50Z',
      data: {
        id: 'txn_1',
        status: 'completed',
        customer_id: 'ctm_1',
        subscription_id: 'sub_1',
        custom_data: { player_id: 'player-1' },
        items: [{ price_id: 'pri_month', price: { id: 'pri_month' }, quantity: 1 }],
        billing_period: { starts_at: '2026-09-25T10:18:47Z', ends_at: '2026-10-25T10:18:47Z' },
      },
    });
    const r = parseEvent(txn, prices);
    expect(r.ok && r.event).toMatchObject({
      subStatus: 'active',
      paidUntil: Date.parse('2026-10-25T10:18:47Z'),
      subscriptionId: 'sub_1',
      plan: 'monthly',
    });
    expect(r.ok && r.event && 'cancelAt' in r.event).toBe(false);
    const oneOff = txn.replace('"subscription_id":"sub_1"', '"subscription_id":null');
    expect(parseEvent(oneOff, prices)).toEqual({ ok: true, event: null });
    const other = JSON.stringify({
      event_id: 'evt_x',
      event_type: 'customer.updated',
      occurred_at: '2026-09-25T10:18:50Z',
      data: { id: 'ctm_1' },
    });
    expect(parseEvent(other, prices)).toEqual({ ok: true, event: null });
  });

  it('R-SEC-007 malformed payloads are refused', () => {
    expect(parseEvent('not json', prices).ok).toBe(false);
    expect(parseEvent('{}', prices).ok).toBe(false);
    expect(parseEvent(paddleSubscription({ status: 'weird' }), prices).ok).toBe(false);
    expect(parseEvent(paddleSubscription({ id: 42 }), prices).ok).toBe(false);
    const badTime = paddleSubscription().replace('2026-09-25T10:18:49.621022Z', 'yesterday');
    expect(parseEvent(badTime, prices).ok).toBe(false);
  });

  it('parses RFC 3339 times with microseconds and offsets', () => {
    expect(parseTime('2026-09-25T10:18:49.621022Z')).toBe(Date.UTC(2026, 8, 25, 10, 18, 49, 621));
    expect(parseTime('2026-09-25T10:18:49Z')).toBe(Date.UTC(2026, 8, 25, 10, 18, 49));
    expect(parseTime('2026-09-25T12:18:49+02:00')).toBe(Date.UTC(2026, 8, 25, 10, 18, 49));
    expect(parseTime('2026-09-25')).toBeNull();
  });
});

describe('plans (14.3)', () => {
  it('R-COST-004 the plans are $4 monthly, $11 quarterly and $40 yearly', () => {
    expect(Object.values(PLANS).map((p) => [p.id, p.priceCents, p.months])).toEqual([
      ['monthly', 400, 1],
      ['quarterly', 1100, 3],
      ['yearly', 4000, 12],
    ]);
  });

  it('billing periods add calendar months and clamp to the month end', () => {
    expect(addMonths(Date.UTC(2026, 0, 31, 9), 1)).toBe(Date.UTC(2026, 1, 28, 9));
    expect(addMonths(Date.UTC(2028, 0, 31), 1)).toBe(Date.UTC(2028, 1, 29));
    expect(addMonths(Date.UTC(2026, 10, 15), 3)).toBe(Date.UTC(2027, 1, 15));
    expect(addMonths(Date.UTC(2026, 8, 25), 12)).toBe(Date.UTC(2027, 8, 25));
  });
});

describe('provider selection', () => {
  const env = (over: Partial<Env>): Env =>
    ({ APP_ORIGIN: 'https://chaintheorem.example', AUTH_SECRET: 'x', ...over }) as Env;

  it('R-SEC-007 Paddle with both keys; the fake only locally or when allowed; otherwise none', () => {
    expect(providerId(env({ PADDLE_API_KEY: 'k', PADDLE_WEBHOOK_SECRET: 's' }))).toBe('paddle');
    expect(providerId(env({ PADDLE_API_KEY: 'k' }))).toBe('none');
    expect(providerId(env({}))).toBe('none');
    expect(providerId(env({ FAKE_BILLING: 'on' }))).toBe('fake');
    expect(providerId(env({ APP_ORIGIN: 'http://localhost:5173' }))).toBe('fake');
    expect(providerId(env({ APP_ORIGIN: 'http://127.0.0.1:8788' }))).toBe('fake');
    expect(isLocalOrigin('https://localhost')).toBe(false);
    expect(isLocalOrigin('http://localhost.evil.example')).toBe(false);
  });
});
