/**
 * Animation planning for one committed action (11.2, R-ART-002). Turns projected events into a
 * timeline of visual steps with start times and durations. Pure (no Phaser, no DOM), so the
 * timing guarantees are unit-tested:
 *
 * - Steps follow the event order, one after another, so a reaction chain reads step by step.
 * - A chain never takes longer than CHAIN_CAP_STEPS base durations; in fast mode (or whenever the
 *   base duration is at most FAST_MS_THRESHOLD) the whole chain fits in FAST_CHAIN_MS (< 1 s).
 * - A base duration of 0 (reduced motion) yields an empty plan: nothing animates.
 */
import type { ElementId, PieceType, PublicEvent, PublicState, Side } from '@chain-theorem/rules';

export const CHAIN_CAP_STEPS = 12;
export const FAST_CHAIN_MS = 800;
export const FAST_MS_THRESHOLD = 100;

interface Timed {
  start: number;
  dur: number;
}

export type AnimStep = Timed &
  (
    | { k: 'move'; piece: number; from: number; to: number; hop: number }
    | { k: 'faint'; piece: number; square: number }
    | {
        k: 'revive';
        piece: number;
        square: number;
        type: PieceType;
        element: ElementId;
        side: Side;
      }
    | { k: 'promote'; piece: number; type: PieceType; element: ElementId }
    | { k: 'ignite'; square: number; turns: number }
    | { k: 'extinguish'; square: number }
    | { k: 'burst'; square: number; element: ElementId }
    | { k: 'fizzle'; square: number }
    | { k: 'check'; square: number }
  );

export interface AnimPlan {
  steps: AnimStep[];
  /** Total wall time in ms (the last step's end). */
  total: number;
}

/** Relative weight of each step kind, in base durations. */
export const STEP_WEIGHT = {
  move: 1,
  effectMove: 0.8,
  faint: 0.9,
  revive: 0.8,
  promote: 0.5,
  ignite: 0.6,
  extinguish: 0.4,
  burst: 0.6,
  fizzle: 0.45,
  check: 0.5,
} as const;

/** Hop height in game pixels: knights leap, everyone else hops a little. */
function hopFor(type: PieceType | undefined): number {
  return type === 'knight' ? 20 : type === 'pawn' ? 4 : 7;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Unit = DistOmit<AnimStep, 'start' | 'dur'> & { w: number; parallel?: boolean };

/**
 * Plan the animation for `events`, starting from the projected state `before`.
 * `fast` forces the fast-mode cap; by default it applies when baseMs <= FAST_MS_THRESHOLD.
 */
export function planAnimation(
  before: PublicState,
  events: readonly PublicEvent[],
  baseMs: number,
  fast?: boolean,
): AnimPlan {
  if (!(baseMs > 0)) return { steps: [], total: 0 };
  const square = new Map<number, number>();
  const last = new Map<number, number>();
  const info = new Map<number, { type: PieceType; element: ElementId; side: Side }>();
  const board = new Map<number, number>();
  for (const p of before.pieces) {
    square.set(p.id, p.square);
    if (p.square >= 0) {
      last.set(p.id, p.square);
      board.set(p.square, p.id);
    }
    info.set(p.id, { type: p.type, element: p.element, side: p.side });
  }
  const place = (id: number, sq: number) => {
    const old = square.get(id) ?? -1;
    if (old >= 0 && board.get(old) === id) board.delete(old);
    square.set(id, sq);
    if (sq >= 0) {
      last.set(id, sq);
      board.set(sq, id);
    }
  };
  const where = (id: number): number => {
    const s = square.get(id) ?? -1;
    return s >= 0 ? s : (last.get(id) ?? -1);
  };

  const units: Unit[] = [];
  for (const ev of landFirst(events)) {
    switch (ev.k) {
      case 'MoveMade': {
        units.push({
          k: 'move',
          piece: ev.piece,
          from: ev.from,
          to: ev.to,
          hop: hopFor(info.get(ev.piece)?.type),
          w: STEP_WEIGHT.move,
        });
        if (ev.castle) {
          const rank = ev.from & ~7;
          const rookFrom = rank + (ev.castle === 'K' ? 7 : 0);
          const rookTo = rank + (ev.castle === 'K' ? 5 : 3);
          const rook = board.get(rookFrom);
          if (rook !== undefined) {
            units.push({
              k: 'move',
              piece: rook,
              from: rookFrom,
              to: rookTo,
              hop: 4,
              w: STEP_WEIGHT.move,
              parallel: true,
            });
            place(rook, rookTo);
          }
        }
        // A capture's victim stays drawn until its Captured step (it may come after this move).
        const victim = board.get(ev.to);
        place(ev.piece, ev.to);
        if (victim !== undefined && victim !== ev.piece) {
          square.set(victim, -1);
          last.set(victim, ev.to);
        }
        break;
      }
      case 'PieceMoved':
        units.push({
          k: 'move',
          piece: ev.piece,
          from: ev.from,
          to: ev.to,
          hop: 3,
          w: STEP_WEIGHT.effectMove,
        });
        place(ev.piece, ev.to);
        break;
      case 'Captured': {
        units.push({ k: 'faint', piece: ev.victim, square: ev.square, w: STEP_WEIGHT.faint });
        if (board.get(ev.square) === ev.victim) board.delete(ev.square);
        square.set(ev.victim, -1);
        last.set(ev.victim, ev.square);
        break;
      }
      case 'PieceRevived': {
        const p = info.get(ev.piece);
        if (!p) break;
        units.push({
          k: 'revive',
          piece: ev.piece,
          square: ev.square,
          type: p.type,
          element: p.element,
          side: p.side,
          w: STEP_WEIGHT.revive,
        });
        place(ev.piece, ev.square);
        break;
      }
      case 'Promoted': {
        const p = info.get(ev.piece);
        if (p) info.set(ev.piece, { ...p, type: ev.to, element: ev.element });
        units.push({
          k: 'promote',
          piece: ev.piece,
          type: ev.to,
          element: ev.element,
          w: STEP_WEIGHT.promote,
        });
        break;
      }
      case 'SquareIgnited':
        units.push({ k: 'ignite', square: ev.square, turns: ev.turns, w: STEP_WEIGHT.ignite });
        break;
      case 'SquareExtinguished':
        units.push({ k: 'extinguish', square: ev.square, w: STEP_WEIGHT.extinguish });
        break;
      case 'AbilityTriggered': {
        const sq = where(ev.piece);
        if (sq >= 0)
          units.push({
            k: 'burst',
            square: sq,
            element: info.get(ev.piece)?.element ?? 'neutral',
            w: STEP_WEIGHT.burst,
          });
        break;
      }
      case 'AbilitySilenced':
      case 'AbilityNegated':
      case 'EffectFizzled': {
        const sq = where(ev.piece);
        if (sq >= 0) units.push({ k: 'fizzle', square: sq, w: STEP_WEIGHT.fizzle });
        break;
      }
      case 'Check':
        units.push({ k: 'check', square: ev.square, w: STEP_WEIGHT.check });
        break;
      default:
        break;
    }
  }
  if (units.length === 0) return { steps: [], total: 0 };

  let raw = 0;
  for (const u of units) if (!u.parallel) raw += u.w * baseMs;
  const isFast = fast ?? baseMs <= FAST_MS_THRESHOLD;
  const cap = Math.min(CHAIN_CAP_STEPS * baseMs, isFast ? FAST_CHAIN_MS : Infinity);
  const k = raw > cap ? cap / raw : 1;

  const steps: AnimStep[] = [];
  let cursor = 0;
  let prevStart = 0;
  for (const u of units) {
    const { w, parallel, ...rest } = u;
    const dur = w * baseMs * k;
    const start = parallel ? prevStart : cursor;
    steps.push({ ...rest, start, dur } as AnimStep);
    if (!parallel) {
      prevStart = cursor;
      cursor += dur;
    }
  }
  const total = steps.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
  return { steps, total };
}

/**
 * The engine records a move capture's Captured event before the captor's MoveMade. On screen the
 * attacker should land first and the victim faint after, so each such pair is swapped.
 */
export function landFirst(events: readonly PublicEvent[]): PublicEvent[] {
  const out = [...events];
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (
      a?.k === 'Captured' &&
      a.by === 'move' &&
      b?.k === 'MoveMade' &&
      b.capture &&
      b.piece === a.captor
    ) {
      out[i] = b;
      out[i + 1] = a;
      i++;
    }
  }
  return out;
}
