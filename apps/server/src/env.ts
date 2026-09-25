/**
 * Worker bindings (wrangler.jsonc). Secrets (AUTH_SECRET, MAIL_API_KEY, OAuth keys) come from
 * `wrangler secret put` in production and `.dev.vars` locally (R-SEC-009); never from the repo.
 */
export interface Env {
  ASSETS: Fetcher;
  BATTLE_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  /** One per zone channel (M5, 12.2): `zone:<zone>:<channel>`. */
  ZONE_ROOM: DurableObjectNamespace;
  /** Hourly usage rollups for the cost dashboard (14.2); one instance, `global`. */
  METRICS: DurableObjectNamespace;
  /** One per trade or wager negotiation (M6 6.1, 12.2): both offers and the confirmations. */
  TRADE_SESSION: DurableObjectNamespace;
  /** One per guild (M6, 12.2): roster cache and guild chat, named by the guild id. */
  GUILD_ROOM: DurableObjectNamespace;
  /** One per tournament (M7 7.1, 12.2): registration, pairings, results; named by its id. */
  TOURNAMENT_ROOM: DurableObjectNamespace;
  /** Workers Analytics Engine dataset (production); telemetry stays in METRICS without it. */
  TELEMETRY?: AnalyticsEngineDataset;
  /** Comma-separated emails allowed to open the cost dashboard (`/admin/cost`). */
  ADMIN_EMAILS?: string;
  /** Local and test database (D1). */
  DB?: D1Database;
  /** Production database (PostgreSQL through Hyperdrive). */
  HYPERDRIVE?: Hyperdrive;
  BATTLE_LOGS: R2Bucket;
  APP_ORIGIN: string;
  MAIL_MODE: 'console' | 'http';
  DB_KIND: 'd1' | 'postgres';
  /** HMAC key for tickets and OAuth state; at least 32 random bytes. */
  AUTH_SECRET: string;
  MAIL_ENDPOINT?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  // Billing (M6 6.3, DEPLOY.md 5). Paddle is used when the API key and webhook secret are set.
  PADDLE_API_KEY?: string;
  /** The notification destination's secret (verifies `Paddle-Signature`, R-SEC-007). */
  PADDLE_WEBHOOK_SECRET?: string;
  /** `sandbox` (default) or `production`. */
  PADDLE_ENV?: string;
  PADDLE_PRICE_MONTHLY?: string;
  PADDLE_PRICE_QUARTERLY?: string;
  PADDLE_PRICE_YEARLY?: string;
  /** Paddle.js client-side token for the pay page (public by design, but kept with the others). */
  PADDLE_CLIENT_TOKEN?: string;
  /** `on` allows the fake provider on a non-local origin (a preview); never set in production. */
  FAKE_BILLING?: string;
  /** Signing key for the fake provider; derived from AUTH_SECRET when unset. */
  FAKE_BILLING_SECRET?: string;
}
