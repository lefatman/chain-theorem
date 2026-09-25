/** Casual-queue pairing (R-FMT-004). */
import { describe, expect, it } from 'vitest';
import { nextWiden, pair } from './pairing.ts';

const w = (id: string, level: number, since = 0) => ({ id, level, since });
const ids = (ps: [{ id: string }, { id: string }][]) => ps.map(([a, b]) => `${a.id}-${b.id}`);

describe('casual queue pairing (R-FMT-004)', () => {
  it('R-FMT-004 pairs players within ±5 levels, closest level first, oldest first', () => {
    expect(ids(pair([w('a', 10), w('b', 15), w('c', 11)], 0))).toEqual(['a-c']);
    expect(ids(pair([w('a', 10), w('b', 16)], 0))).toEqual([]);
    expect(ids(pair([w('a', 10, 5), w('b', 10, 1), w('c', 10, 3)], 10))).toEqual(['b-c']);
  });

  it('R-FMT-004 a window widens only after 30 s, and both players must allow the gap', () => {
    expect(ids(pair([w('a', 10, 0), w('b', 16, 0)], 29_999))).toEqual([]);
    expect(ids(pair([w('a', 10, 0), w('b', 16, 0)], 30_000))).toEqual(['a-b']);
    // b just arrived: its own window is still ±5.
    expect(ids(pair([w('a', 10, 0), w('b', 16, 59_000)], 60_000))).toEqual([]);
  });

  it('R-FMT-004 a player is never paired with themselves or twice', () => {
    const r = pair([w('a', 5), w('a', 5), w('b', 5), w('c', 5)], 0);
    const seen = r.flat().map((x) => x.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(r.every(([x, y]) => x.id !== y.id)).toBe(true);
  });

  it('R-FMT-004 the next widening time drives the Matchmaker alarm', () => {
    expect(nextWiden([w('a', 1, 0)], 0)).toBeNull();
    expect(nextWiden([w('a', 1, 0), w('b', 20, 5_000)], 1_000)).toBe(30_000);
    expect(nextWiden([w('a', 1, 0), w('b', 20, 0)], 31_000)).toBe(40_000);
  });
});
