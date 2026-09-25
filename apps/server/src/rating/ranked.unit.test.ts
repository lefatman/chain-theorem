/**
 * Ranked play, pure (M6 6.2): brackets from unlocked slots (R-FMT-004), rating-window pairing with
 * both windows required, Glicko-2 plans per game, idle RD growth, and the same-opponent cap with its
 * flag (R-SEC-008).
 */
import { describe, expect, it } from 'vitest';
import { CAPS, LEADERBOARD, RANKED, engine } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import { nextRankedWiden, pairRanked } from '../match/pairing.ts';
import { DEFAULT_RATING } from './glicko2.ts';
import {
  bracketForLevel,
  isRankedFormat,
  nextWindowChange,
  planRatedGame,
  provisional,
  ratingWindow,
  withIdle,
  type StoredRating,
} from './ranked.ts';

const W = RANKED.window;
const at = (rating: number, over: Partial<StoredRating> = {}): StoredRating => ({
  rating,
  rd: 80,
  volatility: 0.06,
  games: 20,
  updatedAt: 0,
  ...over,
});

describe('ranked brackets (R-FMT-004)', () => {
  it('R-FMT-004 the bracket follows the item slots unlocked at the level: 1–2, 3–4, 5–6', () => {
    const byLevel = [1, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 30].map((l) => [
      l,
      bracketForLevel(l),
    ]);
    expect(byLevel).toEqual([
      [1, '1-2'],
      [4, '1-2'],
      [5, '1-2'],
      [9, '1-2'],
      [10, '3-4'],
      [14, '3-4'],
      [15, '3-4'],
      [19, '3-4'],
      [20, '5-6'],
      [24, '5-6'],
      [25, '5-6'],
      [30, '5-6'],
    ]);
    for (let l = 1; l <= CAPS.LEVEL_CAP; l++)
      expect(bracketForLevel(l)).toBe(bracketForLevel(l, (x) => CAPS.itemSlots(x)));
  });

  it('R-FMT-004 a player who unequips items stays in the same bracket (slots unlocked, not used)', () => {
    // A level-20 player has 5 unlocked slots. An empty loadout uses none of them, a full one all
    // five; the bracket is the level's either way (the ranked socket also checks this end to end).
    const empty: Loadout = { elements: ['ember'], items: [], sets: [['hit_and_run']] };
    const used = (l: Loadout) => l.items.length;
    expect(engine.caps.itemSlots(20)).toBe(5);
    expect(used(empty)).toBe(0);
    expect(bracketForLevel(20)).toBe('5-6');
    // Using fewer slots would read as the 1-2 bracket if consumed slots counted; they do not.
    expect(bracketForLevel(20)).not.toBe(bracketForLevel(used(empty)));
    expect(bracketForLevel(19)).toBe('3-4');
  });

  it('R-FMT-004 ranked queues exist for Vanguard and Full Battle (9.1), not First Blood', () => {
    expect(isRankedFormat('vanguard')).toBe(true);
    expect(isRankedFormat('full')).toBe(true);
    expect(isRankedFormat('first_blood')).toBe(false);
  });
});

describe('ranked pairing (R-FMT-004)', () => {
  const w = (id: string, rating: number, since = 0) => ({ id, rating, level: 1, since });
  const ids = (ps: [{ id: string }, { id: string }][]) => ps.map(([a, b]) => `${a.id}-${b.id}`);

  it('R-FMT-004 the rating window starts narrow and widens with waiting, up to its maximum', () => {
    expect(ratingWindow(0)).toBe(W.base);
    expect(ratingWindow(W.widenAfterMs - 1)).toBe(W.base);
    expect(ratingWindow(W.widenAfterMs)).toBe(W.base + W.step);
    expect(ratingWindow(W.widenAfterMs + W.widenEveryMs)).toBe(W.base + 2 * W.step);
    expect(ratingWindow(10 * 60 * 60_000)).toBe(W.max);
    expect(nextWindowChange(0, 0)).toBe(W.widenAfterMs);
    expect(nextWindowChange(0, W.widenAfterMs)).toBe(W.widenAfterMs + W.widenEveryMs);
    expect(nextWindowChange(0, 10 * 60 * 60_000)).toBeNull();
  });

  it('R-FMT-004 pairs by rating: closest first, oldest first, and both windows must allow the gap', () => {
    expect(ids(pairRanked([w('a', 1500), w('b', 1590), w('c', 1520)], 0))).toEqual(['a-c']);
    expect(ids(pairRanked([w('a', 1500), w('b', 1500 + W.base + 1)], 0))).toEqual([]);
    const gap = W.base + W.step;
    // a waited long enough for the wider window, b just arrived: no pair yet.
    expect(
      ids(pairRanked([w('a', 1500, 0), w('b', 1500 + gap, 20_000)], W.widenAfterMs + 1)),
    ).toEqual([]);
    // Both waited: paired.
    expect(ids(pairRanked([w('a', 1500, 0), w('b', 1500 + gap, 0)], W.widenAfterMs))).toEqual([
      'a-b',
    ]);
    const r = pairRanked([w('a', 1500), w('a', 1500), w('b', 1500), w('c', 1500)], 0);
    const seen = r.flat().map((x) => x.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('R-FMT-004 the next widening drives the ranked Matchmaker alarm', () => {
    expect(nextRankedWiden([w('a', 1500)], 0)).toBeNull();
    expect(nextRankedWiden([w('a', 1500, 0), w('b', 2000, 5_000)], 1_000)).toBe(W.widenAfterMs);
  });
});

describe('rating a ranked battle (R-FMT-004, R-SEC-008)', () => {
  it('R-FMT-004 Glicko-2: the winner gains, the loser loses, both from their ratings before the game', () => {
    const p = planRatedGame({
      white: at(1500),
      black: at(1500),
      scoreWhite: 1,
      pairRatedToday: 0,
      now: 0,
    });
    expect(p.rated).toBe(true);
    expect(p.flagged).toBe(false);
    expect(p.white.delta).toBeGreaterThan(0);
    expect(p.black.delta).toBeLessThan(0);
    expect(p.white.delta).toBeCloseTo(-p.black.delta, 6);
    expect(p.white.after.rd).toBeLessThan(80);
    // An upset moves more than an expected result.
    const upset = planRatedGame({
      white: at(1300),
      black: at(1700),
      scoreWhite: 1,
      pairRatedToday: 0,
      now: 0,
    });
    const expected = planRatedGame({
      white: at(1700),
      black: at(1300),
      scoreWhite: 1,
      pairRatedToday: 0,
      now: 0,
    });
    expect(upset.white.delta).toBeGreaterThan(expected.white.delta);
    // A draw between equals changes nothing but the deviation.
    const draw = planRatedGame({
      white: at(1600),
      black: at(1600),
      scoreWhite: 0.5,
      pairRatedToday: 0,
      now: 0,
    });
    expect(draw.white.delta).toBeCloseTo(0, 6);
  });

  it('R-FMT-004 a first game starts from 1500/350; a new player moves far more than a settled one', () => {
    const p = planRatedGame({
      white: null,
      black: at(1500),
      scoreWhite: 0,
      pairRatedToday: 0,
      now: 0,
    });
    expect(p.white.before).toEqual(DEFAULT_RATING);
    expect(-p.white.delta).toBeGreaterThan(-p.black.delta * 3);
    expect(p.white.after.rating).toBeLessThan(1500);
  });

  it('R-FMT-004 idle rating periods widen the deviation (Glicko-2), never the rating', () => {
    const r = at(1650, { rd: 60, updatedAt: 0 });
    expect(withIdle(r, RANKED.ratingPeriodMs - 1)).toEqual({
      rating: 1650,
      rd: 60,
      volatility: 0.06,
    });
    const later = withIdle(r, 5 * RANKED.ratingPeriodMs);
    expect(later.rating).toBe(1650);
    expect(later.rd).toBeGreaterThan(60);
    expect(withIdle(r, 1e6 * RANKED.ratingPeriodMs).rd).toBeLessThanOrEqual(350);
  });

  it('R-SEC-008 past the per-day cap against the same opponent neither rating moves and the pairing is flagged', () => {
    const cap = RANKED.sameOpponentPerDay;
    expect(cap).toBeGreaterThan(0);
    const under = planRatedGame({
      white: at(1500),
      black: at(1500),
      scoreWhite: 1,
      pairRatedToday: cap - 1,
      now: 0,
    });
    expect(under).toMatchObject({ rated: true, flagged: false });
    const over = planRatedGame({
      white: at(1500),
      black: at(1480),
      scoreWhite: 1,
      pairRatedToday: cap,
      now: 0,
    });
    expect(over).toMatchObject({ rated: false, flagged: true });
    expect(over.white.after).toEqual(over.white.before);
    expect(over.black.after).toEqual(over.black.before);
    expect(over.white.delta).toBe(0);
    expect(over.black.delta).toBe(0);
  });

  it('R-WORLD-004 players stay off the leaderboard until settled (few games or a high deviation)', () => {
    expect(provisional({ rd: 350, games: 0 })).toBe(true);
    expect(provisional({ rd: LEADERBOARD.maxRd, games: LEADERBOARD.minGames })).toBe(false);
    expect(provisional({ rd: LEADERBOARD.maxRd + 1, games: 99 })).toBe(true);
    expect(provisional({ rd: 50, games: LEADERBOARD.minGames - 1 })).toBe(true);
  });
});
