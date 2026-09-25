/**
 * Step-through replay (11.2, R-ART-002: "every reaction chain is replayable step by step with a
 * plain-language log line per step"). Projected states are only sent per action, so intermediate
 * boards are rebuilt here from the live projection by undoing the projected events that came after
 * the chosen step. Only public board facts are touched (squares, piece types, burning squares,
 * check, turn, result); everything else, including reveals, stays as the viewer knows it now, so a
 * replay never shows more than the live projection (R-INFO-005).
 *
 * If the log and the live board ever disagree, `frameAt` returns null and the caller falls back to
 * the live board rather than draw a wrong position.
 */
import {
  elementFor,
  opposite,
  type BattleEvent,
  type PublicPiece,
  type PublicState,
  type Side,
} from '@chain-theorem/rules';
import type { LogEntry } from '../battle/controller.ts';

/** Burning squares live in the Hot Foot trait's public slice (R-ELEM-005). */
const HOT_FOOT = 'hot_foot';

interface Burn {
  sq: number;
  side: Side;
  turns: number;
  /** Lit during the opponent's turn: that partial turn does not count (DD-42). */
  fresh?: true;
}

function readBurns(slices: Record<string, unknown>): Burn[] | null {
  const hf = slices[HOT_FOOT] as { burning?: unknown } | undefined;
  if (!hf || !Array.isArray(hf.burning)) return null;
  return (hf.burning as Burn[]).map((b) => ({ ...b }));
}

/** Events that are replay steps: every logged event except the bookkeeping TurnPassed. */
export function isStep(ev: BattleEvent): boolean {
  return ev.k !== 'TurnPassed';
}

export interface ActionGroup {
  /** Index of the group in the log. */
  n: number;
  /** Heading: the ActionStarted line, "Battle start" or "Result". */
  title: string;
  side: Side | null;
  /** Steps of this group, in log order. */
  steps: LogEntry[];
}

/**
 * Split the log into actions: everything before the first ActionStarted is the battle start; each
 * ActionStarted opens a group that also holds the events of any mid-action choice; a BattleEnded
 * (resign, timeout, adjudication) gets its own group so the result is easy to find.
 */
export function groupActions(log: readonly LogEntry[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  let cur: ActionGroup | null = null;
  for (const e of log) {
    const ev = e.event;
    if (!isStep(ev)) continue;
    if (ev.k === 'ActionStarted') {
      cur = { n: groups.length, title: e.text, side: ev.side, steps: [e] };
      groups.push(cur);
      continue;
    }
    if (ev.k === 'BattleEnded') {
      groups.push({ n: groups.length, title: 'Result', side: null, steps: [e] });
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { n: groups.length, title: 'Battle start', side: null, steps: [] };
      groups.push(cur);
    }
    cur.steps.push(e);
  }
  return groups;
}

/**
 * The board right after log event `at` (a battle-wide event index), built by undoing every later
 * event on a copy of the live projection. Returns null when the log does not match the board.
 */
export function frameAt(
  live: PublicState,
  log: readonly LogEntry[],
  at: number,
): PublicState | null {
  const pieces: PublicPiece[] = live.pieces.map((p) => ({ ...p }));
  const board = live.board.slice();
  let burns = readBurns(live.slices);
  const retype = new Set<number>();

  const place = (id: number, from: number, to: number): boolean => {
    const p = pieces[id];
    if (!p || p.square !== from) return false;
    if (from >= 0) {
      if (board[from] !== id) return false;
      board[from] = -1;
    }
    if (to >= 0) {
      if ((board[to] ?? -1) >= 0) return false;
      board[to] = id;
    }
    p.square = to;
    return true;
  };

  for (let k = log.length - 1; k >= 0; k--) {
    const entry = log[k];
    if (!entry || entry.i <= at) break;
    const ev = entry.event;
    switch (ev.k) {
      case 'MoveMade': {
        if (ev.castle) {
          // The rook moves with the king and has no event of its own (castling = king's move).
          const rookFrom = ev.castle === 'K' ? ev.from + 3 : ev.from - 4;
          const rookTo = ev.castle === 'K' ? ev.from + 1 : ev.from - 1;
          const rook = board[rookTo] ?? -1;
          if (rook < 0 || !place(ev.piece, ev.to, ev.from) || !place(rook, rookTo, rookFrom))
            return null;
        } else if (!place(ev.piece, ev.to, ev.from)) return null;
        const p = pieces[ev.piece];
        if (p && p.type !== ev.pieceType) {
          p.type = ev.pieceType;
          retype.add(p.id);
        }
        break;
      }
      case 'Captured': {
        if (!place(ev.victim, -1, ev.square)) return null;
        const p = pieces[ev.victim];
        if (p && p.type !== ev.victimType) {
          p.type = ev.victimType;
          retype.add(p.id);
        }
        break;
      }
      case 'PieceMoved':
        if (!place(ev.piece, ev.to, ev.from)) return null;
        break;
      case 'PieceRevived':
        if (!place(ev.piece, ev.square, -1)) return null;
        break;
      case 'SquareIgnited':
        // A re-ignited square loses its earlier count here; the square itself stays exact.
        if (burns) burns = burns.filter((b) => b.sq !== ev.square);
        break;
      case 'SquareExtinguished': {
        // Extinguished during the countdown of the turn that the following TurnPassed closed.
        const next = nextTurnPassed(log, k);
        if (burns && next) burns.push({ sq: ev.square, side: next, turns: 1 });
        break;
      }
      case 'TurnPassed': {
        // Hot Foot counts down burns of the side that did not just move (onTurnEnd, R-ELEM-005).
        // A burn its side lit during this turn (a reaction on the opponent's move) was fresh and
        // did not count down at this turn end (DD-42).
        const mover = opposite(ev.side);
        if (burns)
          burns = burns.map((b): Burn => {
            if (b.side === mover) return b;
            return ignitedThisTurn(log, k, b.sq)
              ? { ...b, fresh: true }
              : { ...b, turns: b.turns + 1 };
          });
        break;
      }
      default:
        break;
    }
  }

  // Promoted (or revived-as-promoted) pieces take their type's group element again (R-RULES-002).
  for (const id of retype) {
    const p = pieces[id];
    if (p) p.element = elementFor(live.armies[p.side].elements, p.type);
  }

  // Turn, check and result as of `at`, read forward from the log.
  let turn: Side | null = null;
  let inCheck: Side | null = null;
  let result: PublicState['result'] = null;
  for (const e of log) {
    const ev = e.event;
    if (e.i > at) {
      // Before any action: the side to move is whoever makes the next one.
      if (turn === null && ev.k === 'ActionStarted') turn = ev.side;
      if (turn !== null) break;
      continue;
    }
    if (ev.k === 'ActionStarted') turn = ev.side;
    else if (ev.k === 'TurnPassed') {
      turn = ev.side;
      inCheck = null;
    } else if (ev.k === 'Check') inCheck = ev.side;
    else if (ev.k === 'MoveMade' && ev.side === inCheck && ev.depth === 0) inCheck = null;
    else if (ev.k === 'BattleEnded') result = ev.result;
  }

  const slices = burns
    ? {
        ...live.slices,
        [HOT_FOOT]: { ...(live.slices[HOT_FOOT] as object), burning: burns },
      }
    : live.slices;
  return {
    ...live,
    board,
    pieces,
    slices,
    turn: turn ?? live.turn,
    inCheck,
    result,
    // Events emitted so far: lets the board tell replay frames apart and chain step animations.
    eventSeq: at + 1,
    legal: [],
    pending: null,
  };
}

/** Was `sq` ignited earlier in the turn that the TurnPassed at `k` closes? */
function ignitedThisTurn(log: readonly LogEntry[], k: number, sq: number): boolean {
  for (let j = k - 1; j >= 0; j--) {
    const ev = log[j]?.event;
    if (!ev || ev.k === 'TurnPassed') return false;
    if (ev.k === 'SquareIgnited' && ev.square === sq) return true;
  }
  return false;
}

function nextTurnPassed(log: readonly LogEntry[], k: number): Side | null {
  for (let j = k + 1; j < log.length; j++) {
    const ev = log[j]?.event;
    if (ev?.k === 'TurnPassed') return ev.side;
  }
  return null;
}

/** Squares a replay step points at: a move's from/to, or the square the step happened on. */
export function stepSquares(ev: BattleEvent): { move: [number, number] | null; focus: number[] } {
  switch (ev.k) {
    case 'ActionStarted':
      return { move: [ev.move.from, ev.move.to], focus: [] };
    case 'MoveMade':
    case 'PieceMoved':
      return { move: [ev.from, ev.to], focus: [] };
    case 'Captured':
      return { move: null, focus: [ev.square] };
    case 'PieceRevived':
      return { move: null, focus: [ev.square] };
    case 'SquareIgnited':
    case 'SquareExtinguished':
    case 'Check':
      return { move: null, focus: [ev.square] };
    default:
      return { move: null, focus: [] };
  }
}

/** The piece a step is about, for the board focus and screen-reader text. */
export function stepPiece(ev: BattleEvent): number | null {
  switch (ev.k) {
    case 'MoveMade':
    case 'PieceMoved':
    case 'PieceRevived':
    case 'Promoted':
    case 'AbilityTriggered':
    case 'AbilitySilenced':
    case 'AbilityNegated':
    case 'ChargeSpent':
      return ev.piece;
    case 'Captured':
      return ev.victim;
    default:
      return null;
  }
}

export type ReplayNav = 'back' | 'forward' | 'prevAction' | 'nextAction';

/**
 * Where a replay control leads. `at` is the event index being shown, null for the live board (which
 * equals the last step). Returns the new event index, or null to go back to live.
 */
export function navigate(
  groups: readonly ActionGroup[],
  at: number | null,
  nav: ReplayNav,
): number | null {
  const steps = groups.flatMap((g) => g.steps);
  const last = steps.length - 1;
  if (last < 0) return null;
  const found = at === null ? last : steps.findIndex((s) => s.i === at);
  const idx = found < 0 ? last : found;
  const toIndex = (k: number): number | null => (k >= last ? null : (steps[k]?.i ?? null));
  const groupStarts: number[] = [];
  let k = 0;
  for (const g of groups) {
    groupStarts.push(k);
    k += g.steps.length;
  }
  const gi = groupStarts.findLastIndex((start) => start <= idx);
  switch (nav) {
    case 'back':
      return steps[Math.max(0, idx - 1)]?.i ?? null;
    case 'forward':
      return at === null ? null : toIndex(idx + 1);
    case 'prevAction': {
      const start = groupStarts[gi] ?? 0;
      const target = idx > start || at === null ? start : (groupStarts[gi - 1] ?? start);
      return steps[target]?.i ?? null;
    }
    case 'nextAction': {
      const next = groupStarts[gi + 1];
      return next === undefined ? null : toIndex(next);
    }
  }
}
