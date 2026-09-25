/**
 * Kysely table types for every table in spec 13.3 plus the auth and reward tables (R-DATA-003).
 *
 * Portability (spec 13.6, R-DATA-004): ids are UUIDv7 text from the application, timestamps are
 * integer epoch milliseconds (BIGINT on PostgreSQL), JSON columns are JSONB on PostgreSQL and TEXT on
 * SQLite. A JSON column is written as a JSON string and read back as `unknown` (an object from
 * PostgreSQL, a string from SQLite); repositories decode it with Zod (`json.ts`). Booleans are stored
 * as INTEGER 0/1 on both engines because better-sqlite3 and D1 cannot bind booleans and PostgreSQL
 * will not cast an integer parameter into a BOOLEAN column.
 */
import type { ColumnType, Generated } from 'kysely';

/** Select type is `unknown` (engine-dependent); insert and update take the JSON string. */
export type JsonColumn = ColumnType<unknown, string, string>;
/** Nullable JSON column. */
export type NullableJsonColumn = ColumnType<unknown, string | null | undefined, string | null>;

export interface SchemaMigrationsTable {
  id: string;
  applied_at: number;
}

export interface PlayersTable {
  id: string;
  email: string;
  display_name: string;
  level: Generated<number>;
  xp: Generated<number>;
  zone_id: string | null;
  tile_x: number | null;
  tile_y: number | null;
  sub_status: Generated<string>;
  sub_expires_at: number | null;
  trial_ends_at: number | null;
  /** The instant the account turns 18 (epoch ms). The only age data stored (R-SEC-011). */
  adult_from: number;
  created_at: number;
}

export interface SessionsTable {
  id: string;
  player_id: string;
  /** Hex SHA-256 of the session token; the token itself is never stored (R-SEC-006). */
  token_hash: string;
  created_at: number;
  expires_at: number;
}

export interface LoginTokensTable {
  id: string;
  /** Hex SHA-256 of the magic-link token. */
  token_hash: string;
  email: string;
  purpose: string;
  /** Pending sign-up data (display name, adult_from); never a birth date (R-SEC-011). */
  data_json: NullableJsonColumn;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface OauthAccountsTable {
  id: string;
  provider: string;
  provider_user_id: string;
  player_id: string;
  created_at: number;
}

export interface InventoryItemsTable {
  player_id: string;
  item_id: string;
  /** CHECK (qty >= 0) (R-SEC-004, DD-15). */
  qty: number;
}

export interface InventoryCardsTable {
  player_id: string;
  ability_id: string;
  /** CHECK (qty >= 0) (R-SEC-004, DD-15). */
  qty: number;
}

export interface LoadoutsTable {
  id: string;
  player_id: string;
  name: string;
  loadout_json: JsonColumn;
  /** 0 or 1. */
  is_valid: number;
  created_at: number;
  updated_at: number;
}

export interface RatingsTable {
  player_id: string;
  format: string;
  bracket: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  updated_at: number;
}

export interface BattlesTable {
  id: string;
  format: string;
  /** Null for an NPC side or after the player's account was deleted (R-SEC-010). */
  white_id: string | null;
  black_id: string | null;
  /** Null while the battle is running. */
  result: string | null;
  reason: string | null;
  started_at: number;
  ended_at: number | null;
  /** R2 key of the archived event log. */
  log_key: string | null;
}

export interface WagersTable {
  id: string;
  battle_id: string;
  white_stake_json: JsonColumn;
  black_stake_json: JsonColumn;
  status: string;
  created_at: number;
  settled_at: number | null;
}

export interface GuildsTable {
  id: string;
  name: string;
  tag: string;
  owner_id: string | null;
  created_at: number;
}

export interface GuildMembersTable {
  guild_id: string;
  player_id: string;
  rank: string;
  joined_at: number;
}

export interface TradesTable {
  id: string;
  a_id: string | null;
  b_id: string | null;
  status: string;
  offer_json: JsonColumn;
  created_at: number;
  completed_at: number | null;
}

export interface FriendsTable {
  a_id: string;
  b_id: string;
  status: string;
  created_at: number;
}

export interface QuestProgressTable {
  player_id: string;
  quest_id: string;
  step: number;
  data_json: JsonColumn;
  updated_at: number;
}

export interface AuditLogTable {
  id: string;
  player_id: string | null;
  kind: string;
  payload_json: JsonColumn;
  at: number;
}

export interface RewardGrantsTable {
  id: string;
  /** Idempotency key: a battle id or a quest step; UNIQUE (grant_key, player_id) (R-SEC-003). */
  grant_key: string;
  player_id: string;
  payload_json: JsonColumn;
  at: number;
}

export interface Schema {
  schema_migrations: SchemaMigrationsTable;
  players: PlayersTable;
  sessions: SessionsTable;
  login_tokens: LoginTokensTable;
  oauth_accounts: OauthAccountsTable;
  inventory_items: InventoryItemsTable;
  inventory_cards: InventoryCardsTable;
  loadouts: LoadoutsTable;
  ratings: RatingsTable;
  battles: BattlesTable;
  wagers: WagersTable;
  guilds: GuildsTable;
  guild_members: GuildMembersTable;
  trades: TradesTable;
  friends: FriendsTable;
  quest_progress: QuestProgressTable;
  audit_log: AuditLogTable;
  reward_grants: RewardGrantsTable;
}

/** Every table of spec 13.3 plus the auth and reward tables, in creation order. */
export const TABLES = [
  'players',
  'sessions',
  'login_tokens',
  'oauth_accounts',
  'inventory_items',
  'inventory_cards',
  'loadouts',
  'ratings',
  'battles',
  'wagers',
  'guilds',
  'guild_members',
  'trades',
  'friends',
  'quest_progress',
  'audit_log',
  'reward_grants',
] as const satisfies readonly (keyof Schema)[];
