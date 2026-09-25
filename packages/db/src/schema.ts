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
  /** Zone the player is online in (null when offline); presence for friends (10.4). */
  presence_zone: string | null;
  presence_channel: number | null;
  /** 1 when an adult turned chat filtering on for themselves (R-SEC-011). */
  filter_chat: Generated<number>;
  /** Provider time of the billing event that last set sub_status (0004; out-of-order guard). */
  sub_event_at: number | null;
  /** When a moderator suspended the account (0006, M6 6.4); NULL when not suspended. */
  suspended_at: number | null;
  /** The suspension ends at this instant; NULL with `suspended_at` set: indefinitely. */
  suspended_until: number | null;
  /** Server-wide chat ban until this instant (0006); NULL or past: may chat. */
  chat_ban_until: number | null;
  /**
   * Others may watch this player's public battles (0008, M7 7.2): 1 or 0 as the player chose, NULL
   * for the default (on for adults, off under 18, R-SEC-011).
   */
  spectate: number | null;
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
  /** 1 when listed for spectators (0008, M7 7.2); 0 otherwise. */
  listed: Generated<number>;
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
  /** Stored upper case (0005); UNIQUE. */
  tag: string;
  /** The founder; NULL once that account is deleted (R-SEC-010). The leader is a member's rank. */
  owner_id: string | null;
  created_at: number;
  /** Lower-cased name, UNIQUE: names are unique regardless of case (0005). */
  name_key: string | null;
  /** Member cap (GUILDS.maxMembers at creation); CHECK (size <= max_size) (0005). */
  max_size: Generated<number>;
  /** Member count, recounted inside every membership change (0005, DD-15). */
  size: Generated<number>;
  /** Bumped first by every membership change: serializes them and invalidates roster caches. */
  roster_version: Generated<number>;
}

export interface GuildMembersTable {
  guild_id: string;
  /** UNIQUE (0005): one guild per player. */
  player_id: string;
  /** `leader` (one per guild, a unique partial index), `officer` or `member`. */
  rank: string;
  joined_at: number;
}

/** An invitation to join a guild (0005). */
export interface GuildInvitesTable {
  guild_id: string;
  /** The invitee. */
  player_id: string;
  /** NULL once the inviter's account is deleted (R-SEC-010). */
  invited_by: string | null;
  created_at: number;
}

/** One row per rated battle (0005): the primary key makes a battle rated once (R-FMT-004). */
export interface RatedGamesTable {
  battle_id: string;
  format: string;
  bracket: string;
  /** The two players, a_id < b_id; NULL once that account is deleted (R-SEC-010). */
  a_id: string | null;
  b_id: string | null;
  /** a's score: 1, 0.5 or 0. */
  score_a: number;
  /** 0 when the per-day same-opponent cap kept both ratings (R-SEC-008). */
  rated: number;
  a_delta: number;
  b_delta: number;
  at: number;
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

export interface WalletsTable {
  player_id: string;
  /** Soft currency (10.5); CHECK (coins >= 0). */
  coins: Generated<number>;
}

export interface KeyItemsTable {
  player_id: string;
  key_id: string;
  acquired_at: number;
}

export interface ProgressFlagsTable {
  player_id: string;
  /** `lesson:<id>`, `npc:<id>` (a once-only trainer defeated), ... */
  flag: string;
  at: number;
}

export interface PartiesTable {
  id: string;
  leader_id: string;
  /** CHECK (size <= 4) enforces the party cap inside each join (DD-15). */
  size: Generated<number>;
  created_at: number;
}

export interface PartyMembersTable {
  /** One party per player. */
  player_id: string;
  party_id: string;
  joined_at: number;
}

/** Stakes held by the server while a wager battle runs (0003, spec 9.5, R-FMT-006). */
export interface WagerEscrowsTable {
  /** The wager id (the TradeSession id that negotiated it). */
  id: string;
  /** The BattleRoom the stakes ride on; the `battles` row is written when the room starts. */
  battle_id: string;
  format: string;
  /** Inviter (a) and invitee (b); null after that account was deleted (R-SEC-010). */
  a_id: string | null;
  b_id: string | null;
  a_stake_json: JsonColumn;
  b_stake_json: JsonColumn;
  /** 'escrowed' | 'settled' | 'returned'. */
  status: string;
  /** Raised once by the settlement; CHECK (releases <= 1) makes a second one abort (DD-15). */
  releases: Generated<number>;
  /** 'a' | 'b' (the side that won the stakes), 'draw' or 'aborted'; null while escrowed. */
  outcome: string | null;
  created_at: number;
  settled_at: number | null;
}

/** A player's subscription at the billing provider (0004, spec 14.3, R-SEC-007). */
export interface BillingAccountsTable {
  player_id: string;
  /** 'fake' | 'paddle'. */
  provider: string;
  customer_id: string | null;
  subscription_id: string | null;
  /** 'monthly' | 'quarterly' | 'yearly', or null when the price is unknown. */
  plan: string | null;
  /** When a scheduled cancellation takes effect, or null. */
  cancel_at: number | null;
  /** Provider time of the latest applied event (webhooks arrive out of order). */
  state_at: number;
  updated_at: number;
}

/** Every verified provider webhook, once: UNIQUE (provider, event_id) (0004, R-SEC-007). */
export interface BillingEventsTable {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  /** Null when the event names no known player. */
  player_id: string | null;
  occurred_at: number;
  received_at: number;
  /** The normalized event (status, paid-until, plan); never card or address data. */
  payload_json: JsonColumn;
}

/** A player's report about another player (0006, M6 6.4, R-SEC-011). */
export interface ReportsTable {
  id: string;
  /** NULL once the reporter's account is deleted (the report stays, anonymized; R-SEC-010). */
  reporter_id: string | null;
  target_id: string;
  /** CHECK: harassment, hate, cheating, spam, inappropriate_name, other. */
  reason: string;
  note: string | null;
  /** `{ chat?: {text, ch}, battleId?, tradeId? }` (Zod `ReportContextJson`). */
  context_json: NullableJsonColumn;
  /** 'open' | 'reviewed' | 'dismissed'. */
  status: Generated<string>;
  created_at: number;
  resolved_at: number | null;
  /** The moderator who closed it; NULL once that account is deleted. */
  resolved_by: string | null;
  resolution_note: string | null;
}

/** `player_id` no longer receives `target_id`'s chat lines (0006, R-SEC-011). */
export interface MutesTable {
  player_id: string;
  target_id: string;
  created_at: number;
}

/** `player_id` blocked `target_id`: mute plus no whispers, challenges or invitations either way. */
export interface BlocksTable {
  player_id: string;
  target_id: string;
  created_at: number;
}

/** A tournament (0007, M7 7.1): listing and history; the TournamentRoom holds the live state. */
export interface TournamentsTable {
  id: string;
  name: string;
  format: string;
  /** Slot bracket: '1-2' | '3-4' | '5-6'. */
  bracket: string;
  /** CHECK: 'swiss' | 'se'. */
  system: string;
  /** CHECK: 'open' | 'running' | 'finished' | 'cancelled'. */
  status: Generated<string>;
  starts_at: number;
  max_players: number;
  /** Registered players; CHECK 0 <= players <= max_players. */
  players: Generated<number>;
  /** Planned rounds (0 before the start). */
  rounds: Generated<number>;
  /** The round being played (0 before the start). */
  round: Generated<number>;
  /** The admin who created it; NULL for a scheduled event or once that account is deleted. */
  created_by: string | null;
  /** UNIQUE: `daily:<system>:<format>:<bracket>:<date>` for a scheduled event, else NULL. */
  schedule_key: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  winner_id: string | null;
}

/** A player registered in a tournament (0007); place and points once it is finished. */
export interface TournamentEntriesTable {
  tournament_id: string;
  player_id: string;
  registered_at: number;
  place: number | null;
  points: number | null;
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
  wallets: WalletsTable;
  key_items: KeyItemsTable;
  progress_flags: ProgressFlagsTable;
  parties: PartiesTable;
  party_members: PartyMembersTable;
  billing_accounts: BillingAccountsTable;
  billing_events: BillingEventsTable;
  wager_escrows: WagerEscrowsTable;
  guild_invites: GuildInvitesTable;
  rated_games: RatedGamesTable;
  reports: ReportsTable;
  mutes: MutesTable;
  blocks: BlocksTable;
  tournaments: TournamentsTable;
  tournament_entries: TournamentEntriesTable;
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
  'wallets',
  'key_items',
  'progress_flags',
  'parties',
  'party_members',
  'billing_accounts',
  'billing_events',
  'wager_escrows',
  'guild_invites',
  'rated_games',
  'reports',
  'mutes',
  'blocks',
  'tournaments',
  'tournament_entries',
] as const satisfies readonly (keyof Schema)[];
