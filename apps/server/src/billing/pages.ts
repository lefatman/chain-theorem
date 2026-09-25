/**
 * Server-rendered billing pages: the fake provider's checkout (local and tests only, no script, no
 * external requests) and the Paddle pay page that hosts Paddle.js for a transaction (`_ptxn`).
 */
import type { BillingPlan } from '@chain-theorem/protocol';
import { usd } from './plans.ts';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** JSON safe inside a <script> element. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const STYLE = `:root{color-scheme:light dark;--bg:#f6f4ef;--card:#fff;--fg:#1b1b1b;--muted:#5d5d5d;--line:#d8d4ca;--accent:#1f5f8b;--accent-fg:#fff;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1c2025;--fg:#eceff3;--muted:#a9b0b8;--line:#343a42;--accent:#6fb3e0;--accent-fg:#0b1a24;--warn:#f0c060}}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;padding:max(16px,6vh) 16px 16px;color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:420px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:1.3rem;margin:.2rem 0 .6rem}.badge{display:inline-block;font-size:.8rem;font-weight:600;color:var(--warn);border:1px solid currentColor;border-radius:999px;padding:2px 10px;margin:0}
.price{font-size:1.1rem}.muted{color:var(--muted);font-size:.9rem}.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:16px}
button,.cancel{font:inherit;min-height:44px;padding:10px 18px;border-radius:8px;cursor:pointer}
button{background:var(--accent);color:var(--accent-fg);border:0;font-weight:600}.cancel{color:var(--fg);border:1px solid var(--line);text-decoration:none;display:inline-flex;align-items:center}
button:focus-visible,.cancel:focus-visible{outline:3px solid var(--accent);outline-offset:2px}`;

function page(title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style>${head}</head><body><main>${body}</main></body></html>`;
}

/** The fake provider's checkout: Pay posts the session back; Cancel returns to the app. */
export function fakeCheckoutHtml(plan: BillingPlan, session: string, origin: string): string {
  const per = plan.months === 1 ? 'every month' : `every ${plan.months} months`;
  return page(
    'Test checkout · Chain Theorem',
    `<p class="badge">Test mode: no real payment</p>
<h1>Chain Theorem subscription</h1>
<p class="price">${esc(plan.name)} plan: <strong>${usd(plan.priceCents)}</strong> ${per}</p>
<p class="muted">This is the local fake checkout (no card, no money moves). Paying sends a signed
webhook to the game server through the same verification a real payment uses.</p>
<form method="post" action="/api/billing/fake/pay" class="actions">
<input type="hidden" name="session" value="${esc(session)}">
<button type="submit">Pay ${usd(plan.priceCents)}</button>
<a class="cancel" href="${esc(origin)}/#/account?checkout=canceled">Cancel</a>
</form>`,
  );
}

export function checkoutExpiredHtml(origin: string): string {
  return page(
    'Checkout expired · Chain Theorem',
    `<h1>This checkout link has expired</h1>
<p class="muted">Start again from your account page.</p>
<p class="actions"><a class="cancel" href="${esc(origin)}/#/account">Back to the game</a></p>`,
  );
}

/**
 * Hosts Paddle.js: with `_ptxn` in the URL, Paddle opens the overlay checkout for that transaction.
 * Paddle.js loads from Paddle's CDN; the client-side token is public by design (not a secret).
 */
export function paddlePayHtml(
  origin: string,
  env: 'sandbox' | 'production',
  token: string,
): string {
  const cfg = scriptJson({
    env,
    token,
    success: `${origin}/#/account?checkout=success`,
    closed: `${origin}/#/account?checkout=canceled`,
  });
  return page(
    'Checkout · Chain Theorem',
    `<h1>Chain Theorem subscription</h1>
<p id="status" role="status">Opening the secure checkout…</p>
<p class="actions"><a class="cancel" href="${esc(origin)}/#/account">Back to the game</a></p>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>(function(){var c=${cfg};var done=false;
if(!window.Paddle){document.getElementById('status').textContent='The checkout could not load. Check your connection and try again.';return;}
if(c.env==='sandbox')Paddle.Environment.set('sandbox');
Paddle.Initialize({token:c.token,eventCallback:function(e){
if(e.name==='checkout.completed'){done=true;document.getElementById('status').textContent='Payment received. Returning to the game…';setTimeout(function(){location.href=c.success;},1500);}
else if(e.name==='checkout.closed'&&!done){location.href=c.closed;}}});})();</script>`,
  );
}
