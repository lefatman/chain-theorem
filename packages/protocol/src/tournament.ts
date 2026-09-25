/**
 * Tournaments (M7 7.1; spec 10.4 R-WORLD-004, 9.3 R-FMT-004, 12.2 TournamentRoom): REST bodies and
 * answers, and the zone notice a player in the world receives when a round is paired or their game
 * is ready. Scheduled Swiss and single-elimination events per format and slot bracket; the live
 * state (registration, pairings, results) is held by one TournamentRoom per tournament. The server
 * validates every body with these schemas; the client uses the types.
 */
import { z } from 'zod';
import { Format } from './battle.ts';
import { Bracket } from './social.ts';

const Id = z.string().min(1).max(64);
const Name = z.string().max(40);

/** Swiss (a fixed number of rounds) or single elimination (seeded by rating, byes to top seeds). */
export const TournamentSystem = z.enum(['swiss', 'se']);
export type TournamentSystem = z.infer<typeof TournamentSystem>;

/** open: registration until the start; running: rounds are played; then finished or cancelled. */
export const TournamentStatus = z.enum(['open', 'running', 'finished', 'cancelled']);
export type TournamentStatus = z.infer<typeof TournamentStatus>;

/** A game's result: a side won, a draw, or `none` (neither player started it: a double loss). */
export const TournamentResult = z.enum(['white', 'black', 'draw', 'none', 'bye']);
export type TournamentResult = z.infer<typeof TournamentResult>;

/** A prize by final place (granted once per player, R-SEC-003). */
export const TournamentPrize = z.object({
  place: z.number().int().min(1),
  xp: z.number().int().min(0),
  coins: z.number().int().min(0),
});
export type TournamentPrize = z.infer<typeof TournamentPrize>;

/**
 * `POST /api/admin/tournaments` (ADMIN_EMAILS only, audited): create an event. The start is
 * `startsAt` (epoch ms) or `startInMs` from now; `breakMs` is the pause between a round's pairings
 * and its battles (short in tests). `rounds` overrides the Swiss default (ceil(log2 n) + 1).
 */
export const CreateTournament = z
  .object({
    name: z.string().trim().min(3).max(40).optional(),
    format: Format,
    bracket: Bracket,
    system: TournamentSystem,
    startsAt: z.number().int().min(0).optional(),
    startInMs: z
      .number()
      .int()
      .min(0)
      .max(30 * 24 * 60 * 60 * 1000)
      .optional(),
    maxPlayers: z.number().int().min(2).max(64).optional(),
    rounds: z.number().int().min(1).max(12).optional(),
    breakMs: z
      .number()
      .int()
      .min(0)
      .max(10 * 60 * 1000)
      .optional(),
  })
  .strict();
export type CreateTournament = z.infer<typeof CreateTournament>;

/** A row of `GET /api/tournaments` (from the database: listing and history). */
export const TournamentSummary = z.object({
  id: Id,
  name: z.string().max(60),
  format: Format,
  bracket: Bracket,
  system: TournamentSystem,
  status: TournamentStatus,
  startsAt: z.number().int(),
  players: z.number().int().min(0),
  maxPlayers: z.number().int().min(2),
  /** Planned rounds (0 before the start). */
  rounds: z.number().int().min(0),
  /** The round being played (0 before the start). */
  round: z.number().int().min(0),
  winner: z.object({ id: Id, name: Name }).nullable(),
  /** The signed-in player is registered. */
  registered: z.boolean(),
  /** Created by the daily schedule rather than an admin. */
  scheduled: z.boolean(),
});
export type TournamentSummary = z.infer<typeof TournamentSummary>;

/** Answer of `GET /api/tournaments`: upcoming (open), live (running) and recent finished events. */
export const TournamentList = z.object({
  /** The caller's bracket (from their level: unlocked slots, never the loadout). */
  bracket: Bracket,
  upcoming: z.array(TournamentSummary),
  live: z.array(TournamentSummary),
  finished: z.array(TournamentSummary),
});
export type TournamentList = z.infer<typeof TournamentList>;

const PlayerRef = z.object({ id: Id, name: Name });

/** One game (or bye) of a round, as everyone may see it (no loadouts, no battle ids but yours). */
export const TournamentPairing = z.object({
  board: z.number().int().min(1),
  /** Single elimination: the match's place in the bracket (0-based, top to bottom). */
  slot: z.number().int().min(0).optional(),
  white: PlayerRef,
  /** Null: a bye for White. */
  black: PlayerRef.nullable(),
  result: TournamentResult.nullable(),
  /** Players who never started the game (a forfeit loss; both: a double loss). */
  absent: z.array(Id).max(2),
  /** Your own game's battle (only on your pairing). */
  battleId: Id.optional(),
});
export type TournamentPairing = z.infer<typeof TournamentPairing>;

export const TournamentRound = z.object({
  n: z.number().int().min(1),
  /** When the battles are created (the pairings are published a break before). */
  startsAt: z.number().int(),
  started: z.boolean(),
  finished: z.boolean(),
  pairings: z.array(TournamentPairing),
});
export type TournamentRound = z.infer<typeof TournamentRound>;

/**
 * A standings row. Swiss order: points, then Buchholz (the sum of the opponents' points), then
 * Sonneborn-Berger (the points of beaten opponents plus half the points of drawn ones), then the
 * seed. Single elimination: by the round reached (the winner first), then the seed; points are the
 * rounds advanced from.
 */
export const TournamentStanding = z.object({
  rank: z.number().int().min(1),
  id: Id,
  name: Name,
  seed: z.number().int().min(0),
  points: z.number().min(0),
  buchholz: z.number().min(0),
  sb: z.number().min(0),
  wins: z.number().int().min(0),
  games: z.number().int().min(0),
  /** Games never started (forfeit losses): prizes go to players who played. */
  forfeits: z.number().int().min(0),
  withdrawn: z.boolean(),
  /** Single elimination: still in the bracket. */
  alive: z.boolean(),
});
export type TournamentStanding = z.infer<typeof TournamentStanding>;

/** What the viewer is doing in this tournament. */
export const TournamentYou = z.object({
  registered: z.boolean(),
  withdrawn: z.boolean(),
  /** Your game of the current round is ready: ask for a ticket (`POST .../ticket`). */
  game: z
    .object({
      battleId: Id,
      round: z.number().int().min(1),
      colour: z.enum(['white', 'black']),
      opponent: Name,
    })
    .nullable(),
  /** Your pairing of the round that starts next (published during the break). */
  next: z
    .object({
      round: z.number().int().min(1),
      startsAt: z.number().int(),
      colour: z.enum(['white', 'black']).nullable(),
      /** Null: a bye. */
      opponent: Name.nullable(),
    })
    .nullable(),
  /** Your final place once the tournament is finished. */
  place: z.number().int().min(1).nullable(),
  /** Why you cannot register (when open and not registered), e.g. `wrong_bracket`, `full`. */
  cannot: z.string().max(32).nullable(),
});
export type TournamentYou = z.infer<typeof TournamentYou>;

/** Answer of `GET /api/tournaments/:id` and of register, unregister (the live state). */
export const TournamentView = z.object({
  id: Id,
  name: z.string().max(60),
  format: Format,
  bracket: Bracket,
  system: TournamentSystem,
  status: TournamentStatus,
  startsAt: z.number().int(),
  maxPlayers: z.number().int().min(2),
  players: z.number().int().min(0),
  rounds: z.number().int().min(0),
  round: z.number().int().min(0),
  breakMs: z.number().int().min(0),
  winner: PlayerRef.nullable(),
  entrants: z.array(
    z.object({
      id: Id,
      name: Name,
      level: z.number().int().min(1),
      seed: z.number().int().min(0),
      withdrawn: z.boolean(),
    }),
  ),
  standings: z.array(TournamentStanding),
  roundList: z.array(TournamentRound),
  prizes: z.array(TournamentPrize),
  you: TournamentYou,
  /** Changes whenever anything above changes (the page polls). */
  rev: z.number().int().min(0),
  /** Server time of the answer (countdowns). */
  now: z.number().int(),
});
export type TournamentView = z.infer<typeof TournamentView>;

/**
 * Zone notice `tourney` (through the player's presence, like `tradeIn`): a round was paired (with
 * your opponent and its start), your game is ready, or the tournament ended (your place).
 */
export const TournamentNotice = z.object({
  id: Id,
  name: z.string().max(60),
  kind: z.enum(['paired', 'game', 'finished', 'cancelled']),
  round: z.number().int().min(0).optional(),
  opponent: Name.nullable().optional(),
  startsAt: z.number().int().optional(),
  place: z.number().int().min(1).nullable().optional(),
});
export type TournamentNotice = z.infer<typeof TournamentNotice>;
