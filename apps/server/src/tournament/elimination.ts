/**
 * Single elimination (M7 7.1; spec 10.4 R-WORLD-004), pure and deterministic. The field is seeded by
 * rating into a bracket of the next power of two; the missing seeds are byes, so the top seeds get
 * them. Seeds meet in the standard order (1 against the lowest, and 1 and 2 only in the final).
 * A round's field lists the players entering it in bracket order (null: nobody, after a double
 * loss); matches are consecutive pairs of the field, and the winners form the next field. A withdrawn
 * player stays in the field and forfeits the match (the core decides it without a battle).
 */

/** The bracket size for `players`: the next power of two (at least 2). */
export function bracketSize(players: number): number {
  let size = 2;
  while (size < players) size *= 2;
  return size;
}

/** Rounds of a bracket of `size`. */
export function eliminationRounds(players: number): number {
  return players < 2 ? 0 : Math.round(Math.log2(bracketSize(players)));
}

/**
 * Seed numbers (1-based) in bracket order: [1, 2] for 2, [1, 4, 2, 3] for 4, [1, 8, 4, 5, 2, 7, 3, 6]
 * for 8. Each match pairs positions 2k and 2k+1, and the seeds of every match sum to size + 1.
 */
export function seedPositions(size: number): number[] {
  let cur = [1, 2];
  while (cur.length < size) {
    const n = cur.length * 2 + 1;
    const next: number[] = [];
    for (const s of cur) next.push(s, n - s);
    cur = next;
  }
  return cur;
}

/** The first round's field: players by seed (index 0 = seed 1) placed in bracket order. */
export function firstField(bySeed: readonly string[]): (string | null)[] {
  return seedPositions(bracketSize(bySeed.length)).map((s) => bySeed[s - 1] ?? null);
}

export interface EliminationMatch {
  /** Match index in bracket order (0-based). */
  slot: number;
  a: string | null;
  b: string | null;
}

/** The matches of a field: consecutive pairs. */
export function matches(field: readonly (string | null)[]): EliminationMatch[] {
  const out: EliminationMatch[] = [];
  for (let k = 0; k * 2 < field.length; k++)
    out.push({ slot: k, a: field[2 * k] ?? null, b: field[2 * k + 1] ?? null });
  return out;
}

/**
 * Final place of a player eliminated in round `out` (1-based) of `rounds`; `out > rounds` is the
 * winner. The final's loser is 2nd, both semi-final losers 3rd, quarter-final losers 5th, and so on.
 */
export function eliminationPlace(out: number, rounds: number): number {
  if (out > rounds) return 1;
  return 2 ** (rounds - out) + 1;
}
