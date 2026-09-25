/**
 * `PaddleBillingProvider` (DD-07; Paddle Billing API v1, sandbox or live by PADDLE_ENV).
 *
 * - Checkout: `POST /transactions` with the plan's price id and `custom_data.player_id`; the
 *   transaction's `checkout.url` is where the player pays. With PADDLE_CLIENT_TOKEN set, the URL is
 *   our own `/api/billing/paddle/pay` page (Paddle.js opens the overlay checkout for `_ptxn`);
 *   otherwise Paddle uses the default payment link configured in its dashboard.
 * - Webhooks: `Paddle-Signature` verified against the notification destination's secret
 *   (signature.ts), then events.ts maps subscription and transaction events.
 * - Cancel: `POST /subscriptions/{id}/cancel` (at the end of the billing period, or immediately when
 *   the account is deleted). Portal: `POST /customers/{id}/portal-sessions`.
 *
 * Only API keys from Worker secrets (R-SEC-009). Real sandbox calls need a human's keys; the unit
 * tests run this class against a mocked `fetch` with real signatures.
 */
import { PLAN_IDS, type PlanId } from '@chain-theorem/protocol';
import { parseEvent } from './events.ts';
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutInput,
  type SubscriptionRef,
  type WebhookCheck,
} from './provider.ts';
import { SIGNATURE_HEADER, verifySignature } from './signature.ts';

export const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  env: 'sandbox' | 'production';
  /** Price ids per plan (PADDLE_PRICE_MONTHLY, _QUARTERLY, _YEARLY). */
  prices: Partial<Record<PlanId, string>>;
  /** The app's origin (the pay page). */
  origin: string;
  /** Paddle.js client-side token; when set, checkout opens on our own pay page. */
  clientToken?: string | undefined;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

interface PaddleError {
  error?: { type?: string; code?: string; detail?: string };
}

export class PaddleBillingProvider implements BillingProvider {
  readonly id = 'paddle' as const;
  private readonly cfg: PaddleConfig;

  constructor(cfg: PaddleConfig) {
    this.cfg = cfg;
  }

  get baseUrl(): string {
    return PADDLE_API[this.cfg.env];
  }

  plans(): PlanId[] {
    return PLAN_IDS.filter((p) => Boolean(this.cfg.prices[p]));
  }

  private planOfPrice = (priceId: string): PlanId | null =>
    PLAN_IDS.find((p) => this.cfg.prices[p] === priceId) ?? null;

  private async api<T>(method: string, path: string, body: unknown): Promise<T> {
    const f = this.cfg.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
          'paddle-version': '1',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new BillingProviderError(`paddle ${method} ${path}: ${String(e)}`);
    }
    const data = (await res.json().catch(() => null)) as (T & PaddleError) | null;
    if (!res.ok || data === null) {
      // Log Paddle's error code and detail (never the key) for the operator.
      const err = data?.error;
      throw new BillingProviderError(
        `paddle ${method} ${path}: ${res.status} ${err?.code ?? ''} ${err?.detail ?? ''}`.trim(),
      );
    }
    return data;
  }

  async checkout(input: CheckoutInput): Promise<{ url: string }> {
    const price = this.cfg.prices[input.plan];
    if (!price) throw new BillingProviderError(`no Paddle price id for ${input.plan}`);
    const body: Record<string, unknown> = {
      items: [{ price_id: price, quantity: 1 }],
      custom_data: { player_id: input.playerId },
      collection_mode: 'automatic',
    };
    if (input.customerId) body.customer_id = input.customerId;
    if (this.cfg.clientToken) body.checkout = { url: `${this.cfg.origin}/api/billing/paddle/pay` };
    const r = await this.api<{ data?: { id?: string; checkout?: { url?: string | null } } }>(
      'POST',
      '/transactions',
      body,
    );
    const url = r.data?.checkout?.url;
    if (!url || !/^https:\/\//.test(url))
      throw new BillingProviderError(
        'paddle transaction has no checkout URL: set PADDLE_CLIENT_TOKEN or a default payment link',
      );
    return { url };
  }

  async verifyWebhook(rawBody: string, headers: Headers, now: number): Promise<WebhookCheck> {
    const sig = await verifySignature(
      headers.get(SIGNATURE_HEADER),
      rawBody,
      this.cfg.webhookSecret,
      now,
    );
    if (!sig.ok)
      return { ok: false, reason: sig.reason === 'stale' ? 'stale_signature' : 'bad_signature' };
    const parsed = parseEvent(rawBody, this.planOfPrice);
    return parsed.ok ? { ok: true, event: parsed.event } : { ok: false, reason: 'bad_payload' };
  }

  async cancel(sub: SubscriptionRef, when: 'period_end' | 'now'): Promise<void> {
    await this.api('POST', `/subscriptions/${encodeURIComponent(sub.subscriptionId)}/cancel`, {
      effective_from: when === 'now' ? 'immediately' : 'next_billing_period',
    });
  }

  async resume(sub: SubscriptionRef): Promise<void> {
    // Removing the scheduled change keeps the subscription renewing (Paddle: PATCH, null change).
    await this.api('PATCH', `/subscriptions/${encodeURIComponent(sub.subscriptionId)}`, {
      scheduled_change: null,
    });
  }

  async portal(sub: SubscriptionRef): Promise<string> {
    if (!sub.customerId) throw new BillingProviderError('no Paddle customer for this player');
    const r = await this.api<{ data?: { urls?: { general?: { overview?: string } } } }>(
      'POST',
      `/customers/${encodeURIComponent(sub.customerId)}/portal-sessions`,
      { subscription_ids: [sub.subscriptionId] },
    );
    const url = r.data?.urls?.general?.overview;
    if (!url || !/^https:\/\//.test(url))
      throw new BillingProviderError('paddle portal session has no URL');
    return url;
  }
}
