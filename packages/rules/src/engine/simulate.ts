/**
 * Drafts for simulations (INV-03 checks, choice filtering, king safety after the turn ends). A draft
 * is a cheap copy of the state with one change applied; movement rules are then recomputed from the
 * draft, so a revived or promoted piece brings its own Flow and Hot Foot rules into the check.
 */
import { castlingMaskFor, elementFor, typeOf } from '../board.ts';
import { F_CAPTURE, F_CASTLE, F_EP, type MoveRules, Pos, mFrom, mPromo, mTo } from '../movegen.ts';
import type { GameState, PieceId, Side, Square } from '../types.ts';
import { EventHost } from './host.ts';
import type { HookEntry, Runtime } from './runtime.ts';

export interface Change {
  remove?: PieceId;
  move?: { id: PieceId; to: Square };
  place?: { id: PieceId; to: Square };
  /** An encoded chess move (capture, castling rook, en passant and promotion included). */
  chess?: number;
}

export function draftOf(s: GameState): GameState {
  return {
    ...s,
    board: s.board.slice(),
    pieces: s.pieces.map((p) => ({ ...p })),
    slices: { ...s.slices },
  };
}

export function applyChange(d: GameState, c: Change): void {
  const lift = (id: PieceId) => {
    const p = d.pieces[id];
    if (p && p.square >= 0) d.board[p.square] = -1;
    if (p) p.square = -1;
  };
  const put = (id: PieceId, to: Square) => {
    const p = d.pieces[id];
    if (!p) return;
    if (p.square >= 0) d.board[p.square] = -1;
    d.board[to] = id;
    p.square = to;
  };
  if (c.remove !== undefined) lift(c.remove);
  if (c.move) put(c.move.id, c.move.to);
  if (c.place) put(c.place.id, c.place.to);
  if (c.chess !== undefined) {
    const m = c.chess;
    const from = mFrom(m);
    const to = mTo(m);
    const id = d.board[from] ?? -1;
    const p = d.pieces[id];
    if (!p) return;
    if (m & F_EP) lift(d.board[to + (p.side === 'white' ? -8 : 8)] ?? -1);
    else if (m & F_CAPTURE) lift(d.board[to] ?? -1);
    put(id, to);
    if (m & F_CASTLE) {
      const kingSide = to > from;
      const rook = d.board[kingSide ? from + 3 : from - 4] ?? -1;
      if (rook >= 0) put(rook, kingSide ? from + 1 : from - 1);
    }
    d.castling &= ~(castlingMaskFor(from) | castlingMaskFor(to));
    const promo = mPromo(m);
    if (promo) {
      p.type = typeOf(promo);
      p.element = elementFor(d.armies[p.side].loadout.elements, p.type);
    }
  }
}

export interface Simulated {
  draft: GameState;
  pos: Pos;
  rules: MoveRules;
  kingSources: Map<Side, HookEntry>;
}

/** Apply `change` to a draft and build a scratch position with rules recomputed from the draft. */
export function simulate(rt: Runtime, s: GameState, change: Change): Simulated {
  const draft = draftOf(s);
  applyChange(draft, change);
  const kingSources = new Map<Side, HookEntry>();
  const rules = rt.moveRules(new EventHost(rt, draft), kingSources);
  return { draft, pos: Pos.fromState(draft, rules), rules, kingSources };
}

/**
 * Movement rules as they will stand once `endingSide`'s turn ends (onTurnEnd hooks applied to a
 * draft), or null when the turn end changes nothing. A side's own king safety is judged against
 * these, so an expiring burn cannot leave its king in check (INV-03, R-ELEM-005, DD-47).
 */
export function rulesAfterTurnEnd(rt: Runtime, s: GameState, endingSide: Side): MoveRules | null {
  const hooks = rt.hook(s, 'onTurnEnd');
  if (hooks.length === 0) return null;
  const draft: GameState = { ...s, slices: { ...s.slices } };
  const host = new EventHost(rt, draft);
  for (const e of hooks) e.hooks.onTurnEnd?.(rt.ctx(host, e), { side: endingSide });
  let changed = false;
  for (const k of Object.keys(draft.slices)) if (draft.slices[k] !== s.slices[k]) changed = true;
  if (!changed) return null;
  return rt.moveRules(new EventHost(rt, draft));
}
