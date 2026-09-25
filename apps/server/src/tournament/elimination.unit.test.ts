/**
 * Single-elimination seeding and standings (M7 7.1; spec 10.4 R-WORLD-004, 9.3 R-FMT-004): the
 * standard seed order, byes to the top seeds, places by the round reached, and Swiss tie-breaks
 * (points, Buchholz, Sonneborn-Berger, seed) on a hand-computed example.
 */
import { describe, expect, it } from 'vitest';
import {
  bracketSize,
  eliminationPlace,
  eliminationRounds,
  firstField,
  matches,
  seedPositions,
} from './elimination.ts';
import { eliminationStandings, scoreLines, swissStandings } from './standings.ts';
import type { Entrant, Pairing, Round } from './types.ts';

function entrants(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String.fromCharCode(65 + i),
    name: String.fromCharCode(65 + i),
    level: 1,
    registeredAt: i,
    rating: 1500 - i,
    seed: i + 1,
    withdrawn: false,
    noShows: 0,
  }));
}

const game = (
  board: number,
  white: string,
  black: string | null,
  result: Pairing['result'],
  absent: string[] = [],
): Pairing => ({
  board,
  white,
  black,
  battleId: black === null ? null : `b-${white}-${black}`,
  result,
  absent,
  reason: null,
});

const round = (n: number, pairings: Pairing[], field?: (string | null)[]): Round => ({
  n,
  startsAt: 0,
  started: true,
  finishedAt: 1,
  pairings,
  checkAt: null,
  ...(field ? { field } : {}),
});

describe('single elimination (M7 7.1)', () => {
  it('R-FMT-004 seeds meet in the standard order: 1 and 2 only in the final', () => {
    expect(seedPositions(2)).toEqual([1, 2]);
    expect(seedPositions(4)).toEqual([1, 4, 2, 3]);
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const s16 = seedPositions(16);
    expect(s16).toHaveLength(16);
    for (let k = 0; k < 8; k++) expect((s16[2 * k] ?? 0) + (s16[2 * k + 1] ?? 0)).toBe(17);
    // Seeds 1 and 2 are in opposite halves; 1-4 in different quarters.
    expect(s16.indexOf(1) < 8).not.toBe(s16.indexOf(2) < 8);
    expect(new Set([1, 2, 3, 4].map((s) => Math.floor(s16.indexOf(s) / 4))).size).toBe(4);
  });

  it('R-FMT-004 byes go to the top seeds', () => {
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(9)).toBe(16);
    expect(eliminationRounds(5)).toBe(3);
    expect(eliminationRounds(8)).toBe(3);
    const field = firstField(['s1', 's2', 's3', 's4', 's5']);
    const byes = matches(field)
      .filter((m) => m.a === null || m.b === null)
      .map((m) => m.a ?? m.b);
    expect(byes.sort()).toEqual(['s1', 's2', 's3']);
    expect(matches(field).find((m) => m.a !== null && m.b !== null)).toEqual({
      slot: 1,
      a: 's4',
      b: 's5',
    });
    const six = matches(firstField(['s1', 's2', 's3', 's4', 's5', 's6']));
    expect(six.filter((m) => m.b === null).map((m) => m.a)).toEqual(['s1', 's2']);
  });

  it('R-WORLD-004 places follow the round reached: 1, 2, 3, 3, 5, 5, 5, 5', () => {
    expect([4, 3, 2, 1].map((out) => eliminationPlace(out, 3))).toEqual([1, 2, 3, 5]);
    // 5 players: A, B, C byes; D beats E; then A–D, B–C (draw: Black advances), final.
    const es = entrants(5);
    const r1 = round(
      1,
      [
        game(1, 'A', null, 'bye'),
        game(2, 'D', 'E', 'white'),
        game(3, 'B', null, 'bye'),
        game(4, 'C', null, 'bye'),
      ].map((p, i) => ({ ...p, slot: i })),
      firstField(['A', 'B', 'C', 'D', 'E']),
    );
    const r2 = round(
      2,
      [game(1, 'A', 'D', 'white'), game(2, 'B', 'C', 'draw')].map((p, i) => ({ ...p, slot: i })),
      ['A', 'D', 'B', 'C'],
    );
    const r3 = round(3, [{ ...game(1, 'C', 'A', 'black'), slot: 0 }], ['A', 'C']);
    const rows = eliminationStandings(es, [r1, r2, r3], 3, 'black');
    expect(rows.map((r) => [r.id, r.rank])).toEqual([
      ['A', 1],
      ['C', 2],
      ['B', 3],
      ['D', 3],
      ['E', 5],
    ]);
    expect(rows[0]?.alive).toBe(true);
    expect(rows.slice(1).every((r) => !r.alive)).toBe(true);
    // Points are rounds won, byes included.
    expect(rows.find((r) => r.id === 'A')?.points).toBe(3);
  });
});

describe('Swiss standings and tie-breaks (M7 7.1)', () => {
  /**
   * 4 players, 3 rounds:
   * R1: A–B 1-0, C–D ½-½       R2: A–C ½-½, D–B 1-0       R3: A–D 0-1 (forfeit: A absent), B–C none
   * Points: A 1.5, B 0, C 1, D 2.5.
   */
  const rounds = [
    round(1, [game(1, 'A', 'B', 'white'), game(2, 'C', 'D', 'draw')]),
    round(2, [game(1, 'A', 'C', 'draw'), game(2, 'D', 'B', 'white')]),
    round(3, [game(1, 'A', 'D', 'black', ['A']), game(2, 'B', 'C', 'none', ['B', 'C'])]),
  ];

  it('R-WORLD-004 points: win 1, draw ½, forfeit loss 0, double loss 0 each', () => {
    const lines = scoreLines(entrants(4), rounds, 1);
    expect(lines.get('A')?.points).toBe(1.5);
    expect(lines.get('B')?.points).toBe(0);
    expect(lines.get('C')?.points).toBe(1);
    expect(lines.get('D')?.points).toBe(2.5);
    expect(lines.get('D')?.wins).toBe(2);
    expect(lines.get('A')?.opponents).toEqual(['B', 'C', 'D']);
    expect(lines.get('A')?.colours).toEqual(['w', 'w', 'w']);
  });

  it('R-WORLD-004 Buchholz and Sonneborn-Berger by hand', () => {
    const lines = scoreLines(entrants(4), rounds, 1);
    // A met B (0), C (1), D (2.5): Buchholz 3.5; SB = beat B (0) + ½ C (1) = 0.5.
    expect(lines.get('A')?.buchholz).toBe(3.5);
    expect(lines.get('A')?.sb).toBe(0.5);
    // C met D (2.5), A (1.5), B (0): Buchholz 4; SB = ½·2.5 + ½·1.5 = 2.
    expect(lines.get('C')?.buchholz).toBe(4);
    expect(lines.get('C')?.sb).toBe(2);
    // D met C (1), B (0), A (1.5): SB = ½·1 + 0 + 1.5 = 2.
    expect(lines.get('D')?.sb).toBe(2);
  });

  it('R-WORLD-004 order: points, then Buchholz, then Sonneborn-Berger, then seed', () => {
    const rows = swissStandings(entrants(4), rounds, { byePoints: 1 });
    expect(rows.map((r) => r.id)).toEqual(['D', 'A', 'C', 'B']);
    // Equal points and Buchholz: Sonneborn-Berger decides; everything equal: the seed.
    const tied = [
      round(1, [game(1, 'A', 'B', 'white'), game(2, 'C', 'D', 'white')]),
      round(2, [game(1, 'B', 'C', 'draw'), game(2, 'D', 'A', 'draw')]),
    ];
    const t = swissStandings(entrants(4), tied, { byePoints: 1 });
    // A 1.5 (opp B 0.5, D 0.5 → Buchholz 1, SB 0.5 + 0.25), C 1.5 (same): seed puts A first.
    expect(t.slice(0, 2).map((r) => r.id)).toEqual(['A', 'C']);
    expect(t[0]?.buchholz).toBe(t[1]?.buchholz);
    expect(t[0]?.sb).toBe(t[1]?.sb);
  });

  it('R-WORLD-004 a bye scores its points and adds nothing to Buchholz', () => {
    const r = [round(1, [game(1, 'A', 'B', 'white'), game(2, 'C', null, 'bye')])];
    const lines = scoreLines(entrants(3), r, 1);
    expect(lines.get('C')).toMatchObject({ points: 1, byes: 1, games: 0, buchholz: 0 });
    expect(lines.get('A')).toMatchObject({ points: 1, buchholz: 0, sb: 0 });
  });
});
