/**
 * Which `BillingProvider` this deployment uses (ARCHITECTURE 6):
 * - Paddle when PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET are both set (sandbox unless
 *   PADDLE_ENV=production).
 * - Otherwise the fake provider, but only on a local origin (http://localhost, 127.0.0.1, [::1]) or
 *   with FAKE_BILLING=on (a preview deployment). A production Worker that is missing its Paddle keys
 *   therefore sells nothing instead of handing out free subscriptions (DD).
 * - Otherwise none: checkout answers 503 `billing_unavailable`.
 */
import type { BillingProviderId, PlanId } from '@chain-theorem/protocol';
import { hmac } from '../auth/crypto.ts';
import type { Env } from '../env.ts';
import { FakeBillingProvider } from './fake.ts';
import { PaddleBillingProvider } from './paddle.ts';
import type { BillingProvider } from './provider.ts';

export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export function providerId(env: Env): BillingProviderId {
  if (env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET) return 'paddle';
  if (env.FAKE_BILLING === 'on' || isLocalOrigin(env.APP_ORIGIN)) return 'fake';
  return 'none';
}

/** The fake provider's signing key: FAKE_BILLING_SECRET, or one derived from AUTH_SECRET. */
export async function fakeSecret(env: Env): Promise<string> {
  return env.FAKE_BILLING_SECRET ?? (await hmac(env.AUTH_SECRET, 'fake-billing-webhook-v1'));
}

export function paddlePrices(env: Env): Partial<Record<PlanId, string>> {
  const out: Partial<Record<PlanId, string>> = {};
  if (env.PADDLE_PRICE_MONTHLY) out.monthly = env.PADDLE_PRICE_MONTHLY;
  if (env.PADDLE_PRICE_QUARTERLY) out.quarterly = env.PADDLE_PRICE_QUARTERLY;
  if (env.PADDLE_PRICE_YEARLY) out.yearly = env.PADDLE_PRICE_YEARLY;
  return out;
}

let logged: BillingProviderId | null = null;

/**
 * The provider, or null when billing is not configured. `deliver` hands the fake provider's signed
 * webhooks to the Worker's own webhook handler.
 */
export async function billingProvider(
  env: Env,
  deliver: (req: Request) => Promise<Response>,
): Promise<BillingProvider | null> {
  const id = providerId(env);
  if (logged !== id) {
    logged = id;
    console.log(
      JSON.stringify({
        billing: id,
        ...(id === 'paddle'
          ? { env: env.PADDLE_ENV === 'production' ? 'production' : 'sandbox' }
          : {}),
      }),
    );
  }
  if (id === 'paddle') {
    return new PaddleBillingProvider({
      apiKey: env.PADDLE_API_KEY as string,
      webhookSecret: env.PADDLE_WEBHOOK_SECRET as string,
      env: env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
      prices: paddlePrices(env),
      origin: env.APP_ORIGIN,
      clientToken: env.PADDLE_CLIENT_TOKEN,
    });
  }
  if (id === 'fake') {
    return new FakeBillingProvider({
      secret: await fakeSecret(env),
      origin: env.APP_ORIGIN,
      deliver,
    });
  }
  return null;
}
