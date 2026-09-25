/**
 * Account and subscription (M6 6.3; spec 14.3, 14.4): the trial's days left or the subscription's
 * state and renewal date, the three plans, Subscribe (opens the provider's checkout; the fake
 * checkout returns here), cancel and resume, the provider's portal, and the account's data (export,
 * delete; R-SEC-010). Access itself is always the server's answer (R-SEC-007).
 *
 * Also the "play is refused" views: `PlayLocked` on the online screen and `SubscribeRequired` for
 * the world, shown when the trial or subscription has ended.
 */
import { useEffect, useState } from 'preact/hooks';
import type { AccessView, BillingPlans, PlanId, SubscriptionView } from '@chain-theorem/protocol';
import { go, route } from '../app/router.ts';
import { ApiError, api, type Me } from '../net/api.ts';
import { account, refreshAccount, signOut } from '../state/account.ts';
import {
  accessText,
  billingErrorText,
  formatDate,
  lockedTitle,
  perMonthText,
  priceText,
} from './billingText.ts';

const errText = (e: unknown) => billingErrorText(e instanceof ApiError ? e.code : 'error');

/** A short line about the account's access for the online screen (nothing for subscribers). */
export function AccessBanner({ access }: { access: AccessView }) {
  if (access.status === 'subscriber' && access.subStatus !== 'past_due') return null;
  const { text, tone } = accessText(access, Date.now());
  return (
    <p class={`access-banner ${tone}`} role={tone === 'alert' ? 'alert' : 'status'}>
      {text}{' '}
      <button class="small" onClick={() => go('account')}>
        {access.status === 'trial' ? 'See plans' : 'Manage subscription'}
      </button>
    </p>
  );
}

/** The trial or subscription has ended: what the player can still do, and the way back in. */
function LockedPanel({ access }: { access: AccessView }) {
  return (
    <section class="access-locked" role="alert" aria-labelledby="locked-h">
      <h3 id="locked-h">{lockedTitle(access)}</h3>
      <p>
        Online play (the world, battles and queues) needs a subscription. You can still sign in, see
        your account, and download or delete your data.
      </p>
      <p class="muted small-text">
        One subscription unlocks everything that affects play; nothing is sold for power.
      </p>
      <button class="primary" onClick={() => go('account')}>
        See plans and subscribe
      </button>
    </section>
  );
}

/** The online screen when play is refused; battles already started can still be finished. */
export function PlayLocked({
  me,
  active,
  onRejoin,
}: {
  me: Me;
  active: { id: string; format: string; opponent: string }[];
  onRejoin: (battleId: string) => void;
}) {
  return (
    <main class="setup">
      <h2>Online play</h2>
      <p>
        Signed in as <strong>{me.name}</strong> · level {me.level}{' '}
        <button onClick={() => void signOut()}>Sign out</button>
      </p>
      <LockedPanel access={me.access} />
      {active.length > 0 && (
        <section aria-label="Battles in progress">
          <h3>Battles in progress</h3>
          {active.map((b) => (
            <button key={b.id} class="primary" onClick={() => onRejoin(b.id)}>
              Finish your battle vs {b.opponent}
            </button>
          ))}
        </section>
      )}
      <div class="row start">
        <button onClick={() => go('account')}>Account and subscription</button>
        <button onClick={() => go('title')}>Back</button>
      </div>
    </main>
  );
}

/** The world when play is refused. */
export function SubscribeRequired({ access }: { access: AccessView }) {
  return (
    <main class="setup">
      <h2>The world</h2>
      <LockedPanel access={access} />
      <div class="row start">
        <button onClick={() => go('online')}>Online play</button>
        <button onClick={() => go('title')}>Back</button>
      </div>
    </main>
  );
}

export function AccountScreen() {
  const acc = account.value;
  const checkout = route.value.params.get('checkout');
  const [plans, setPlans] = useState<BillingPlans | null>(null);
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const signedIn = acc.kind === 'signed_in';

  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);

  useEffect(() => {
    api.billingPlans().then(setPlans, () => setPlans(null));
  }, []);

  const reload = async (): Promise<SubscriptionView> => {
    const s = await api.subscription();
    setSub(s);
    await refreshAccount();
    return s;
  };

  useEffect(() => {
    if (!signedIn) return;
    reload().catch((e: unknown) => setError(errText(e)));
  }, [signedIn]);

  // After paying, the provider's webhook can land a moment after the redirect: check a few times.
  useEffect(() => {
    if (!signedIn || checkout !== 'success') return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const s = await reload().catch(() => null);
      if (stopped || s?.access.status === 'subscriber' || ++tries >= 15) return;
      timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [signedIn, checkout]);

  if (acc.kind === 'unknown')
    return (
      <main class="setup">
        <p>Connecting…</p>
      </main>
    );
  if (acc.kind !== 'signed_in')
    return (
      <main class="setup">
        <h2>Account</h2>
        <p>
          {acc.kind === 'offline'
            ? 'The server cannot be reached. Local play still works.'
            : 'Sign in to see your account and subscription.'}
        </p>
        {acc.kind === 'signed_out' && (
          <button class="primary" onClick={() => go('login')}>
            Sign in
          </button>
        )}
        <button onClick={() => go('title')}>Back</button>
      </main>
    );

  const me = acc.me;
  const access = sub?.access ?? me.access;
  const planName =
    sub?.plan && plans ? (plans.plans.find((p) => p.id === sub.plan)?.name ?? null) : null;
  const cancelAt = sub?.cancelAt ?? null;
  const status = accessText(access, Date.now(), { cancelAt, planName });
  const live = access.status === 'subscriber' && ['active', 'past_due'].includes(access.subStatus);
  const canBuy = !live;

  const act = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const subscribe = (plan: PlanId) =>
    act(`buy:${plan}`, async () => {
      const { url } = await api.checkout(plan);
      location.assign(url);
    });

  return (
    <main class="setup account">
      <h2>Account</h2>
      <p>
        Signed in as <strong>{me.name}</strong> · level {me.level}
      </p>
      {checkout === 'success' &&
        (access.status === 'subscriber' ? (
          <p class="note ok" role="status">
            Thank you! Your subscription is active.
          </p>
        ) : (
          <p class="note" role="status">
            Payment received. Waiting for the payment provider to confirm it…
          </p>
        ))}
      {checkout === 'canceled' && (
        <p class="note" role="status">
          Checkout canceled. Nothing was charged.
        </p>
      )}
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}

      <section class="panel" aria-labelledby="sub-h">
        <h3 id="sub-h">Subscription</h3>
        <p
          class={`access-status ${status.tone}`}
          role={status.tone === 'alert' ? 'alert' : undefined}
        >
          {status.text}
        </p>
        {live && (
          <div class="row start">
            {cancelAt ? (
              <button
                disabled={busy !== null}
                onClick={() =>
                  act('resume', async () => {
                    setSub(await api.resumeSubscription());
                    await refreshAccount();
                  })
                }
              >
                Keep my subscription
              </button>
            ) : (
              plans?.cancel &&
              confirm !== 'cancel' && (
                <button disabled={busy !== null} onClick={() => setConfirm('cancel')}>
                  Cancel subscription…
                </button>
              )
            )}
            {plans?.portal && (
              <button
                disabled={busy !== null}
                onClick={() =>
                  act('portal', async () => {
                    location.assign((await api.billingPortal()).url);
                  })
                }
              >
                Payment method and invoices
              </button>
            )}
          </div>
        )}
        {live && confirm === 'cancel' && (
          <div class="confirm" role="group" aria-labelledby="cancel-q">
            <p id="cancel-q">
              Cancel at the end of the paid period
              {access.subExpiresAt !== null ? ` (${formatDate(access.subExpiresAt)})` : ''}? You
              keep full access until then, and nothing more is charged.
            </p>
            <div class="row start">
              <button
                class="danger"
                disabled={busy !== null}
                onClick={() =>
                  act('cancel', async () => {
                    setSub(await api.cancelSubscription());
                    await refreshAccount();
                    setConfirm(null);
                  })
                }
              >
                Cancel at period end
              </button>
              <button onClick={() => setConfirm(null)}>Keep it</button>
            </div>
          </div>
        )}

        {canBuy && plans && plans.plans.length > 0 && (
          <>
            <ul class="plans" aria-label="Plans">
              {plans.plans.map((p) => {
                const per = perMonthText(p);
                return (
                  <li key={p.id} class="plan-card">
                    <h4>{p.name}</h4>
                    <p class="plan-price">{priceText(p)}</p>
                    {per && <p class="muted small-text">{per}</p>}
                    <button
                      class="primary"
                      disabled={busy !== null}
                      aria-label={`Subscribe to the ${p.name.toLowerCase()} plan, ${priceText(p)}`}
                      onClick={() => void subscribe(p.id)}
                    >
                      {busy === `buy:${p.id}` ? 'Opening checkout…' : 'Subscribe'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p class="muted small-text">
              One subscription unlocks everything that affects play; nothing is sold for power.
              Prices in US dollars; tax is added at checkout.
            </p>
            {plans.provider === 'fake' && (
              <p class="note small-text">
                Test mode: checkout is a local fake page and no money moves.
              </p>
            )}
          </>
        )}
        {canBuy && plans?.provider === 'none' && (
          <p class="note warn">Subscriptions are not available on this server yet.</p>
        )}
      </section>

      <section class="panel" aria-labelledby="data-h">
        <h3 id="data-h">Your data</h3>
        <p class="muted small-text">
          We keep your email, display name and game data only. Download everything we hold, or
          delete the account.
        </p>
        <div class="row start">
          <a class="button-link" href="/api/me/export" download="chain-theorem-export.json">
            Download my data
          </a>
          {confirm !== 'delete' && (
            <button class="danger" onClick={() => setConfirm('delete')}>
              Delete account…
            </button>
          )}
        </div>
        {confirm === 'delete' && (
          <div class="confirm" role="group" aria-labelledby="delete-q">
            <p id="delete-q">
              Delete your account and everything in it? This cannot be undone.
              {live ? ' Your subscription is canceled now.' : ''}
            </p>
            <div class="row start">
              <button
                class="danger"
                disabled={busy !== null}
                onClick={() =>
                  act('delete', async () => {
                    await api.deleteAccount();
                    account.value = { kind: 'signed_out' };
                    go('title');
                  })
                }
              >
                Delete permanently
              </button>
              <button onClick={() => setConfirm(null)}>Keep my account</button>
            </div>
          </div>
        )}
      </section>

      <div class="row start">
        <button onClick={() => go('online')}>Online play</button>
        <button onClick={() => void signOut().then(() => go('title'))}>Sign out</button>
        <button onClick={() => go('title')}>Back</button>
      </div>
    </main>
  );
}
