# Deploying Chain Theorem

Local development and every automated test run without any cloud account. This guide covers the
human-only production steps (BUILD_PROMPT section 11). Run `pnpm deploy:check` at any point: it reports
which prerequisites are present and what is still missing.

## 1. Cloudflare

1. Create a Cloudflare account and subscribe to the **Workers Paid** plan (Durable Objects with SQLite
   storage and the 20:1 WebSocket billing need it; spec 14.1).
2. `pnpm --filter @chain-theorem/server exec wrangler login`.
3. Create the R2 bucket for battle logs: `wrangler r2 bucket create chain-theorem-battle-logs`.
4. Set your domain in `apps/server/wrangler.jsonc` under `env.production.vars.APP_ORIGIN` (replace
   `https://REPLACE_WITH_YOUR_DOMAIN`); magic links and OAuth callbacks use it.
5. Telemetry (M5): the production environment binds the Analytics Engine dataset
   `chain_theorem_telemetry` (`TELEMETRY`); Cloudflare creates it on the first data point. The cost
   dashboard at `https://<domain>/admin/cost` reads the `Metrics` Durable Object and opens for the
   emails in `ADMIN_EMAILS`. For the 14.2 alert, add a Workers Logs alert on log lines containing
   `"alert":"cost_guardrail"` (the Metrics object logs one when an hour's projection exceeds $0.10
   per subscriber).
6. Durable Object classes ship through the `migrations` list in `wrangler.jsonc` (`v1`: BattleRoom,
   Matchmaker; `v2`: ZoneRoom, Metrics). `wrangler deploy` applies new tags in order; never edit or
   remove a tag that has been deployed.

## 2. Neon PostgreSQL and Hyperdrive (step 0.4)

1. Create a Neon project on the free plan (switch to Launch before launch). Use the latest PostgreSQL
   major Neon offers. Copy the pooled connection string.
2. Create the Hyperdrive configuration:
   `wrangler hyperdrive create chain-theorem-db --connection-string="postgres://USER:PASSWORD@HOST/DB?sslmode=require"`
3. Put the returned id into `apps/server/wrangler.jsonc` under `env.production.hyperdrive[0].id`
   (replace `REPLACE_WITH_HYPERDRIVE_ID`). Production sets `DB_KIND=postgres`; local development and
   the Worker tests use D1 (`DB_KIND=d1`), which the Worker migrates on first use.
4. Pull-request previews: create a Neon branch of the staging database per PR and a Hyperdrive config
   pointing at it (or use the Neon GitHub integration).

## 3. Migrations

Migrations are forward-only and identical on SQLite and PostgreSQL (spec 13.6).

```sh
DATABASE_URL="postgres://…" pnpm db:migrate
```

Run it before each deploy that adds a migration (it is idempotent; `db:migrate: up to date` means
nothing to do). CI runs every migration on SQLite, D1 and a PostgreSQL service container before
merge (`pnpm test:db`, `pnpm test:db:pg`).

## 4. Secrets

Every variable is documented in `apps/server/.dev.vars.example`. In production set them with
`wrangler secret put <NAME>` (never commit them; R-SEC-009):

| Secret                                                                           | Purpose                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                                                                    | HMAC key for 60-second WebSocket tickets and OAuth state (R-SEC-006); 32+ random bytes, e.g. `openssl rand -hex 32` |
| `MAIL_ENDPOINT`, `MAIL_API_KEY`, `MAIL_FROM`                                     | transactional email provider for magic links (a JSON `send` endpoint with bearer auth)                              |
| `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` | optional OAuth; the callback URL is `https://<domain>/api/auth/oauth/<provider>/callback`                           |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`                                        | Paddle Billing API key and the notification destination's secret; with both set, Paddle is the billing provider     |
| `PADDLE_ENV`                                                                     | `sandbox` (the default) or `production`                                                                             |
| `PADDLE_PRICE_MONTHLY/QUARTERLY/YEARLY`                                          | Paddle price ids for the $4, $11 and $40 plans (spec 14.3); a plan without a price id is not offered                |
| `PADDLE_CLIENT_TOKEN`                                                            | Paddle.js client-side token for the pay page `/api/billing/paddle/pay` (public by design; kept with the others)     |
| `FAKE_BILLING`, `FAKE_BILLING_SECRET`                                            | local and preview only: `on` allows the fake provider on a non-local origin; its signing key. Never in production   |
| `ADMIN_EMAILS`                                                                   | comma-separated allow-list for the cost dashboard (`/admin/cost`) and, from M6, the admin console                   |

## 5. Paddle Billing

Billing goes through a `BillingProvider` (ARCHITECTURE 6, spec 14.3 and 14.4, DD-07). The Worker uses
Paddle when `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` are both set. Without them it uses the local
fake provider, but only on a local origin (`http://localhost`, `127.0.0.1`) or with `FAKE_BILLING=on`;
anywhere else billing is off (checkout answers `503 billing_unavailable`), so a production Worker
that lost its keys never hands out free subscriptions. `GET /api/billing/plans` reports the provider
in use (`fake`, `paddle` or `none`), and the Worker logs it once per isolate (`{"billing":"paddle"}`).

Every new account gets a 7-day free trial with full play (COMMITTED); trial accounts cannot trade or
wager. When the trial ends without a subscription, online play answers `402 subscription_required`;
the account page, data export, deletion and checkout keep working.

**Local (no account needed).** `pnpm dev`, sign in, open Online play, then Account and subscription,
and press Subscribe. The fake checkout page (`/api/billing/fake/checkout`) has Pay and Cancel; Pay
signs Paddle-shaped webhooks and delivers them to `POST /api/billing/webhook`, through the same
signature check and parser as production. `POST /api/billing/fake/simulate` with
`{"action":"renew" | "fail_payment" | "cancel_now" | "expire_trial"}` drives the rest of the
lifecycle for the signed-in account (fake provider only).

**Sandbox (human-only: needs your Paddle account).**

1. Create a Paddle Billing **sandbox** account (`sandbox-vendors.paddle.com`).
2. Catalog, Products: create "Chain Theorem subscription" (tax category: standard digital goods)
   with three recurring prices: $4 every month, $11 every 3 months, $40 every year. Add no Paddle
   trial period (the game's own trial needs no card). Copy the price ids (`pri_…`) to
   `PADDLE_PRICE_MONTHLY`, `PADDLE_PRICE_QUARTERLY` and `PADDLE_PRICE_YEARLY`.
3. Developer tools, Authentication: create an API key (sandbox keys start with `pdl_sdbx_apikey_`)
   allowed to write transactions, subscriptions and customers (portal sessions) and put it in
   `PADDLE_API_KEY`. Create a client-side token (`test_…`) and put it in `PADDLE_CLIENT_TOKEN`.
4. Checkout, Checkout settings: add your domain to the approved domains and set the default payment
   link to `https://<your-domain>/api/billing/paddle/pay` (the Worker serves that page; it loads
   Paddle.js and opens the checkout for the `_ptxn` transaction).
5. Developer tools, Notifications: add a destination with the URL
   `https://<your-domain>/api/billing/webhook` and the events `subscription.created`,
   `subscription.activated`, `subscription.updated`, `subscription.past_due`,
   `subscription.paused`, `subscription.resumed`, `subscription.canceled`,
   `subscription.trialing` and `transaction.completed`. Copy its secret key to
   `PADDLE_WEBHOOK_SECRET`.
6. Set the secrets (`PADDLE_ENV=sandbox`):
   `wrangler secret put PADDLE_API_KEY --env production` (and the same for the others), then deploy.
7. Test: sign in, open Account and subscription, subscribe, and pay with Paddle's test card
   `4242 4242 4242 4242` (any future expiry, CVC `100`); `4000 0000 0000 0002` is declined. After
   the redirect the account page waits for the webhook and shows the renewal date; `GET /api/me`
   reports `access.status: "subscriber"`. In Notifications, the delivery log should show `200` for
   every event; replaying one answers `{"ok":true,"outcome":"duplicate"}`. Cancel from the account
   page: Paddle schedules the cancel at the end of the period ("It ends on …"). The webhook refuses
   anything without a valid `Paddle-Signature` (401), including deliveries signed more than 5 minutes
   ago.
8. Confirm Paddle approves the product category (a subscription game whose items have no cash
   value) before going live.
9. Live: in the live Paddle account repeat steps 2 to 5 (live API key `pdl_live_apikey_…`, live
   client token, live price ids, a live notification destination), set them as secrets with
   `PADDLE_ENV=production`, and deploy. Never set `FAKE_BILLING` in production.

## 6. Deploy

```sh
pnpm check && pnpm test:db && pnpm test:workers && pnpm test:e2e && pnpm test:e2e:online
pnpm test:load && pnpm test:firstwin
DATABASE_URL="postgres://…" pnpm db:migrate
pnpm --filter @chain-theorem/client build
pnpm --filter @chain-theorem/server exec wrangler deploy --env production
```

GitHub Actions runs the same checks on every pull request; add a deploy job with a
`CLOUDFLARE_API_TOKEN` repository secret to deploy previews per pull request.

## 7. Rollback

- Code: `wrangler rollback` (or `wrangler versions deploy <previous-version-id>`).
- Database: migrations are forward-only; ship a new forward migration to undo a change. Neon's
  point-in-time restore (branch from a timestamp) covers data accidents.
- Durable Object state is versioned inside each object (`schema` field on stored battle state); old
  battles keep the content version they started with (13.5).
