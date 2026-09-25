# Deploying Chain Theorem

Local development and every automated test run without any cloud account. This guide covers the
human-only production steps (BUILD_PROMPT section 11). Run `pnpm deploy:check` at any point: it reports
which prerequisites are present and what is still missing.

## 1. Cloudflare

1. Create a Cloudflare account and subscribe to the **Workers Paid** plan (Durable Objects with SQLite
   storage and the 20:1 WebSocket billing need it; spec 14.1).
2. `pnpm --filter @chain-theorem/server exec wrangler login`.
3. Create the R2 bucket for battle logs: `wrangler r2 bucket create chain-theorem-battle-logs`.
4. Create the Analytics Engine dataset binding (declared in `apps/server/wrangler.jsonc` as
   `TELEMETRY`); it is created on first deploy.

## 2. Neon PostgreSQL and Hyperdrive (step 0.4)

1. Create a Neon project on the free plan (switch to Launch before launch). Use the latest PostgreSQL
   major Neon offers. Copy the pooled connection string.
2. Create the Hyperdrive configuration:
   `wrangler hyperdrive create chain-theorem-db --connection-string="postgres://USER:PASSWORD@HOST/DB?sslmode=require"`
3. Put the returned id into `apps/server/wrangler.jsonc` under `hyperdrive[0].id` (replace
   `REPLACE_WITH_HYPERDRIVE_ID`).
4. Pull-request previews: create a Neon branch of the staging database per PR and a Hyperdrive config
   pointing at it (or use the Neon GitHub integration).

## 3. Migrations

Migrations are forward-only and identical on SQLite and PostgreSQL (spec 13.6).

```sh
DATABASE_URL="postgres://…" pnpm --filter @chain-theorem/tools exec tsx src/db/migrate.ts
```

CI runs every migration on SQLite and on a PostgreSQL service container before merge.

## 4. Secrets

Every variable is documented in `apps/server/.dev.vars.example`. In production set them with
`wrangler secret put <NAME>` (never commit them; R-SEC-009):

| Secret                                                                        | Purpose                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `SESSION_SECRET`                                                              | HMAC key for session cookies and 60-second WebSocket tokens (R-SEC-006) |
| `MAIL_API_KEY`, `MAIL_FROM`                                                   | transactional email provider for magic links                            |
| `OAUTH_GOOGLE_ID/SECRET`, `OAUTH_GITHUB_ID/SECRET`, `OAUTH_DISCORD_ID/SECRET` | optional OAuth                                                          |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV`                       | billing (sandbox first)                                                 |
| `PADDLE_PRICE_MONTHLY/QUARTERLY/YEARLY`                                       | Paddle price ids                                                        |
| `ADMIN_EMAILS`                                                                | comma-separated admin console allow-list                                |

## 5. Paddle Billing

1. Create a Paddle **sandbox** account; create the product "Chain Theorem subscription" with monthly
   ($4), quarterly ($11) and yearly ($40) prices (spec 14.3). Put the price ids in secrets.
2. Add a notification destination pointing at `https://<your-domain>/api/billing/webhook` for
   `subscription.*` and `transaction.*` events; copy its secret to `PADDLE_WEBHOOK_SECRET`.
3. Confirm Paddle approves the product category (a subscription game whose items have no cash value).
4. Switch to live: new API key, webhook secret and price ids; set `PADDLE_ENV=production`.

## 6. Deploy

```sh
pnpm check && pnpm test:workers && pnpm test:e2e
pnpm --filter @chain-theorem/client build
pnpm --filter @chain-theorem/server exec wrangler deploy
```

GitHub Actions runs the same checks on every pull request; add a deploy job with a
`CLOUDFLARE_API_TOKEN` repository secret to deploy previews per pull request.

## 7. Rollback

- Code: `wrangler rollback` (or `wrangler versions deploy <previous-version-id>`).
- Database: migrations are forward-only; ship a new forward migration to undo a change. Neon's
  point-in-time restore (branch from a timestamp) covers data accidents.
- Durable Object state is versioned inside each object (`schema` field on stored battle state); old
  battles keep the content version they started with (13.5).
