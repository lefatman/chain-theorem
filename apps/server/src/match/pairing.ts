/**
 * Casual-queue pairing (9.3, R-FMT-004): players within ±5 levels are matched; a player's window
 * widens by one level every 10 s after 30 s of waiting (`levelWindow`). A pair needs BOTH players'
 * windows to allow it, so nobody is matched outside the range they have waited for. Oldest waiting
 * players are served first; among candidates the closest level wins, then the longest waiting.
 */
import { levelWindow } from '@chain-theorem/protocol';
import { nextWindowChange, ratingWindow } from '../rating/ranked.ts';

export interface Waiting {
  id: string;
  level: number;
  since: number;
}

export function pair<T extends Waiting>(queue: readonly T[], now: number): [T, T][] {
  const open = [...queue].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const out: [T, T][] = [];
  for (const a of open) {
    if (used.has(a.id)) continue;
    let best: T | null = null;
    for (const b of open) {
      if (b === a || used.has(b.id) || b.id === a.id) continue;
      const gap = Math.abs(a.level - b.level);
      if (gap > Math.min(levelWindow(now - a.since), levelWindow(now - b.since))) continue;
      if (!best || gap < Math.abs(a.level - best.level)) best = b;
    }
    if (best) {
      used.add(a.id);
      used.add(best.id);
      out.push([a, best]);
    }
  }
  return out;
}

/** When the next widening could create a pair: the earliest future window change, or null. */
export function nextWiden(queue: readonly Waiting[], now: number): number | null {
  if (queue.length < 2) return null;
  let next = Infinity;
  for (const w of queue) {
    const waited = now - w.since;
    const t =
      waited < 30_000
        ? w.since + 30_000
        : w.since + 30_000 + (Math.floor((waited - 30_000) / 10_000) + 1) * 10_000;
    next = Math.min(next, t);
  }
  return Number.isFinite(next) ? next : null;
}

/** A player in a ranked queue (9.3): paired by Glicko-2 rating within a widening window. */
export interface RankedWaiting extends Waiting {
  rating: number;
}

/**
 * Ranked-queue pairing (M6 6.2, R-FMT-004): the same rules as the casual queue with the rating in
 * place of the level. A player's rating window widens with waiting time (`ratingWindow`, PLAYTEST);
 * a pair needs BOTH windows to allow the gap. Oldest waiting first; the closest rating wins, then the
 * longest waiting. Only humans wait here (never NPCs), and a ranked battle never carries a wager.
 */
export function pairRanked<T extends RankedWaiting>(queue: readonly T[], now: number): [T, T][] {
  const open = [...queue].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const out: [T, T][] = [];
  for (const a of open) {
    if (used.has(a.id)) continue;
    let best: T | null = null;
    for (const b of open) {
      if (b === a || used.has(b.id) || b.id === a.id) continue;
      const gap = Math.abs(a.rating - b.rating);
      if (gap > Math.min(ratingWindow(now - a.since), ratingWindow(now - b.since))) continue;
      if (!best || gap < Math.abs(a.rating - best.rating)) best = b;
    }
    if (best) {
      used.add(a.id);
      used.add(best.id);
      out.push([a, best]);
    }
  }
  return out;
}

/** When the next rating-window widening could create a pair, or null. */
export function nextRankedWiden(queue: readonly Waiting[], now: number): number | null {
  if (queue.length < 2) return null;
  let next = Infinity;
  for (const w of queue) {
    const t = nextWindowChange(w.since, now);
    if (t !== null) next = Math.min(next, t);
  }
  return Number.isFinite(next) ? next : null;
}
