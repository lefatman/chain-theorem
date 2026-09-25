/**
 * Players (spec 13.3). Stores the minimum personal data: email and display name (R-SEC-010), plus
 * `adult_from` as the only age data (R-SEC-011). Export and delete cover every table that holds the
 * player's rows (R-SEC-010).
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { mapDbError } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import { JsonObject, ReportContextJson } from '../json.ts';
import type { PlayersTable } from '../schema.ts';
import { toBattle, type Battle } from './battles.ts';
import { toLoadout, type Loadout } from './loadouts.ts';
import { toRating, type Rating } from './ratings.ts';
import { toRewardGrant, type RewardGrant } from './rewards.ts';
import { toEscrow, toWager, type Wager, type WagerEscrow } from './wagers.ts';
import type { AuditEntry } from './audit.ts';
import {
  toBillingAccount,
  toBillingEvent,
  type BillingAccount,
  type BillingEventRecord,
} from './billing.ts';
import type { Inventory } from './inventory.ts';
import { guildRemovalStatements } from './guilds.ts';
import { tournamentRemovalStatements } from './tournaments.ts';
import { toRatedGame, type RatedGame } from './ranked.ts';

export interface Player {
  id: string;
  email: string;
  displayName: string;
  level: number;
  xp: number;
  zoneId: string | null;
  tileX: number | null;
  tileY: number | null;
  subStatus: string;
  subExpiresAt: number | null;
  trialEndsAt: number | null;
  /** Epoch ms when the account turns 18 (R-SEC-011). */
  adultFrom: number;
  createdAt: number;
  /** When a moderator suspended the account (M6 6.4); null when it is not suspended. */
  suspendedAt: number | null;
  /** When the suspension ends; null while `suspendedAt` is set: indefinitely. */
  suspendedUntil: number | null;
  /** Server-wide chat ban until this instant (epoch ms); null or past: may chat. */
  chatBanUntil: number | null;
  /**
   * Others may watch this player's public battles (M7 7.2): the player's own choice, or null for
   * the default (on for adults, off under 18; see `spectatingAllowed`).
   */
  spectate: boolean | null;
}

/**
 * Whether others may watch `p`'s public battles at `now` (M7 7.2): the player's own setting, else on
 * for adults and off for accounts under 18 (R-SEC-011 spirit), so the default changes by itself on
 * the 18th birthday.
 */
export function spectatingAllowed(p: Pick<Player, 'spectate' | 'adultFrom'>, now: number): boolean {
  return p.spectate ?? now >= p.adultFrom;
}

export interface NewPlayer {
  email: string;
  displayName: string;
  /** From `adultFromBirthDate()`; the birth date itself is never stored (R-SEC-011). */
  adultFrom: number;
  /** When the free trial ends (sign-up: now + 7 days, spec 14.4); null falls back to created + 7 days. */
  trialEndsAt?: number;
  now?: number;
}

/** Everything stored about one player, for data export (R-SEC-010). Token hashes are omitted. */
export interface PlayerExport {
  exportedAt: number;
  player: Player;
  sessions: { id: string; createdAt: number; expiresAt: number }[];
  oauthAccounts: { provider: string; providerUserId: string; createdAt: number }[];
  inventory: Inventory;
  loadouts: Loadout[];
  ratings: Rating[];
  battles: Battle[];
  wagers: Wager[];
  /** Stakes this player put into wager escrow (M6, 9.5), live or settled. */
  wagerEscrows: WagerEscrow[];
  guildMemberships: { guildId: string; rank: string; joinedAt: number }[];
  guildsOwned: { id: string; name: string; tag: string; createdAt: number }[];
  /** Guild invitations to this player or sent by this player (M6, 10.4). */
  guildInvites: {
    guildId: string;
    playerId: string;
    invitedBy: string | null;
    createdAt: number;
  }[];
  /** Rated battles (M6, 9.3): opponent pair, score, rating changes, whether the cap held them. */
  ratedGames: RatedGame[];
  trades: {
    id: string;
    aId: string | null;
    bId: string | null;
    status: string;
    offer: JsonObject;
    createdAt: number;
    completedAt: number | null;
  }[];
  friends: { aId: string; bId: string; status: string; createdAt: number }[];
  quests: { questId: string; step: number; data: JsonObject; updatedAt: number }[];
  rewardGrants: RewardGrant[];
  auditLog: AuditEntry[];
  coins: number;
  keyItems: { keyId: string; acquiredAt: number }[];
  progressFlags: { flag: string; at: number }[];
  partyId: string | null;
  /** Subscription billing (M6 6.3): provider ids, plan and every recorded webhook event. */
  billing: { account: BillingAccount | null; events: BillingEventRecord[] };
  /** Players this player muted and blocked (M6 6.4); never who muted or blocked them. */
  mutes: { targetId: string; createdAt: number }[];
  blocks: { targetId: string; createdAt: number }[];
  /** Reports this player filed, in full (M6 6.4). */
  reportsFiled: {
    id: string;
    targetId: string;
    reason: string;
    note: string | null;
    context: ReportContextJson | null;
    status: string;
    createdAt: number;
    resolvedAt: number | null;
  }[];
  /**
   * Reports about this player: reason, status and date only. Never the reporter, the note or the
   * context, so the reported player never learns who reported them (DD in spec 18).
   */
  reportsAbout: { id: string; reason: string; status: string; createdAt: number }[];
  /** Tournaments the player registered in (M7 7.1): when, and the final place and points. */
  tournaments: {
    tournamentId: string;
    name: string;
    format: string;
    system: string;
    status: string;
    startsAt: number;
    registeredAt: number;
    place: number | null;
    points: number | null;
  }[];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toPlayer(row: Selectable<PlayersTable>): Player {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    level: row.level,
    xp: row.xp,
    zoneId: row.zone_id,
    tileX: row.tile_x,
    tileY: row.tile_y,
    subStatus: row.sub_status,
    subExpiresAt: row.sub_expires_at,
    trialEndsAt: row.trial_ends_at,
    adultFrom: row.adult_from,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at ?? null,
    suspendedUntil: row.suspended_until ?? null,
    chatBanUntil: row.chat_ban_until ?? null,
    spectate: row.spectate === null || row.spectate === undefined ? null : row.spectate === 1,
  };
}

export function playerRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function getById(id: string): Promise<Player | null> {
    const row = await k.selectFrom('players').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toPlayer(row) : null;
  }

  /** Raises `level` to `levelForXp(xp)`; never lowers it, so racing updates are safe. */
  async function syncLevel(
    id: string,
    levelForXp: (xp: number) => number,
  ): Promise<{ xp: number; level: number } | null> {
    const row = await k
      .selectFrom('players')
      .select(['xp', 'level'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    const target = levelForXp(row.xp);
    if (Number.isInteger(target) && target > row.level) {
      await k
        .updateTable('players')
        .set({ level: target })
        .where('id', '=', id)
        .where('level', '<', target)
        .execute();
    }
    const after = await k
      .selectFrom('players')
      .select(['xp', 'level'])
      .where('id', '=', id)
      .executeTakeFirst();
    return after ?? null;
  }

  return {
    /** Creates a player. A taken email rejects with `DbConstraintError` (kind `unique`). */
    async create(input: NewPlayer): Promise<Player> {
      if (!Number.isSafeInteger(input.adultFrom))
        throw new RangeError('adultFrom must be epoch ms');
      const displayName = input.displayName.trim();
      if (displayName.length === 0) throw new RangeError('displayName is empty');
      if (input.trialEndsAt !== undefined && !Number.isSafeInteger(input.trialEndsAt))
        throw new RangeError('trialEndsAt must be epoch ms');
      const now = input.now ?? ctx.now();
      const row = {
        id: uuidv7(now),
        email: normalizeEmail(input.email),
        display_name: displayName,
        adult_from: input.adultFrom,
        created_at: now,
        trial_ends_at: input.trialEndsAt ?? null,
      };
      try {
        await k.insertInto('players').values(row).execute();
      } catch (err) {
        throw mapDbError(err);
      }
      const created = await getById(row.id);
      if (!created) throw new Error('player vanished after insert');
      return created;
    },

    getById,

    /** Players with exactly this display name (at most `limit`); names are not unique. */
    async findByDisplayName(name: string, limit = 2): Promise<Player[]> {
      const list = await k
        .selectFrom('players')
        .selectAll()
        .where('display_name', '=', name)
        .orderBy('id')
        .limit(limit)
        .execute();
      return list.map(toPlayer);
    },

    async getByEmail(email: string): Promise<Player | null> {
      const row = await k
        .selectFrom('players')
        .selectAll()
        .where('email', '=', normalizeEmail(email))
        .executeTakeFirst();
      return row ? toPlayer(row) : null;
    },

    /**
     * Sets whether others may watch this player's public battles (M7 7.2); null restores the
     * default by age. False when the player does not exist.
     */
    async setSpectate(id: string, value: boolean | null): Promise<boolean> {
      const r = await k
        .updateTable('players')
        .set({ spectate: value === null ? null : value ? 1 : 0 })
        .where('id', '=', id)
        .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1;
    },

    async rename(id: string, displayName: string): Promise<boolean> {
      const name = displayName.trim();
      if (name.length === 0) throw new RangeError('displayName is empty');
      const r = await k
        .updateTable('players')
        .set({ display_name: name })
        .where('id', '=', id)
        .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1;
    },

    /**
     * Adds XP (an atomic increment, safe under concurrency) and, when `levelForXp` is given (the curve
     * lives in content config, not here), raises the level to match.
     */
    async addXp(
      id: string,
      delta: number,
      levelForXp?: (xp: number) => number,
    ): Promise<{ xp: number; level: number } | null> {
      if (!Number.isInteger(delta) || delta < 0)
        throw new RangeError('xp delta must be a non-negative integer');
      const r = await k
        .updateTable('players')
        .set((eb) => ({ xp: eb('xp', '+', delta) }))
        .where('id', '=', id)
        .executeTakeFirst();
      if (rows(r.numUpdatedRows) !== 1) return null;
      if (levelForXp) return syncLevel(id, levelForXp);
      const after = await k
        .selectFrom('players')
        .select(['xp', 'level'])
        .where('id', '=', id)
        .executeTakeFirst();
      return after ?? null;
    },

    syncLevel,

    /** Statement that adds XP, for atomic lists (rewards). */
    addXpStatement(id: string, delta: number): CompiledQuery {
      return k
        .updateTable('players')
        .set((eb) => ({ xp: eb('xp', '+', delta) }))
        .where('id', '=', id)
        .compile();
    },

    /** Every row stored about the player (R-SEC-010). Null when the player does not exist. */
    async exportData(id: string, now: number = ctx.now()): Promise<PlayerExport | null> {
      const player = await getById(id);
      if (!player) return null;
      const [
        sessions,
        oauth,
        items,
        cards,
        loadouts,
        ratings,
        battles,
        members,
        owned,
        trades,
        friends,
        quests,
        grants,
        audit,
      ] = await Promise.all([
        k
          .selectFrom('sessions')
          .select(['id', 'created_at', 'expires_at'])
          .where('player_id', '=', id)
          .orderBy('id')
          .execute(),
        k
          .selectFrom('oauth_accounts')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('id')
          .execute(),
        k
          .selectFrom('inventory_items')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('item_id')
          .execute(),
        k
          .selectFrom('inventory_cards')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('ability_id')
          .execute(),
        k.selectFrom('loadouts').selectAll().where('player_id', '=', id).orderBy('id').execute(),
        k
          .selectFrom('ratings')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('format')
          .orderBy('bracket')
          .execute(),
        k
          .selectFrom('battles')
          .selectAll()
          .where((eb) => eb.or([eb('white_id', '=', id), eb('black_id', '=', id)]))
          .orderBy('id')
          .execute(),
        k
          .selectFrom('guild_members')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('guild_id')
          .execute(),
        k.selectFrom('guilds').selectAll().where('owner_id', '=', id).orderBy('id').execute(),
        k
          .selectFrom('trades')
          .selectAll()
          .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
          .orderBy('id')
          .execute(),
        k
          .selectFrom('friends')
          .selectAll()
          .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
          .orderBy('a_id')
          .orderBy('b_id')
          .execute(),
        k
          .selectFrom('quest_progress')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('quest_id')
          .execute(),
        k
          .selectFrom('reward_grants')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('id')
          .execute(),
        k.selectFrom('audit_log').selectAll().where('player_id', '=', id).orderBy('id').execute(),
      ]);
      const [wallet, keyItems, flags, membership] = await Promise.all([
        k.selectFrom('wallets').select('coins').where('player_id', '=', id).executeTakeFirst(),
        k
          .selectFrom('key_items')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('key_id')
          .execute(),
        k
          .selectFrom('progress_flags')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('flag')
          .execute(),
        k.selectFrom('party_members').selectAll().where('player_id', '=', id).executeTakeFirst(),
      ]);
      const [billingAccount, billingEvents] = await Promise.all([
        k.selectFrom('billing_accounts').selectAll().where('player_id', '=', id).executeTakeFirst(),
        k
          .selectFrom('billing_events')
          .selectAll()
          .where('player_id', '=', id)
          .orderBy('occurred_at')
          .orderBy('id')
          .execute(),
      ]);
      const escrows = await k
        .selectFrom('wager_escrows')
        .selectAll()
        .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
        .orderBy('id')
        .execute();
      const [guildInvites, ratedGames] = await Promise.all([
        k
          .selectFrom('guild_invites')
          .selectAll()
          .where((eb) => eb.or([eb('player_id', '=', id), eb('invited_by', '=', id)]))
          .orderBy('created_at')
          .orderBy('guild_id')
          .execute(),
        k
          .selectFrom('rated_games')
          .selectAll()
          .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
          .orderBy('at')
          .orderBy('battle_id')
          .execute(),
      ]);
      const [mutes, blocks, filed, about] = await Promise.all([
        k
          .selectFrom('mutes')
          .select(['target_id', 'created_at'])
          .where('player_id', '=', id)
          .orderBy('created_at')
          .orderBy('target_id')
          .execute(),
        k
          .selectFrom('blocks')
          .select(['target_id', 'created_at'])
          .where('player_id', '=', id)
          .orderBy('created_at')
          .orderBy('target_id')
          .execute(),
        k
          .selectFrom('reports')
          .selectAll()
          .where('reporter_id', '=', id)
          .orderBy('created_at')
          .orderBy('id')
          .execute(),
        k
          .selectFrom('reports')
          .select(['id', 'reason', 'status', 'created_at'])
          .where('target_id', '=', id)
          .orderBy('created_at')
          .orderBy('id')
          .execute(),
      ]);
      const entries = await k
        .selectFrom('tournament_entries')
        .innerJoin('tournaments', 'tournaments.id', 'tournament_entries.tournament_id')
        .select([
          'tournament_entries.tournament_id',
          'tournament_entries.registered_at',
          'tournament_entries.place',
          'tournament_entries.points',
          'tournaments.name',
          'tournaments.format',
          'tournaments.system',
          'tournaments.status',
          'tournaments.starts_at',
        ])
        .where('tournament_entries.player_id', '=', id)
        .orderBy('tournament_entries.registered_at')
        .orderBy('tournament_entries.tournament_id')
        .execute();
      const battleIds = battles.map((b) => b.id);
      const wagers =
        battleIds.length === 0
          ? []
          : await k
              .selectFrom('wagers')
              .selectAll()
              .where('battle_id', 'in', battleIds)
              .orderBy('id')
              .execute();
      return {
        exportedAt: now,
        player,
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
        oauthAccounts: oauth.map((o) => ({
          provider: o.provider,
          providerUserId: o.provider_user_id,
          createdAt: o.created_at,
        })),
        inventory: {
          items: items.filter((i) => i.qty > 0).map((i) => ({ itemId: i.item_id, qty: i.qty })),
          cards: cards
            .filter((c) => c.qty > 0)
            .map((c) => ({ abilityId: c.ability_id, qty: c.qty })),
        },
        loadouts: loadouts.map((r) => toLoadout(ctx, r)),
        ratings: ratings.map(toRating),
        battles: battles.map(toBattle),
        wagers: wagers.map((w) => toWager(ctx, w)),
        wagerEscrows: escrows.map((e) => toEscrow(ctx, e)),
        guildMemberships: members.map((m) => ({
          guildId: m.guild_id,
          rank: m.rank,
          joinedAt: m.joined_at,
        })),
        guildInvites: guildInvites.map((i) => ({
          guildId: i.guild_id,
          playerId: i.player_id,
          invitedBy: i.invited_by,
          createdAt: i.created_at,
        })),
        ratedGames: ratedGames.map(toRatedGame),
        guildsOwned: owned.map((g) => ({
          id: g.id,
          name: g.name,
          tag: g.tag,
          createdAt: g.created_at,
        })),
        trades: trades.map((t) => ({
          id: t.id,
          aId: t.a_id,
          bId: t.b_id,
          status: t.status,
          offer: ctx.json.decode('trades.offer_json', JsonObject, t.offer_json),
          createdAt: t.created_at,
          completedAt: t.completed_at,
        })),
        friends: friends.map((f) => ({
          aId: f.a_id,
          bId: f.b_id,
          status: f.status,
          createdAt: f.created_at,
        })),
        quests: quests.map((q) => ({
          questId: q.quest_id,
          step: q.step,
          data: ctx.json.decode('quest_progress.data_json', JsonObject, q.data_json),
          updatedAt: q.updated_at,
        })),
        rewardGrants: grants.map((g) => toRewardGrant(ctx, g)),
        coins: wallet?.coins ?? 0,
        keyItems: keyItems.map((r) => ({ keyId: r.key_id, acquiredAt: r.acquired_at })),
        progressFlags: flags.map((f) => ({ flag: f.flag, at: f.at })),
        partyId: membership?.party_id ?? null,
        billing: {
          account: billingAccount ? toBillingAccount(billingAccount) : null,
          events: billingEvents.map((e) => toBillingEvent(ctx, e)),
        },
        auditLog: audit.map((a) => ({
          id: a.id,
          playerId: a.player_id,
          kind: a.kind,
          payload: ctx.json.decode('audit_log.payload_json', JsonObject, a.payload_json),
          at: a.at,
        })),
        mutes: mutes.map((m) => ({ targetId: m.target_id, createdAt: m.created_at })),
        blocks: blocks.map((b) => ({ targetId: b.target_id, createdAt: b.created_at })),
        reportsFiled: filed.map((r) => ({
          id: r.id,
          targetId: r.target_id,
          reason: r.reason,
          note: r.note,
          context:
            r.context_json === null
              ? null
              : ctx.json.decode('reports.context_json', ReportContextJson, r.context_json),
          status: r.status,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
        })),
        reportsAbout: about.map((r) => ({
          id: r.id,
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at,
        })),
        tournaments: entries.map((e) => ({
          tournamentId: e.tournament_id,
          name: e.name,
          format: e.format,
          system: e.system,
          status: e.status,
          startsAt: e.starts_at,
          registeredAt: e.registered_at,
          place: e.place,
          points: e.points === null ? null : Number(e.points),
        })),
      };
    },

    /**
     * Deletes the account and every row that belongs to it in one atomic list (R-SEC-010). Shared
     * records keep the other party's history with this player's side set to NULL: battles (white_id,
     * black_id), trades (a_id, b_id) and guilds it owned (owner_id). Returns false when no such player.
     */
    async delete(id: string): Promise<boolean> {
      const player = await k
        .selectFrom('players')
        .select('email')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!player) return false;
      const guild = await k
        .selectFrom('guild_members')
        .select('guild_id')
        .where('player_id', '=', id)
        .executeTakeFirst();
      const byPlayer = [
        'sessions',
        'oauth_accounts',
        'inventory_items',
        'inventory_cards',
        'loadouts',
        'ratings',
        'guild_members',
        'quest_progress',
        'reward_grants',
        'audit_log',
        'wallets',
        'key_items',
        'progress_flags',
        'party_members',
        'billing_events',
        'billing_accounts',
      ] as const;
      const statements: CompiledQuery[] = [
        ...byPlayer.map((t) => k.deleteFrom(t).where('player_id', '=', id).compile()),
        k.deleteFrom('login_tokens').where('email', '=', player.email).compile(),
        // A party this player leads dissolves (its other members leave it).
        k
          .deleteFrom('party_members')
          .where('party_id', 'in', (eb) =>
            eb.selectFrom('parties').select('id').where('leader_id', '=', id),
          )
          .compile(),
        k.deleteFrom('parties').where('leader_id', '=', id).compile(),
        k
          .deleteFrom('friends')
          .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
          .compile(),
        k.updateTable('guilds').set({ owner_id: null }).where('owner_id', '=', id).compile(),
        k.updateTable('battles').set({ white_id: null }).where('white_id', '=', id).compile(),
        k.updateTable('battles').set({ black_id: null }).where('black_id', '=', id).compile(),
        k.updateTable('trades').set({ a_id: null }).where('a_id', '=', id).compile(),
        k.updateTable('trades').set({ b_id: null }).where('b_id', '=', id).compile(),
        k.updateTable('wager_escrows').set({ a_id: null }).where('a_id', '=', id).compile(),
        k.updateTable('wager_escrows').set({ b_id: null }).where('b_id', '=', id).compile(),
        // M6 guilds: leave the guild (a leader hands over, an empty guild goes), drop invitations.
        ...(guild ? guildRemovalStatements(k, guild.guild_id, id) : []),
        k.deleteFrom('guild_invites').where('player_id', '=', id).compile(),
        k
          .updateTable('guild_invites')
          .set({ invited_by: null })
          .where('invited_by', '=', id)
          .compile(),
        // M6 ranked: the opponent's rated history stays with this side anonymized.
        k.updateTable('rated_games').set({ a_id: null }).where('a_id', '=', id).compile(),
        k.updateTable('rated_games').set({ b_id: null }).where('b_id', '=', id).compile(),
        // M6 6.4: mutes and blocks both ways go; reports about the player go with the account;
        // reports the player filed or closed stay for the moderators with this side anonymized.
        k
          .deleteFrom('mutes')
          .where((eb) => eb.or([eb('player_id', '=', id), eb('target_id', '=', id)]))
          .compile(),
        k
          .deleteFrom('blocks')
          .where((eb) => eb.or([eb('player_id', '=', id), eb('target_id', '=', id)]))
          .compile(),
        k.deleteFrom('reports').where('target_id', '=', id).compile(),
        k.updateTable('reports').set({ reporter_id: null }).where('reporter_id', '=', id).compile(),
        k.updateTable('reports').set({ resolved_by: null }).where('resolved_by', '=', id).compile(),
        // M7 7.1: tournament entries go (an open event's count drops); winner and creator clear.
        ...tournamentRemovalStatements(k, id),
        k.deleteFrom('players').where('id', '=', id).compile(),
      ];
      const counts = await ctx.atomic(statements);
      return counts[counts.length - 1] === 1;
    },
  };
}

export type PlayerRepo = ReturnType<typeof playerRepo>;
