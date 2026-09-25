/**
 * Swiss pairings (M7 7.1; spec 10.4 R-WORLD-004), pure and deterministic: the same standings always
 * give the same pairings, whatever order the players are passed in.
 *
 * - Players are ranked by points, then seed (the rating order at the start).
 * - Score groups: the top remaining player is paired inside their score group with the player half a
 *   group below (the Dutch "top half against bottom half"), then the nearest alternatives; an odd
 *   player floats down to the next group.
 * - No repeat pairings where avoidable: a backtracking search looks for a repeat-free pairing first
 *   (with a work budget); only when none exists are repeats allowed, as few as the greedy order gives.
 * - Colour balance: inside each part of the candidate order, opponents whose colour wish differs come
 *   first (the Dutch transpositions); two players who both need the same colour absolutely (a colour
 *   difference of 2, or the same colour twice in a row) are paired only when no repeat-free pairing
 *   avoids it. Colours then go by preference strength (absolute, strong, mild), the higher-ranked
 *   player winning a tie, and alternate by board in the first round.
 * - Byes: with an odd field the lowest-ranked player without a bye gets it (at most one per player),
 *   provided the rest can still be paired without repeats.
 */

export type Colour = 'w' | 'b';

export interface SwissPlayer {
  id: string;
  /** 1 = the strongest at the start. */
  seed: number;
  points: number;
  /** Everyone this player was paired against so far (forfeits included). */
  opponents: readonly string[];
  /** Colours of the games so far, in order (byes have none). */
  colours: readonly Colour[];
  hadBye: boolean;
}

export interface SwissPair {
  board: number;
  white: string;
  black: string;
}

export interface SwissPairing {
  /** In board order (board 1 = the top pair). */
  pairs: SwissPair[];
  bye: string | null;
  /** Pairs that repeat an earlier game (0 whenever a repeat-free pairing exists within the budget). */
  repeats: number;
}

/** A round robin at most: every player meets every other once (odd fields: one bye each). */
export function maxSwissRounds(players: number): number {
  if (players < 2) return 0;
  return players % 2 === 0 ? players - 1 : players;
}

/** ceil(log2(players)) + `extra` rounds (PLAYTEST), capped at a round robin. */
export function defaultSwissRounds(players: number, extra = 1): number {
  if (players < 2) return 0;
  return Math.min(Math.ceil(Math.log2(players)) + extra, maxSwissRounds(players));
}

/** Standings order used for pairing: points, then seed, then id (a total order). */
export function pairingOrder(a: SwissPlayer, b: SwissPlayer): number {
  return b.points - a.points || a.seed - b.seed || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface ColourPreference {
  colour: Colour | null;
  /** 3 absolute, 2 strong, 1 mild, 0 none (first game). */
  strength: 0 | 1 | 2 | 3;
}

export function colourPreference(colours: readonly Colour[]): ColourPreference {
  if (colours.length === 0) return { colour: null, strength: 0 };
  let diff = 0;
  for (const c of colours) diff += c === 'w' ? 1 : -1;
  const last = colours[colours.length - 1];
  const prev = colours.length >= 2 ? colours[colours.length - 2] : null;
  if (diff >= 2 || (last === 'w' && prev === 'w')) return { colour: 'b', strength: 3 };
  if (diff <= -2 || (last === 'b' && prev === 'b')) return { colour: 'w', strength: 3 };
  if (diff === 1) return { colour: 'b', strength: 2 };
  if (diff === -1) return { colour: 'w', strength: 2 };
  return { colour: last === 'w' ? 'b' : 'w', strength: 1 };
}

const other = (c: Colour): Colour => (c === 'w' ? 'b' : 'w');

/**
 * Colours for a pair; `a` is the higher-ranked player. Returns the colour `a` plays. Both
 * preferences are met when they differ; otherwise the stronger preference wins, the higher-ranked
 * player on a tie; with no history at all the higher-ranked player has White on odd boards.
 */
export function colourFor(a: readonly Colour[], b: readonly Colour[], board: number): Colour {
  const pa = colourPreference(a);
  const pb = colourPreference(b);
  if (pa.colour && pb.colour && pa.colour !== pb.colour) return pa.colour;
  if (pa.colour && !pb.colour) return pa.colour;
  if (!pa.colour && pb.colour) return other(pb.colour);
  if (!pa.colour || !pb.colour) return board % 2 === 1 ? 'w' : 'b';
  // Same colour wanted by both.
  if (pb.strength > pa.strength) return other(pb.colour);
  return pa.colour;
}

/**
 * How badly two players' colour wishes collide: 0 compatible (different wishes, or one has none);
 * 1 the same wish but one is mild (that player yields and stays within one of even); 2 the same
 * strong wish (one player goes two off); 3 the same absolute wish (one player goes past two off, or
 * gets a colour three times in a row).
 */
function colourConflict(a: SwissPlayer, b: SwissPlayer): 0 | 1 | 2 | 3 {
  const pa = colourPreference(a.colours);
  const pb = colourPreference(b.colours);
  if (!pa.colour || !pb.colour || pa.colour !== pb.colour) return 0;
  if (pa.strength === 3 && pb.strength === 3) return 3;
  return pa.strength === 1 || pb.strength === 1 ? 1 : 2;
}

/**
 * Opponents for `head` (the top of `rest`, which is in pairing order), best first: inside the score
 * group starting half a group down (S2 order, then back up through S1), then the lower groups in
 * order; inside each part, compatible colour wishes first (the Dutch transpositions for colour).
 */
function candidates(head: SwissPlayer, rest: readonly SwissPlayer[]): SwissPlayer[] {
  // The score group G = [head, ...group]; its ideal opponent for G[0] is G[floor(|G| / 2)].
  const group = rest.filter((p) => p.points === head.points);
  const g = group.length + 1;
  const h = Math.floor(g / 2);
  const same: SwissPlayer[] = [];
  for (let i = Math.max(h, 1); i < g; i++) same.push(group[i - 1] as SwissPlayer);
  for (let i = h - 1; i >= 1; i--) same.push(group[i - 1] as SwissPlayer);
  const lower = rest.filter((p) => p.points < head.points);
  const byColour = (list: SwissPlayer[]) =>
    ([0, 1, 2, 3] as const).flatMap((c) => list.filter((p) => colourConflict(head, p) === c));
  return [...byColour(same), ...byColour(lower)];
}

class Budget {
  left: number;
  constructor(n: number) {
    this.left = n;
  }
}

type Allowed = (a: SwissPlayer, b: SwissPlayer) => boolean;

/** A pairing of `list` (pairing order) using only allowed pairs, or null (none, or out of budget). */
function pairStrict(
  list: readonly SwissPlayer[],
  allowed: Allowed,
  budget: Budget,
): [SwissPlayer, SwissPlayer][] | null {
  if (list.length === 0) return [];
  if (--budget.left < 0) return null;
  const head = list[0] as SwissPlayer;
  const rest = list.slice(1);
  for (const q of candidates(head, rest)) {
    if (!allowed(head, q)) continue;
    const sub = pairStrict(
      rest.filter((p) => p !== q),
      allowed,
      budget,
    );
    if (sub) return [[head, q], ...sub];
    if (budget.left < 0) return null;
  }
  return null;
}

/** Greedy pairing that allows repeats (fresh opponents first): always succeeds on an even list. */
function pairLoose(
  list: readonly SwissPlayer[],
  met: (a: SwissPlayer, b: SwissPlayer) => boolean,
): [SwissPlayer, SwissPlayer][] {
  const out: [SwissPlayer, SwissPlayer][] = [];
  let rest = [...list];
  while (rest.length >= 2) {
    const head = rest[0] as SwissPlayer;
    const cands = candidates(head, rest.slice(1));
    const q = cands.find((p) => !met(head, p)) ?? (cands[0] as SwissPlayer);
    out.push([head, q]);
    rest = rest.filter((p) => p !== head && p !== q);
  }
  return out;
}

/**
 * Pair one Swiss round. `players` are the active players (withdrawn ones left out). `budget` bounds
 * the repeat-free search (deterministic: it counts steps, not time).
 */
export function pairSwiss(players: readonly SwissPlayer[], budget = 200_000): SwissPairing {
  const order = [...players].sort(pairingOrder);
  const opp = new Map(order.map((p) => [p.id, new Set(p.opponents)]));
  const met = (a: SwissPlayer, b: SwissPlayer) => opp.get(a.id)?.has(b.id) === true;
  // Strict levels, best first: no repeat and no absolute colour clash; then no repeat.
  const levels: { allowed: Allowed; budget: Budget }[] = [
    { allowed: (a, b) => !met(a, b) && colourConflict(a, b) < 3, budget: new Budget(budget / 10) },
    { allowed: (a, b) => !met(a, b), budget: new Budget(budget) },
  ];
  const strict = (list: readonly SwissPlayer[]) => {
    for (const l of levels) {
      if (l.budget.left < 0) continue;
      const r = pairStrict(list, l.allowed, l.budget);
      if (r) return r;
    }
    return null;
  };
  let bye: SwissPlayer | null = null;
  let pairs: [SwissPlayer, SwissPlayer][] | null = null;
  if (order.length % 2 === 1) {
    const fresh = [...order].reverse().filter((p) => !p.hadBye);
    const pool = fresh.length > 0 ? fresh : [...order].reverse();
    for (const c of pool) {
      const r = strict(order.filter((p) => p !== c));
      if (r) {
        bye = c;
        pairs = r;
        break;
      }
    }
    if (!pairs) {
      bye = pool[0] as SwissPlayer;
      const b = bye;
      pairs = pairLoose(
        order.filter((p) => p !== b),
        met,
      );
    }
  } else {
    pairs = strict(order) ?? pairLoose(order, met);
  }
  const rank = new Map(order.map((p, i) => [p.id, i]));
  const top = (x: [SwissPlayer, SwissPlayer]) =>
    Math.min(rank.get(x[0].id) ?? 0, rank.get(x[1].id) ?? 0);
  const sorted = [...pairs].sort((x, y) => top(x) - top(y));
  let repeats = 0;
  const out: SwissPair[] = sorted.map(([x, y], i) => {
    if (met(x, y)) repeats++;
    const [a, b] = (rank.get(x.id) ?? 0) <= (rank.get(y.id) ?? 0) ? [x, y] : [y, x];
    const board = i + 1;
    const ca = colourFor(a.colours, b.colours, board);
    return ca === 'w' ? { board, white: a.id, black: b.id } : { board, white: b.id, black: a.id };
  });
  return { pairs: out, bye: bye?.id ?? null, repeats };
}
