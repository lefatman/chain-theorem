/**
 * Worker bindings (wrangler.jsonc). Secrets (AUTH_SECRET, MAIL_API_KEY, OAuth keys) come from
 * `wrangler secret put` in production and `.dev.vars` locally (R-SEC-009); never from the repo.
 */
export interface Env {
  ASSETS: Fetcher;
  BATTLE_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
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
}
