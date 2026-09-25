/**
 * Global caps (spec 13.5, R-LOAD-001). Modules and the loadout validator read these; nothing else
 * hard-codes a limit. PLAYTEST and PROVISIONAL values live here, never in engine code.
 */
import type { Caps, FormatDef } from '@chain-theorem/rules/sdk';

export const FORMATS: Caps['FORMATS'] = {
  // R-FMT-001: objective COMMITTED, clock PROVISIONAL.
  first_blood: {
    id: 'first_blood',
    name: 'First Blood',
    objective: { nonPawnCaptures: 1 },
    clock: { initialMs: 3 * 60_000, incrementMs: 2_000 },
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    objective: { nonPawnCaptures: 3 },
    clock: { initialMs: 5 * 60_000, incrementMs: 3_000 },
  },
  full: {
    id: 'full',
    name: 'Full Battle',
    objective: null,
    clock: { initialMs: 10 * 60_000, incrementMs: 5_000 },
  },
} satisfies Record<string, FormatDef>;

export const CAPS = {
  LEVEL_CAP: 30,
  // R-LOAD-001 (COMMITTED): slots = min(6, 1 + floor(level / 5)).
  itemSlots: (level: number) => Math.min(6, 1 + Math.floor(level / 5)),
  MAX_ITEM_SLOTS: 6,
  BASE_ABILITY_CAPACITY: 1,
  MAX_ABILITY_CAPACITY: 5,
  MAX_CHAIN_DEPTH: 3,
  // R-ELEM-002 tuning knob: 'ALL_TRIGGERS' (default) | 'REACTIONS_ONLY' | 'OFF'.
  SILENCE_SCOPE: 'ALL_TRIGGERS',
  // 6.5 (COMMITTED rollout): the MVP shipped Ember, Tide and Grove; M7 7.3 adds Storm, Stone and
  // Frost, each with six creatures and at least four affinity abilities.
  ENABLED_ELEMENTS: ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'],
  FORMATS,
  MAX_EVENTS_PER_ACTION: 512,
} as const satisfies Caps;

/** Hot Foot burns for this many turns of the igniting player's opponent (D-40, COMMITTED). */
export const HOT_FOOT_TURNS = 3;
/** Saved loadouts per player (7.4, PROVISIONAL). */
export const MAX_SAVED_LOADOUTS = 5;
/** Mid-action choice prompt, charged to the chooser's clock (5.4). */
export const CHOICE_PROMPT_MS = 15_000;
/** Disconnect grace while the clock keeps running (9.2, PROVISIONAL). */
export const DISCONNECT_GRACE_MS = 60_000;
/** Draw offers: at most one per this many moves (9.2). */
export const DRAW_OFFER_EVERY_MOVES = 10;

/**
 * Spectating (10.4 "delayed, public-projection-only view of live battles"; M7 7.2). PLAYTEST values.
 * The delay is counted in plies, not seconds: spectators see a battle up to `delayPlies` behind the
 * live position (everything once it ends), so no timer or extra alarm is needed.
 */
export const SPECTATE = {
  /** Spectators see the position this many plies behind the live one. */
  delayPlies: 2,
  /** Spectator sockets per battle room; more are refused. */
  maxPerRoom: 50,
  /** Live battles listed by `GET /api/battles/live`. */
  listLimit: 20,
  /** A listed battle that started longer ago than this is not listed (a stale row). */
  listMaxAgeMs: 6 * 60 * 60 * 1000,
};

/**
 * Ranked play (9.3 R-FMT-004, 15 R-SEC-008; M6 6.2). PLAYTEST values. Brackets come from the item
 * slots unlocked at the player's level (7.1), never from the loadout, so unequipping cannot sandbag.
 */
export const RANKED = {
  /** Formats with a ranked queue (9.1: Vanguard is quick ranked, Full Battle is ranked). */
  formats: ['vanguard', 'full'] as readonly string[],
  /**
   * R-SEC-008: rated games against the same opponent that may change ratings within 24 hours (any
   * format); later games in that window are recorded unrated and the pairing is flagged.
   */
  sameOpponentPerDay: 3,
  /**
   * Pairing window in rating points: `base` for the first `widenAfterMs` of waiting, then `step`
   * more every `widenEveryMs`, up to `max`. Both players' windows must allow a pair.
   */
  window: { base: 100, widenAfterMs: 15_000, widenEveryMs: 10_000, step: 50, max: 1000 },
  /** Glicko-2 rating period: RD grows by one idle period for each full period without a game. */
  ratingPeriodMs: 7 * 24 * 60 * 60 * 1000,
};

/** Leaderboards (10.4 R-WORLD-004), per format and bracket. PLAYTEST values. */
export const LEADERBOARD = {
  /** Rows shown. */
  size: 50,
  /** Players with a rating deviation above this are hidden (still provisional). */
  maxRd: 200,
  /** Players with fewer rated games than this are hidden. */
  minGames: 5,
  /** A guild's score is the mean of its best `guildTop` listed members' ratings... */
  guildTop: 5,
  /** ...and a guild is listed once it has at least this many listed members. */
  guildMinRated: 2,
};

/** Guilds (10.4 R-WORLD-004). PLAYTEST values. */
export const GUILDS = {
  /** Members per guild, enforced by a database CHECK inside every join (DD-15). */
  maxMembers: 50,
  /** A guild invitation nobody answered expires after this long (M6 6.4). */
  inviteTtlMs: 7 * 24 * 60 * 60 * 1000,
};

/** Trade and wager invitations (10.4, 9.5; M6 6.4). PLAYTEST values. */
export const TRADE_INVITES = {
  /** Invitations one player may have waiting for an answer at once. */
  open: 1,
  /** Invitations one player may send per minute (answered or not). */
  perMinute: 3,
};

/**
 * Report, mute and block (15 R-SEC-011: available to everyone; M6 6.4). PLAYTEST values. The
 * report reasons are a fixed list in the protocol (`ReportReason`).
 */
export const SAFETY = {
  /** Reports one player may file per rolling 24 hours. */
  reportsPerDay: 10,
  /** Longest optional note on a report. */
  reportNoteMax: 500,
  /** Players one player may mute. */
  maxMutes: 200,
  /** Players one player may block. */
  maxBlocks: 200,
};

/**
 * Tournaments (10.4 R-WORLD-004, 9.3 R-FMT-004; M7 7.1). PLAYTEST values. Events run per format
 * and slot bracket (the slots UNLOCKED at the player's level, never the loadout); one
 * TournamentRoom per event holds registration, pairings and results.
 */
export const TOURNAMENTS = {
  /** Formats an event may use (9.1: Full Battle is the tournament format; admins may pick others). */
  formats: ['full', 'vanguard', 'first_blood'] as readonly string[],
  /** Field size when the admin gives none, and the largest allowed. */
  maxPlayers: 32,
  maxPlayersLimit: 64,
  /** Fewer registered players than this at the start cancels the event. */
  minPlayers: 2,
  /** Swiss rounds: ceil(log2(players)) + this, at most a full round robin. */
  extraSwissRounds: 1,
  /** Pause between a round's pairings being published and its battles starting. */
  breakMs: 60_000,
  /** Points for a Swiss bye (at most one per player). */
  byePoints: 1,
  /** A drawn single-elimination game: this colour advances (draw odds for the second mover). */
  seDrawAdvances: 'black' as 'white' | 'black',
  /** A player who does not start this many games is withdrawn from later rounds. */
  withdrawAfterNoShows: 1,
  /** A live round re-reads its unfinished battles from the database this often (a lost result). */
  watchdogMs: 5 * 60_000,
  /** A failed prize grant is retried after this long (grants are idempotent, R-SEC-003). */
  prizeRetryMs: 60_000,
  /** Prizes by final place, granted once under `tournament:<id>:<player>`. */
  prizes: [
    { place: 1, xp: 250, coins: 200 },
    { place: 2, xp: 150, coins: 100 },
    { place: 3, xp: 100, coins: 50 },
  ] as readonly { place: number; xp: number; coins: number }[],
  /** Scheduled events: one per slot bracket each day at `hourUtc` (created when first listed). */
  schedule: [{ system: 'swiss', format: 'full', hourUtc: 19, maxPlayers: 32 }] as readonly {
    system: 'swiss' | 'se';
    format: string;
    hourUtc: number;
    maxPlayers: number;
  }[],
  /** How far ahead a scheduled event is listed (and open for registration). */
  scheduleAheadMs: 24 * 60 * 60 * 1000,
};
