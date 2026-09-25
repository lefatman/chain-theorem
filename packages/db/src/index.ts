/**
 * `@chain-theorem/db`: dialect-agnostic entry (spec 13.3, 13.6; ARCHITECTURE 7). Safe for the Worker
 * bundle: it never imports a driver. Drivers live in `@chain-theorem/db/node` (better-sqlite3 and
 * pg), `@chain-theorem/db/pg` (pg only, for Hyperdrive) and `@chain-theorem/db/d1` (D1 binding).
 */
export { createDb, transactionRunner, type CreateDbOptions, type Db } from './db.ts';
export type { AtomicRunner, DbDialect, RepoContext } from './db-types.ts';
export { migrate, appliedMigrations, MIGRATIONS } from './migrate.ts';
export type { Migration, MigrationContext, ColumnTypes } from './migrations/types.ts';
export { TABLES } from './schema.ts';
export type * from './schema.ts';
export {
  DbConstraintError,
  DbDataError,
  isUniqueViolation,
  mapDbError,
  type ConstraintKind,
} from './errors.ts';
export { uuidv7, uuidv7Time, randomToken, sha256Hex } from './ids.ts';
export { adultFromBirthDate, isAdultAt } from './age.ts';
export {
  ItemBundle,
  JsonObject,
  LoadoutJson,
  LoginTokenData,
  RewardPayload,
  jsonCodec,
  type JsonCodec,
} from './json.ts';
export type { AuditEntry, AuditInput, AuditRepo } from './repos/audit.ts';
export {
  BATTLE_RESULTS,
  type Battle,
  type BattleEnd,
  type BattleRepo,
  type BattleResult,
  type NewBattle,
} from './repos/battles.ts';
export type { Inventory, InventoryKind, InventoryRepo } from './repos/inventory.ts';
export type { Loadout, LoadoutRepo, SaveLoadoutInput } from './repos/loadouts.ts';
export type { ConsumedLoginToken, LoginTokenRepo } from './repos/login-tokens.ts';
export type { OauthAccount, OauthAccountRepo } from './repos/oauth.ts';
export {
  normalizeEmail,
  type NewPlayer,
  type Player,
  type PlayerExport,
  type PlayerRepo,
} from './repos/players.ts';
export type { Rating, RatingInput, RatingRepo } from './repos/ratings.ts';
export type {
  RewardGrant,
  RewardGrantInput,
  RewardGrantOutcome,
  RewardRepo,
} from './repos/rewards.ts';
export type { Session, SessionRepo } from './repos/sessions.ts';
export type { Wager, WagerRepo, WagerStatus } from './repos/wagers.ts';
