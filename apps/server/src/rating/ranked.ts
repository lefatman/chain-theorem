/**
 * Ranked play, pure (M6 6.2; spec 9.3 R-FMT-004, 15 R-SEC-008): the bracket a level puts a player in,
 * the rating window of the ranked queue, RD growth over idle rating periods, and the plan for one
 * rated battle (both Glicko-2 updates, or none when the same-opponent cap holds them). No clock reads
 * and no I/O: the caller passes the stored ratings, the pair's recent games and the time.
 */
import { CAPS, LEADERBOARD, RANKED } from '@chain-theorem/content';
import { DEFAULT_RATING, bracketForSlots, update, type Rating } from './glicko2.ts';

export type Bracket = ReturnType<typeof bracketForSlots>;
export const BRACKETS: readonly Bracket[] = ['1-2', '3-4', '5-6'];

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R-FMT-004: the bracket comes from the item slots UNLOCKED at the player's level (7.1), never from
 * the loadout, so unequipping items cannot move a player into a weaker bracket.
 */
export function bracketForLevel(
  level: number,
  itemSlots: (level: number) => number = CAPS.itemSlots,
): Bracket {
  return bracketForSlots(itemSlots(level));
}

export function isBracket(s: string): s is Bracket {
  return (BRACKETS as readonly string[]).includes(s);
}

export function isRankedFormat(format: string): boolean {
  return RANKED.formats.includes(format);
}

export interface RatingWindow {
  base: number;
  widenAfterMs: number;
  widenEveryMs: number;
  step: number;
  max: number;
}

/** How far apart (rating points) a player who waited `waitedMs` may be paired (9.3, PLAYTEST). */
export function ratingWindow(waitedMs: number, w: RatingWindow = RANKED.window): number {
  if (waitedMs < w.widenAfterMs) return w.base;
  const steps = 1 + Math.floor((waitedMs - w.widenAfterMs) / w.widenEveryMs);
  return Math.min(w.max, w.base + steps * w.step);
}

/** When `ratingWindow` next changes for a player waiting since `since`, or null at the maximum. */
export function nextWindowChange(
  since: number,
  now: number,
  w: RatingWindow = RANKED.window,
): number | null {
  const waited = now - since;
  if (ratingWindow(waited, w) >= w.max) return null;
  if (waited < w.widenAfterMs) return since + w.widenAfterMs;
  const k = Math.floor((waited - w.widenAfterMs) / w.widenEveryMs) + 1;
  return since + w.widenAfterMs + k * w.widenEveryMs;
}

/** A stored rating row (the repository's `Rating`), as far as the plan needs it. */
export interface StoredRating {
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  updatedAt: number;
}

/**
 * Glicko-2 treats time without games as rating periods in which only RD grows: one idle period per
 * full `periodMs` since the last rated game (capped at 350 by `update`).
 */
export function withIdle(
  r: StoredRating | null,
  now: number,
  periodMs = RANKED.ratingPeriodMs,
): Rating {
  if (!r) return { ...DEFAULT_RATING };
  let out: Rating = { rating: r.rating, rd: r.rd, volatility: r.volatility };
  const periods = Math.max(0, Math.floor((now - r.updatedAt) / periodMs));
  for (let i = 0; i < periods && out.rd < 350; i++) out = update(out, []);
  return out;
}

export interface PlannedSide {
  /** The rating the game was computed from (after idle growth). */
  before: Rating;
  /** The rating after the game (equal to `before` when unrated). */
  after: Rating;
  /** after.rating - before.rating (0 when unrated). */
  delta: number;
}

export interface RatedPlan {
  /** False: the same-opponent cap holds both ratings (R-SEC-008). */
  rated: boolean;
  /** R-SEC-008: this pairing went past the cap within 24 hours; flag it for review. */
  flagged: boolean;
  white: PlannedSide;
  black: PlannedSide;
}

/**
 * The plan for one finished ranked battle. Each side is updated against the other's rating from
 * before the game (one game = one rating period). Abandonment arrives as a loss (the battle result
 * names the other side the winner). When the pair already had `cap` rated games in the last 24 hours,
 * neither rating moves and the pairing is flagged.
 */
export function planRatedGame(input: {
  white: StoredRating | null;
  black: StoredRating | null;
  /** White's score: 1 win, 0.5 draw, 0 loss. */
  scoreWhite: 0 | 0.5 | 1;
  /** Rated games (that changed ratings) between the two players in the last 24 hours. */
  pairRatedToday: number;
  now: number;
  cap?: number;
  periodMs?: number;
}): RatedPlan {
  const cap = input.cap ?? RANKED.sameOpponentPerDay;
  const w = withIdle(input.white, input.now, input.periodMs);
  const b = withIdle(input.black, input.now, input.periodMs);
  if (input.pairRatedToday >= cap) {
    const still = (r: Rating): PlannedSide => ({ before: r, after: r, delta: 0 });
    return { rated: false, flagged: true, white: still(w), black: still(b) };
  }
  const scoreBlack = (1 - input.scoreWhite) as 0 | 0.5 | 1;
  const wAfter = update(w, [{ opponent: b, score: input.scoreWhite }]);
  const bAfter = update(b, [{ opponent: w, score: scoreBlack }]);
  return {
    rated: true,
    flagged: false,
    white: { before: w, after: wAfter, delta: wAfter.rating - w.rating },
    black: { before: b, after: bAfter, delta: bAfter.rating - b.rating },
  };
}

/** Hidden from the leaderboard (too few games or too uncertain), 10.4. */
export function provisional(r: { rd: number; games: number }): boolean {
  return r.games < LEADERBOARD.minGames || r.rd > LEADERBOARD.maxRd;
}
