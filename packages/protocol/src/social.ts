/**
 * Ranked play, leaderboards and guilds (M6 6.1, 6.2; spec 9.3 R-FMT-004, 10.4 R-WORLD-004): REST
 * bodies and answers. The server validates every body with these schemas; the client uses the types.
 * Guild chat itself travels on the zone socket (`chat {ch:'guild'}` / `chatmsg`, zone.ts).
 */
import { z } from 'zod';
import { Format } from './battle.ts';

const Id = z.string().min(1).max(64);
const Name = z.string().max(40);

/** Ranked brackets by unlocked item slots (9.3): 1–2, 3–4, 5–6. */
export const Bracket = z.enum(['1-2', '3-4', '5-6']);
export type Bracket = z.infer<typeof Bracket>;

// ---- Ranked (9.3) ------------------------------------------------------------------------------

/** `POST /api/ranked/ticket`: queue for a ranked format with a saved loadout. */
export const JoinRanked = z.object({ format: Format, loadoutId: z.string().max(64) });
export type JoinRanked = z.infer<typeof JoinRanked>;

/** A player's standing in one format and bracket. */
export const RatingView = z.object({
  format: Format,
  bracket: Bracket,
  /** Glicko-2 rating (1500 for a new player), rounded. */
  rating: z.number().int(),
  rd: z.number().int().min(0),
  games: z.number().int().min(0),
  /** Place on the leaderboard; null while hidden (too few games or a high deviation). */
  rank: z.number().int().min(1).nullable(),
  /** Hidden from the leaderboard: fewer games than required or a deviation above the limit. */
  provisional: z.boolean(),
});
export type RatingView = z.infer<typeof RatingView>;

/** Answer of `POST /api/ranked/ticket`: the queue socket and where the player stands. */
export const RankedTicket = z.object({
  url: z.string().max(1024),
  format: Format,
  bracket: Bracket,
  rating: RatingView,
});
export type RankedTicket = z.infer<typeof RankedTicket>;

/** Answer of `GET /api/ratings/me`. */
export const MyRatings = z.object({
  /** The bracket the player's level puts them in (unlocked slots, never the loadout). */
  bracket: Bracket,
  /** Formats with a ranked queue. */
  formats: z.array(Format),
  ratings: z.array(RatingView),
});
export type MyRatings = z.infer<typeof MyRatings>;

// ---- Leaderboards (10.4) -----------------------------------------------------------------------

/** Query of `GET /api/leaderboards` and `GET /api/leaderboards/guilds`. */
export const LeaderboardQuery = z.object({
  format: Format,
  bracket: Bracket,
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuery>;

export const LeaderboardEntry = z.object({
  rank: z.number().int().min(1),
  id: Id,
  name: Name,
  rating: z.number().int(),
  rd: z.number().int().min(0),
  games: z.number().int().min(0),
  /** The player's guild tag, if any. */
  tag: z.string().max(8).nullable(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const Leaderboard = z.object({
  format: Format,
  bracket: Bracket,
  entries: z.array(LeaderboardEntry),
  /** The signed-in player's own standing in this format and bracket (null: never played it). */
  me: RatingView.nullable(),
  /** Who is listed: at least `minGames` rated games and a deviation of at most `maxRd`. */
  rules: z.object({ minGames: z.number().int(), maxRd: z.number().int() }),
});
export type Leaderboard = z.infer<typeof Leaderboard>;

export const GuildBoardEntry = z.object({
  rank: z.number().int().min(1),
  id: Id,
  name: Name,
  tag: z.string().max(8),
  /** Mean rating of the guild's best listed members, rounded. */
  score: z.number().int(),
  /** Listed members counted in the score. */
  rated: z.number().int().min(0),
});
export type GuildBoardEntry = z.infer<typeof GuildBoardEntry>;

export const GuildLeaderboard = z.object({
  format: Format,
  bracket: Bracket,
  entries: z.array(GuildBoardEntry),
  /** The signed-in player's guild on this board (null: no guild, or not listed). */
  mine: GuildBoardEntry.nullable(),
  rules: z.object({ top: z.number().int(), minRated: z.number().int() }),
});
export type GuildLeaderboard = z.infer<typeof GuildLeaderboard>;

// ---- Guilds (10.4) -----------------------------------------------------------------------------

/**
 * A guild name: 3–24 letters, digits, spaces, apostrophes or hyphens, starting and ending with a
 * letter or digit; inner whitespace collapses to one space. Unique regardless of case.
 */
export const GuildName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(3)
      .max(24)
      .regex(/^[\p{L}\p{N}](?:[\p{L}\p{N} '-]*[\p{L}\p{N}])?$/u),
  );

/** A short tag shown next to member names: 2–5 letters or digits, stored upper case. */
export const GuildTag = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,5}$/));

export const GuildRank = z.enum(['leader', 'officer', 'member']);
export type GuildRank = z.infer<typeof GuildRank>;

/** `POST /api/guilds`. */
export const CreateGuild = z.object({ name: GuildName, tag: GuildTag });
export type CreateGuild = z.infer<typeof CreateGuild>;

/** `POST /api/guilds/invites`: invite a player (display name or id) to the caller's guild. */
export const GuildInviteBody = z.object({ to: z.string().trim().min(1).max(64) });

/**
 * `PUT /api/guilds/members/:id`: a new rank. The leader promotes members to officer and demotes
 * officers to member; `leader` hands leadership to an officer (the old leader becomes an officer).
 */
export const SetGuildRank = z.object({ rank: GuildRank });

export const GuildMemberView = z.object({
  id: Id,
  name: Name,
  rank: GuildRank,
  level: z.number().int().min(1),
  /** In a zone right now (presence). */
  online: z.boolean(),
  joinedAt: z.number().int(),
});
export type GuildMemberView = z.infer<typeof GuildMemberView>;

export const GuildView = z.object({
  id: Id,
  name: Name,
  tag: z.string().max(8),
  size: z.number().int().min(0),
  maxMembers: z.number().int().min(1),
  createdAt: z.number().int(),
  /** Leader first, then officers, then members; each by join time. */
  members: z.array(GuildMemberView),
  /** Pending invitations (visible to the leader and officers only; empty for members). */
  invited: z.array(z.object({ id: Id, name: Name, at: z.number().int() })),
});
export type GuildView = z.infer<typeof GuildView>;

export const GuildInviteView = z.object({
  guildId: Id,
  name: Name,
  tag: z.string().max(8),
  /** Who invited (null when that account was deleted). */
  from: Name.nullable(),
  at: z.number().int(),
});
export type GuildInviteView = z.infer<typeof GuildInviteView>;

/** Answer of `GET /api/guilds/me` and of every guild action. */
export const MyGuild = z.object({
  guild: GuildView.nullable(),
  /** The caller's rank in `guild`. */
  rank: GuildRank.nullable(),
  /** Invitations waiting for the caller. */
  invites: z.array(GuildInviteView),
});
export type MyGuild = z.infer<typeof MyGuild>;
