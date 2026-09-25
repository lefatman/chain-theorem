/**
 * Swiss pairings (M7 7.1; spec 10.4 R-WORLD-004): score groups, no repeat pairings when avoidable
 * (checked against an exhaustive search), byes (lowest ranked, at most one per player), colour
 * balance, and determinism.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  colourFor,
  colourPreference,
  defaultSwissRounds,
  maxSwissRounds,
  pairSwiss,
  type Colour,
  type SwissPlayer,
} from './swiss.ts';

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

function fresh(n: number): SwissPlayer[] {
  return ids(n).map((id, i) => ({
    id,
    seed: i + 1,
    points: 0,
    opponents: [],
    colours: [],
    hadBye: false,
  }));
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply one round with random results (seeded): wins, draws and losses. */
function play(players: SwissPlayer[], rnd: () => number): SwissPlayer[] {
  const pr = pairSwiss(players);
  const by = new Map(
    players.map((p) => [
      p.id,
      { ...p, opponents: [...p.opponents], colours: [...p.colours] as Colour[] },
    ]),
  );
  for (const pair of pr.pairs) {
    const w = by.get(pair.white);
    const b = by.get(pair.black);
    if (!w || !b) throw new Error('unknown player');
    w.opponents.push(b.id);
    b.opponents.push(w.id);
    w.colours.push('w');
    b.colours.push('b');
    const x = rnd();
    if (x < 0.45) w.points += 1;
    else if (x < 0.9) b.points += 1;
    else {
      w.points += 0.5;
      b.points += 0.5;
    }
  }
  if (pr.bye) {
    const p = by.get(pr.bye);
    if (!p) throw new Error('unknown bye');
    p.points += 1;
    p.hadBye = true;
  }
  return [...by.values()];
}

/** Exhaustive: can `players` be paired with no repeat (odd: some bye-less player sits out)? */
function repeatFreeExists(players: SwissPlayer[]): boolean {
  const met = (a: SwissPlayer, b: SwissPlayer) => a.opponents.includes(b.id);
  const perfect = (list: SwissPlayer[]): boolean => {
    if (list.length === 0) return true;
    const [head, ...rest] = list as [SwissPlayer, ...SwissPlayer[]];
    return rest.some((q) => !met(head, q) && perfect(rest.filter((x) => x !== q)));
  };
  if (players.length % 2 === 0) return perfect(players);
  const noBye = players.filter((p) => !p.hadBye);
  const pool = noBye.length > 0 ? noBye : players;
  return pool.some((c) => perfect(players.filter((p) => p !== c)));
}

describe('Swiss pairing (M7 7.1)', () => {
  it('R-WORLD-004 the default is ceil(log2 n) + 1 rounds, at most a round robin', () => {
    expect(defaultSwissRounds(2)).toBe(1);
    expect(defaultSwissRounds(3)).toBe(3);
    expect(defaultSwissRounds(4)).toBe(3);
    expect(defaultSwissRounds(8)).toBe(4);
    expect(defaultSwissRounds(9)).toBe(5);
    expect(defaultSwissRounds(32)).toBe(6);
    expect(defaultSwissRounds(64)).toBe(7);
    expect(defaultSwissRounds(1)).toBe(0);
    expect(maxSwissRounds(6)).toBe(5);
    expect(maxSwissRounds(7)).toBe(7);
    expect(defaultSwissRounds(8, 2)).toBe(5);
  });

  it('R-WORLD-004 round 1 pairs the top half against the bottom half, colours alternating by board', () => {
    const r = pairSwiss(fresh(8));
    expect(r.bye).toBeNull();
    expect(r.repeats).toBe(0);
    expect(r.pairs).toEqual([
      { board: 1, white: 'p01', black: 'p05' },
      { board: 2, white: 'p06', black: 'p02' },
      { board: 3, white: 'p03', black: 'p07' },
      { board: 4, white: 'p08', black: 'p04' },
    ]);
  });

  it('R-WORLD-004 pairings are deterministic whatever order the players come in', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 24 }), fc.integer(), (n, seed) => {
        const rnd = mulberry(seed);
        let players = fresh(n);
        for (let r = 0; r < Math.min(3, defaultSwissRounds(n) - 1); r++)
          players = play(players, rnd);
        const shuffled = [...players].sort(() => (rnd() < 0.5 ? -1 : 1));
        expect(pairSwiss(shuffled)).toEqual(pairSwiss(players));
      }),
      { numRuns: 60 },
    );
  });

  it('R-WORLD-004 score groups: after round 1 the winners meet each other', () => {
    let players = fresh(8);
    const r1 = pairSwiss(players);
    // White wins every game of round 1.
    players = players.map((p) => {
      const pair = r1.pairs.find((x) => x.white === p.id || x.black === p.id);
      const white = pair?.white === p.id;
      return {
        ...p,
        points: white ? 1 : 0,
        opponents: [white ? (pair?.black ?? '') : (pair?.white ?? '')],
        colours: [white ? 'w' : 'b'],
      };
    });
    const winners = new Set(r1.pairs.map((p) => p.white));
    const r2 = pairSwiss(players);
    for (const pair of r2.pairs) expect(winners.has(pair.white)).toBe(winners.has(pair.black));
    expect(r2.repeats).toBe(0);
  });

  it('R-WORLD-004 no repeat pairing whenever a repeat-free pairing exists (exhaustive check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 10 }), fc.integer(), (n, seed) => {
        const rnd = mulberry(seed);
        let players = fresh(n);
        for (let round = 1; round <= maxSwissRounds(n); round++) {
          const pr = pairSwiss(players);
          if (repeatFreeExists(players)) expect(pr.repeats).toBe(0);
          // Everyone active is paired exactly once (or has the bye).
          const seen = [
            ...pr.pairs.flatMap((p) => [p.white, p.black]),
            ...(pr.bye ? [pr.bye] : []),
          ];
          expect(new Set(seen).size).toBe(n);
          expect(seen.length).toBe(n);
          players = play(players, rnd);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('R-WORLD-004 a round robin of 4 then forces repeats, and the pairing is still complete', () => {
    let players = fresh(4);
    const rnd = mulberry(7);
    for (let r = 0; r < 3; r++) {
      expect(pairSwiss(players).repeats).toBe(0);
      players = play(players, rnd);
    }
    const r4 = pairSwiss(players);
    expect(r4.repeats).toBe(2);
    expect(r4.pairs).toHaveLength(2);
  });

  it('R-WORLD-004 byes: the lowest-ranked player without one, at most one bye per player', () => {
    const r1 = pairSwiss(fresh(7));
    expect(r1.bye).toBe('p07');
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer(), (half, seed) => {
        const n = half * 2 + 1;
        const rnd = mulberry(seed);
        let players = fresh(n);
        const byes = new Map<string, number>();
        for (let round = 1; round <= Math.min(maxSwissRounds(n), n); round++) {
          const pr = pairSwiss(players);
          expect(pr.bye).not.toBeNull();
          const bye = players.find((p) => p.id === pr.bye);
          // Only a player without a bye gets it, and it is the lowest ranked who can take it
          // without forcing a repeat: nobody without a bye ranks below with fewer points.
          expect(bye?.hadBye).toBe(false);
          byes.set(pr.bye ?? '', (byes.get(pr.bye ?? '') ?? 0) + 1);
          players = play(players, rnd);
        }
        for (const count of byes.values()) expect(count).toBe(1);
      }),
      { numRuns: 80 },
    );
  });

  it('R-WORLD-004 colour balance: every player stays within two of even, most within one', () => {
    let within1 = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry(seed);
      const n = 4 + (seed % 29);
      let players = fresh(n);
      for (let r = 0; r < defaultSwissRounds(n); r++) players = play(players, rnd);
      for (const p of players) {
        const diff = p.colours.reduce((d, c) => d + (c === 'w' ? 1 : -1), 0);
        expect(Math.abs(diff)).toBeLessThanOrEqual(2);
        total++;
        if (Math.abs(diff) <= 1) within1++;
      }
    }
    expect(within1 / total).toBeGreaterThan(0.9);
  });

  it('R-WORLD-004 colour preferences: absolute beats strong beats mild; a tie goes to the higher rank', () => {
    expect(colourPreference([])).toEqual({ colour: null, strength: 0 });
    expect(colourPreference(['w', 'w'])).toEqual({ colour: 'b', strength: 3 });
    expect(colourPreference(['w', 'b', 'w'])).toEqual({ colour: 'b', strength: 2 });
    expect(colourPreference(['w', 'b'])).toEqual({ colour: 'w', strength: 1 });
    // Different wishes are both met.
    expect(colourFor(['w'], ['b'], 1)).toBe('b');
    // Both want White: the absolute wish wins.
    expect(colourFor(['b', 'w', 'b'], ['b', 'b'], 1)).toBe('b');
    // Equal wishes: the higher-ranked player (the first) has it.
    expect(colourFor(['b'], ['b'], 2)).toBe('w');
    // No history: odd boards give the higher-ranked player White.
    expect(colourFor([], [], 1)).toBe('w');
    expect(colourFor([], [], 2)).toBe('b');
  });
});
