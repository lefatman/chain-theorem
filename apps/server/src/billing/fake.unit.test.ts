/**
 * `FakeBillingProvider`: checkout sessions, and the Paddle-shaped signed events it delivers for a
 * payment, a renewal, a failed payment, a cancel and a resume (R-SEC-007).
 */
import { describe, expect, it } from 'vitest';
import type { BillingEvent } from './events.ts';
import { FAKE_SESSION_TTL_MS, FakeBillingProvider } from './fake.ts';
import { addMonths } from './plans.ts';

const NOW = Date.UTC(2026, 8, 25, 12);

/** A fake provider whose deliveries are verified by a second instance with the same secret. */
function setup(secret = 'fake-secret') {
  const delivered: BillingEvent[] = [];
  const raw: string[] = [];
  const receiver = new FakeBillingProvider({
    secret,
    origin: 'http://localhost',
    deliver: async () => new Response(null, { status: 500 }),
  });
  const fake = new FakeBillingProvider({
    secret,
    origin: 'http://localhost',
    deliver: async (req) => {
      expect(new URL(req.url).pathname).toBe('/api/billing/webhook');
      const body = await req.text();
      raw.push(body);
      const check = await receiver.verifyWebhook(body, req.headers, NOW);
      if (!check.ok) return new Response(null, { status: 401 });
      if (check.event) delivered.push(check.event);
      return new Response('{}', { status: 200 });
    },
  });
  return { fake, delivered, raw };
}

describe('FakeBillingProvider (R-SEC-007)', () => {
  it('R-SEC-007 checkout links are signed, bound to the player and plan, and expire', async () => {
    const { fake } = setup();
    const { url } = await fake.checkout({
      plan: 'yearly',
      playerId: 'p1',
      customerId: null,
      now: NOW,
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('http://localhost/api/billing/fake/checkout');
    const token = u.searchParams.get('session') ?? '';
    expect(await fake.openSession(token, NOW)).toMatchObject({ playerId: 'p1', plan: 'yearly' });
    expect(await fake.openSession(token, NOW + FAKE_SESSION_TTL_MS + 1)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = `${body?.slice(0, -2)}AA.${sig}`;
    expect(await fake.openSession(forged, NOW)).toBeNull();
    const other = new FakeBillingProvider({
      secret: 'another',
      origin: 'http://localhost',
      deliver: async () => new Response(null),
    });
    expect(await other.openSession(token, NOW)).toBeNull();
  });

  it('R-SEC-007 paying delivers a signed subscription.created and transaction.completed', async () => {
    const { fake, delivered, raw } = setup();
    const { url } = await fake.checkout({
      plan: 'monthly',
      playerId: 'p1',
      customerId: null,
      now: NOW,
    });
    const session = await fake.openSession(new URL(url).searchParams.get('session') ?? '', NOW);
    await fake.pay(session!, null, NOW);
    expect(delivered.map((e) => e.type)).toEqual(['subscription.created', 'transaction.completed']);
    for (const e of delivered) {
      expect(e).toMatchObject({
        playerId: 'p1',
        plan: 'monthly',
        subStatus: 'active',
        paidUntil: addMonths(NOW, 1),
        subscriptionId: `sub_fake_${session!.nonce}`,
      });
    }
    // Paying twice produces the same event ids (the database then drops the repeat).
    await fake.pay(session!, null, NOW);
    expect(delivered.slice(2).map((e) => e.id)).toEqual(delivered.slice(0, 2).map((e) => e.id));
    // Paddle's shape: the parser reads exactly what a real notification carries.
    expect(JSON.parse(raw[0]!)).toMatchObject({
      event_type: 'subscription.created',
      data: { custom_data: { player_id: 'p1' }, items: [{ price: { id: 'pri_fake_monthly' } }] },
    });
  });

  it('R-SEC-007 renew, fail a payment, cancel at period end, resume and cancel now', async () => {
    const { fake, delivered } = setup();
    const ref = {
      playerId: 'p1',
      subscriptionId: 'sub_fake_x',
      customerId: 'ctm_fake_x',
      plan: 'quarterly' as const,
      paidUntil: NOW + 1000,
    };
    await fake.renew(ref, NOW);
    expect(delivered.at(-1)).toMatchObject({
      type: 'transaction.completed',
      subStatus: 'active',
      paidUntil: addMonths(NOW + 1000, 3),
    });
    await fake.failPayment(ref, NOW);
    expect(delivered.at(-1)).toMatchObject({ subStatus: 'past_due', paidUntil: NOW + 1000 });
    await fake.cancel(ref, 'period_end', NOW);
    expect(delivered.at(-1)).toMatchObject({ subStatus: 'active', cancelAt: NOW + 1000 });
    await fake.resume(ref, NOW);
    expect(delivered.at(-1)).toMatchObject({ subStatus: 'active', cancelAt: null });
    await fake.cancel(ref, 'now', NOW);
    expect(delivered.at(-1)).toMatchObject({ subStatus: 'canceled', paidUntil: NOW });
  });

  it('R-SEC-007 a delivery refused by the endpoint is an error, not a silent success', async () => {
    const fake = new FakeBillingProvider({
      secret: 's',
      origin: 'http://localhost',
      deliver: async () => new Response(null, { status: 401 }),
    });
    await expect(
      fake.renew(
        { playerId: 'p', subscriptionId: 's', customerId: null, plan: null, paidUntil: null },
        NOW,
      ),
    ).rejects.toThrow(/401/);
  });
});
