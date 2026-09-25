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
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV`                          | billing (sandbox first)                                                                                             |
| `PADDLE_PRICE_MONTHLY/QUARTERLY/YEARLY`                                          | Paddle price ids                                                                                                    |
| `ADMIN_EMAILS`                                                                   | comma-separated allow-list for the cost dashboard (`/admin/cost`) and, from M6, the admin console                   |

## 5. Paddle Billing

1. Create a Paddle **sandbox** account; create the product "Chain Theorem subscription" with monthly
   ($4), quarterly ($11) and yearly ($40) prices (spec 14.3). Put the price ids in secrets.
2. Add a notification destination pointing at `https://<your-domain>/api/billing/webhook` for
   `subscription.*` and `transaction.*` events; copy its secret to `PADDLE_WEBHOOK_SECRET`.
3. Confirm Paddle approves the product category (a subscription game whose items have no cash value).
4. Switch to live: new API key, webhook secret and price ids; set `PADDLE_ENV=production`.

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
