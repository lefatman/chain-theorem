/**
 * Scores and standings (M7 7.1; spec 10.4 R-WORLD-004), pure. A win is 1 point, a draw 1/2, a loss
 * or a double loss 0, a bye `byePoints`. A game one player never started is a forfeit: a loss for
 * the absent player, a win for the other; both absent is a double loss (0 each).
 *
 * Swiss tie-breaks (DD, documented in ARCHITECTURE 6): points, then Buchholz (the sum of the final
 * points of every opponent met, forfeits included, a bye counting nothing), then Sonneborn-Berger
 * (the points of beaten opponents plus half the points of drawn ones), then the seed. Every
 * quantity is a multiple of 1/4, exact in floating point.
 *
 * Single elimination: the round reached decides the place (the winner 1st, the final's loser 2nd,
 * semi-final losers 3rd, ...), then the seed.
 */
import type { Colour, SwissPlayer } from './swiss.ts';
import { eliminationPlace } from './elimination.ts';
import type { Entrant, Pairing, Round, TournamentRules } from './types.ts';

export interface ScoreLine {
  id: string;
  seed: number;
  points: number;
  wins: number;
  /** Games paired against an opponent (forfeits included, byes not). */
  games: number;
  /** Games this player never started (forfeit losses, double losses). */
  forfeits: number;
  byes: number;
  opponents: string[];
  colours: Colour[];
  /** Per game against an opponent: the opponent and this player's score (1, 0.5, 0). */
  results: { opponent: string; score: number }[];
  buchholz: number;
  sb: number;
}

/** This player's score in a finished pairing (null: not in it, or not finished). */
export function scoreIn(p: Pairing, id: string, byePoints: number): number | null {
  if (p.result === null) return null;
  if (p.white !== id && p.black !== id) return null;
  switch (p.result) {
    case 'bye':
      return byePoints;
    case 'draw':
      return 0.5;
    case 'none':
      return 0;
    case 'white':
      return p.white === id ? 1 : 0;
    case 'black':
      return p.black === id ? 1 : 0;
  }
}

/** Every entrant's score line over the finished pairings of `rounds`. */
export function scoreLines(
  entrants: readonly Entrant[],
  rounds: readonly Round[],
  byePoints: number,
): Map<string, ScoreLine> {
  const lines = new Map<string, ScoreLine>();
  for (const e of entrants)
    lines.set(e.id, {
      id: e.id,
      seed: e.seed,
      points: 0,
      wins: 0,
      games: 0,
      forfeits: 0,
      byes: 0,
      opponents: [],
      colours: [],
      results: [],
      buchholz: 0,
      sb: 0,
    });
  for (const r of rounds)
    for (const p of r.pairings) {
      const w = lines.get(p.white);
      if (p.black === null) {
        if (w && p.result === 'bye') {
          w.byes++;
          w.points += byePoints;
        }
        continue;
      }
      const b = lines.get(p.black);
      // Pairing history counts from the moment of pairing (no rematch, colour balance).
      if (w) {
        w.opponents.push(p.black);
        w.colours.push('w');
      }
      if (b) {
        b.opponents.push(p.white);
        b.colours.push('b');
      }
      if (p.result === null) continue;
      for (const [line, opp] of [
        [w, p.black],
        [b, p.white],
      ] as const) {
        if (!line) continue;
        const s = scoreIn(p, line.id, byePoints) ?? 0;
        line.points += s;
        line.games++;
        if (p.absent.includes(line.id)) line.forfeits++;
        if (s === 1) line.wins++;
        line.results.push({ opponent: opp, score: s });
      }
    }
  for (const line of lines.values()) {
    for (const g of line.results) {
      const opp = lines.get(g.opponent)?.points ?? 0;
      line.buchholz += opp;
      line.sb += g.score * opp;
    }
  }
  return lines;
}

/** The pairing input of the active (not withdrawn) players. */
export function swissPlayers(
  entrants: readonly Entrant[],
  lines: ReadonlyMap<string, ScoreLine>,
): SwissPlayer[] {
  return entrants
    .filter((e) => !e.withdrawn)
    .map((e) => {
      const l = lines.get(e.id);
      return {
        id: e.id,
        seed: e.seed,
        points: l?.points ?? 0,
        opponents: l?.opponents ?? [],
        colours: l?.colours ?? [],
        hadBye: (l?.byes ?? 0) > 0,
      };
    });
}

/** Swiss order: points, Buchholz, Sonneborn-Berger, seed (then id: a total order). */
export function swissOrder(a: ScoreLine, b: ScoreLine): number {
  return (
    b.points - a.points ||
    b.buchholz - a.buchholz ||
    b.sb - a.sb ||
    a.seed - b.seed ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export interface StandingRow extends ScoreLine {
  rank: number;
  withdrawn: boolean;
  /** Single elimination: still in the bracket (or the winner). */
  alive: boolean;
}

export function swissStandings(
  entrants: readonly Entrant[],
  rounds: readonly Round[],
  rules: Pick<TournamentRules, 'byePoints'>,
): StandingRow[] {
  const lines = scoreLines(entrants, rounds, rules.byePoints);
  const withdrawn = new Map(entrants.map((e) => [e.id, e.withdrawn]));
  return [...lines.values()].sort(swissOrder).map((l, i) => ({
    ...l,
    rank: i + 1,
    withdrawn: withdrawn.get(l.id) ?? false,
    alive: !(withdrawn.get(l.id) ?? false),
  }));
}

/**
 * Single-elimination standings: the round each player went out in, the winner first; places are
 * shared (both semi-final losers are 3rd). Points count the rounds advanced from (byes and a draw's
 * odds included). While the event runs, players still in the bracket are `alive` and share rank 1.
 */
export function eliminationStandings(
  entrants: readonly Entrant[],
  rounds: readonly Round[],
  planned: number,
  onDraw: 'white' | 'black',
): StandingRow[] {
  const lines = scoreLines(entrants, rounds, 1);
  const withdrawn = new Map(entrants.map((e) => [e.id, e.withdrawn]));
  // The round a player went out in: 0 never seeded, planned + 1 still in (or the winner).
  const out = new Map<string, number>(entrants.map((e) => [e.id, 0]));
  for (const r of rounds) {
    for (const id of r.field ?? []) if (id !== null) out.set(id, planned + 1);
    if (r.finishedAt === null) continue;
    for (const p of r.pairings) {
      const adv = advances(p, onDraw);
      for (const id of [p.white, p.black]) if (id !== null && id !== adv) out.set(id, r.n);
    }
  }
  // Knockout points: rounds advanced from (byes and draw odds included).
  const advanced = new Map<string, number>();
  for (const r of rounds) {
    if (r.finishedAt === null) continue;
    for (const p of r.pairings) {
      const adv = advances(p, onDraw);
      if (adv !== null) advanced.set(adv, (advanced.get(adv) ?? 0) + 1);
    }
  }
  const rows = [...lines.values()].map((l) => ({ l, o: out.get(l.id) ?? 0 }));
  rows.sort((x, y) => y.o - x.o || x.l.seed - y.l.seed || (x.l.id < y.l.id ? -1 : 1));
  return rows.map(({ l, o }) => ({
    ...l,
    points: advanced.get(l.id) ?? 0,
    rank: o === 0 ? rows.length : o > planned ? 1 : eliminationPlace(o, planned),
    withdrawn: withdrawn.get(l.id) ?? false,
    alive: o > planned,
  }));
}

/** Who advances from a finished single-elimination pairing (null: nobody, a double loss). */
export function advances(p: Pairing, onDraw: 'white' | 'black'): string | null {
  switch (p.result) {
    case 'bye':
    case 'white':
      return p.white;
    case 'black':
      return p.black;
    case 'draw':
      return onDraw === 'white' ? p.white : p.black;
    default:
      return null;
  }
}
