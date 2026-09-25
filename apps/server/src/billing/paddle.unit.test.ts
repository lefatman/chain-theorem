/**
 * `PaddleBillingProvider` against a mocked `fetch` (Paddle Billing API v1) with real signatures
 * computed here (R-SEC-007). Real sandbox calls need a human's keys (DEPLOY.md 5).
 */
import { describe, expect, it } from 'vitest';
import { PADDLE_API, PaddleBillingProvider, type PaddleConfig } from './paddle.ts';
import { BillingProviderError } from './provider.ts';
import { signBody, signatureHex } from './signature.ts';

const NOW = Date.UTC(2026, 8, 25, 12);
const WEBHOOK_SECRET = 'unit-test-webhook-secret';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(answer: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const a = answer(call);
    return new Response(JSON.stringify(a.json), {
      status: a.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { f, calls };
}

function provider(over: Partial<PaddleConfig> = {}, f?: typeof fetch) {
  return new PaddleBillingProvider({
    apiKey: 'pdl_sdbx_apikey_unit_test_key',
    webhookSecret: WEBHOOK_SECRET,
    env: 'sandbox',
    prices: { monthly: 'pri_m', quarterly: 'pri_q', yearly: 'pri_y' },
    origin: 'https://game.example',
    clientToken: 'test_client_token',
    ...(f ? { fetch: f } : {}),
    ...over,
  });
}

describe('PaddleBillingProvider (R-SEC-007)', () => {
  it('R-SEC-007 checkout creates a transaction with the price id and the player in custom_data', async () => {
    const { f, calls } = mockFetch(() => ({
      status: 201,
      json: {
        data: {
          id: 'txn_01',
          status: 'ready',
          checkout: { url: 'https://game.example/api/billing/paddle/pay?_ptxn=txn_01' },
        },
      },
    }));
    const p = provider({}, f);
    const r = await p.checkout({
      plan: 'quarterly',
      playerId: 'player-7',
      customerId: null,
      now: NOW,
    });
    expect(r.url).toBe('https://game.example/api/billing/paddle/pay?_ptxn=txn_01');
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe(`${PADDLE_API.sandbox}/transactions`);
    expect(c.method).toBe('POST');
    expect(c.headers.authorization).toBe('Bearer pdl_sdbx_apikey_unit_test_key');
    expect(c.body).toEqual({
      items: [{ price_id: 'pri_q', quantity: 1 }],
      custom_data: { player_id: 'player-7' },
      collection_mode: 'automatic',
      checkout: { url: 'https://game.example/api/billing/paddle/pay' },
    });
  });

  it('live mode uses the live API; a known customer is reused; no client token uses the default link', async () => {
    const { f, calls } = mockFetch(() => ({
      status: 201,
      json: { data: { id: 'txn_02', checkout: { url: 'https://pay.example/?_ptxn=txn_02' } } },
    }));
    const p = provider({ env: 'production', clientToken: undefined }, f);
    await p.checkout({ plan: 'monthly', playerId: 'p', customerId: 'ctm_9', now: NOW });
    expect(calls[0]?.url).toBe(`${PADDLE_API.production}/transactions`);
    expect(calls[0]?.body).toMatchObject({ customer_id: 'ctm_9' });
    expect(calls[0]?.body).not.toHaveProperty('checkout');
  });

  it('only plans with a configured price are sold', () => {
    expect(provider({ prices: { yearly: 'pri_y' } }).plans()).toEqual(['yearly']);
  });

  it('Paddle errors surface as BillingProviderError without the key', async () => {
    const { f } = mockFetch(() => ({
      status: 403,
      json: { error: { type: 'request_error', code: 'forbidden', detail: 'no permission' } },
    }));
    const err = await provider({}, f)
      .checkout({ plan: 'monthly', playerId: 'p', customerId: null, now: NOW })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect(String(err)).toContain('forbidden');
    expect(String(err)).not.toContain('pdl_sdbx_apikey');
    const noUrl = mockFetch(() => ({ status: 201, json: { data: { checkout: { url: null } } } }));
    await expect(
      provider({}, noUrl.f).checkout({
        plan: 'monthly',
        playerId: 'p',
        customerId: null,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BillingProviderError);
  });

  it('cancel, resume and the portal call the documented endpoints', async () => {
    const { f, calls } = mockFetch((c) =>
      c.url.endsWith('/portal-sessions')
        ? {
            status: 201,
            json: {
              data: { urls: { general: { overview: 'https://customer-portal.paddle.com/x' } } },
            },
          }
        : { status: 200, json: { data: { id: 'sub_1' } } },
    );
    const p = provider({}, f);
    const ref = {
      playerId: 'p',
      subscriptionId: 'sub_1',
      customerId: 'ctm_1',
      plan: 'monthly' as const,
      paidUntil: NOW,
    };
    await p.cancel(ref, 'period_end');
    await p.cancel(ref, 'now');
    await p.resume(ref);
    expect(await p.portal(ref)).toBe('https://customer-portal.paddle.com/x');
    expect(calls.map((c) => [c.method, c.url.replace(PADDLE_API.sandbox, ''), c.body])).toEqual([
      ['POST', '/subscriptions/sub_1/cancel', { effective_from: 'next_billing_period' }],
      ['POST', '/subscriptions/sub_1/cancel', { effective_from: 'immediately' }],
      ['PATCH', '/subscriptions/sub_1', { scheduled_change: null }],
      ['POST', '/customers/ctm_1/portal-sessions', { subscription_ids: ['sub_1'] }],
    ]);
  });

  it('R-SEC-007 webhooks: a real Paddle-Signature verifies and maps; tampered, stale and unsigned do not', async () => {
    const p = provider();
    const body = JSON.stringify({
      event_id: 'evt_01',
      event_type: 'subscription.activated',
      occurred_at: '2026-09-25T11:59:00.123456Z',
      notification_id: 'ntf_01',
      data: {
        id: 'sub_1',
        status: 'active',
        customer_id: 'ctm_1',
        custom_data: { player_id: 'player-7' },
        items: [{ price: { id: 'pri_y' }, quantity: 1 }],
        current_billing_period: {
          starts_at: '2026-09-25T11:59:00Z',
          ends_at: '2027-09-25T11:59:00Z',
        },
        scheduled_change: null,
        canceled_at: null,
      },
    });
    const ts = Math.floor(NOW / 1000);
    const header = `ts=${ts};h1=${await signatureHex(WEBHOOK_SECRET, ts, body)}`;
    const ok = await p.verifyWebhook(body, new Headers({ 'paddle-signature': header }), NOW);
    expect(ok).toMatchObject({
      ok: true,
      event: {
        id: 'evt_01',
        playerId: 'player-7',
        plan: 'yearly',
        subStatus: 'active',
        paidUntil: Date.parse('2027-09-25T11:59:00Z'),
      },
    });
    const tampered = body.replace('player-7', 'player-8');
    expect(
      await p.verifyWebhook(tampered, new Headers({ 'paddle-signature': header }), NOW),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await p.verifyWebhook(body, new Headers(), NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const stale = await signBody(WEBHOOK_SECRET, body, NOW - 10 * 60_000);
    expect(await p.verifyWebhook(body, new Headers({ 'paddle-signature': stale }), NOW)).toEqual({
      ok: false,
      reason: 'stale_signature',
    });
    const bad = '{"event_id":1}';
    const badSig = await signBody(WEBHOOK_SECRET, bad, NOW);
    expect(await p.verifyWebhook(bad, new Headers({ 'paddle-signature': badSig }), NOW)).toEqual({
      ok: false,
      reason: 'bad_payload',
    });
  });
});
