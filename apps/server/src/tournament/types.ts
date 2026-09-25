/**
 * Types of the pure tournament core (M7 7.1; spec 10.4 R-WORLD-004, 12.2 TournamentRoom): what the
 * TournamentRoom Durable Object passes in, persists and runs. Plain JSON data, so a hibernated or
 * evicted room resumes from storage.
 */
import type {
  Bracket,
  TournamentNotice,
  TournamentPrize,
  TournamentResult,
  TournamentStatus,
  TournamentSystem,
} from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';

/** The PLAYTEST rules a tournament runs with, copied from config when it is created. */
export interface TournamentRules {
  minPlayers: number;
  extraSwissRounds: number;
  byePoints: number;
  seDrawAdvances: 'white' | 'black';
  withdrawAfterNoShows: number;
  watchdogMs: number;
  prizeRetryMs: number;
}

export interface TournamentInit {
  id: string;
  name: string;
  format: FormatId;
  bracket: Bracket;
  system: TournamentSystem;
  /** Registration closes and round 1 is paired at this time (the alarm). */
  startsAt: number;
  maxPlayers: number;
  /** Swiss rounds asked for by the admin (capped at a round robin at the start); null: default. */
  rounds: number | null;
  /** Pause between a round's pairings and its battles. */
  breakMs: number;
  prizes: TournamentPrize[];
  rules: TournamentRules;
  createdAt: number;
}

export interface Entrant {
  id: string;
  name: string;
  level: number;
  registeredAt: number;
  /** Glicko-2 rating in the format and bracket at the start (1500 when unrated). */
  rating: number;
  /** 1 = the highest rating at the start; 0 before the start. */
  seed: number;
  /** Withdrew (on request, or after too many games not started). */
  withdrawn: boolean;
  /** Games this player never started. */
  noShows: number;
  /** The account was deleted: the name is replaced (R-SEC-010). */
  deleted?: boolean;
}

export interface Pairing {
  board: number;
  /** Single elimination: the match index in bracket order. */
  slot?: number;
  white: string;
  /** Null: a bye for `white`. */
  black: string | null;
  /** `t-<tournament>-<round>-<board>`; null for a bye. */
  battleId: string | null;
  result: TournamentResult | null;
  /** Players who never started the game (forfeit losses). */
  absent: string[];
  reason: string | null;
}

export interface Round {
  n: number;
  /** When the battles are created; the pairings are public from the moment the round is paired. */
  startsAt: number;
  started: boolean;
  finishedAt: number | null;
  pairings: Pairing[];
  /** Single elimination: the players entering this round in bracket order. */
  field?: (string | null)[];
  /** The next watchdog read of unfinished battles (a started, unfinished round). */
  checkAt: number | null;
}

export interface Place {
  id: string;
  place: number;
  points: number;
}

export interface TournamentSnapshot {
  v: 1;
  init: TournamentInit;
  status: TournamentStatus;
  entrants: Entrant[];
  /** Rounds planned at the start (0 before). */
  plannedRounds: number;
  rounds: Round[];
  startedAt: number | null;
  finishedAt: number | null;
  winner: string | null;
  /** Final places (once finished). */
  places: Place[];
  /** The end (database row, places, prizes) is written until the host confirms it. */
  settle: 'none' | 'pending' | 'done';
  settleAt: number | null;
  /** Increases with every visible change (the tournament page polls). */
  rev: number;
}

/** A finished battle as the tournament sees it (from `settleBattle`, or the watchdog). */
export interface GameOutcome {
  winner: 'white' | 'black' | null;
  reason: string;
  /** Sides that never started the game (never sent a frame before the grace ended). */
  absent: { white: boolean; black: boolean };
}

export interface PrizeGrant {
  playerId: string;
  place: number;
  /** `tournament:<id>:<player>`: one grant per player and tournament (R-SEC-003). */
  key: string;
  xp: number;
  coins: number;
}

export interface Game {
  battleId: string;
  white: string;
  black: string;
}

export type Effect =
  /** The start is due: load each entrant's rating and level, then call `start`. */
  | { kind: 'start' }
  /** Create these BattleRooms (origin `tournament`), then report games that could not start. */
  | { kind: 'battles'; round: number; games: Game[] }
  /** Tell a player in the world (zone `notify`, `tourney`). */
  | { kind: 'notify'; to: string; notice: TournamentNotice }
  /** Watchdog: read these unfinished battles from the database (a result call may have been lost). */
  | { kind: 'check'; round: number; games: Game[] }
  /** Write the end: the database row and places, then the prizes; report with `settled`. */
  | { kind: 'settle'; winner: string | null; places: Place[]; grants: PrizeGrant[] }
  | { kind: 'error'; message: string };

export interface Outbox {
  effects: Effect[];
  /** Store `snapshot()`. */
  save: boolean;
  /** The database summary row changed (status, round, rounds, winner). */
  sync: boolean;
}
