/**
 * Fast ability-aware alpha-beta on the rules engine's scratch position (make/unmake). Hook-derived
 * movement (Flow, Hot Foot, Stalwart) comes from the position's MoveRules; capture reactions known
 * to the searcher are approximated from ability profiles: a known Poisoned-Meat-style retaliation
 * removes the captor, other effects adjust the score. Hidden abilities are never read (9.4).
 */
import {
  type ElementId,
  type PieceType,
  type Pos,
  F_CAPTURE,
  F_EP,
  mFrom,
  mTo,
  mPromo,
} from '@chain-theorem/rules';
import { type PieceKnowledge, silenced } from './knowledge.ts';

export const WIN = 1_000_000;
const TYPES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
export const VALUE = [100, 320, 330, 500, 900, 0];

// Piece-square tables from white's point of view, index 0 = a1 (simplified, public-domain style).
const PST: number[][] = [
  // pawn
  [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0,
    20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50,
    50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  // knight
  [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10,
    5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10,
    0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  // bishop
  [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  // rook
  [
    0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0,
    0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  // queen
  [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0,
    0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0,
    0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  // king (middlegame: stay home)
  [
    20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20,
    -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40,
    -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50,
    -40, -40, -30,
  ],
];

export interface SearchCtx {
  pos: Pos;
  elem: ElementId[];
  know: [Record<PieceType, PieceKnowledge>, Record<PieceType, PieceKnowledge>];
  abilityAware: boolean;
  /** Fraction of the captor's value charged for capturing a piece with unknown abilities. */
  risk: number;
  silence: 'ALL_TRIGGERS' | 'REACTIONS_ONLY' | 'OFF';
  objectiveNeed: number | null;
  objective: [number, number];
  nodes: number;
  maxNodes: number;
  deadline: number;
  now: (() => number) | null;
  aborted: boolean;
}

function pst(type: number, sq: number, side: number): number {
  const idx = side === 0 ? sq : (7 - (sq >> 3)) * 8 + (sq & 7);
  return (PST[type] as number[])[idx] as number;
}

/** Static evaluation from the side to move's point of view. */
export function evalPos(ctx: SearchCtx, stm: number): number {
  const pos = ctx.pos;
  let s = 0;
  for (let id = 0; id < pos.n; id++) {
    const sq = pos.psq[id] as number;
    if (sq < 0) continue;
    const t = pos.ptype[id] as number;
    const side = pos.pside[id] as number;
    let v = (VALUE[t] as number) + pst(t, sq, side);
    if (ctx.abilityAware) v += 12 * (ctx.know[side as 0 | 1][TYPES[t] as PieceType]?.count ?? 0);
    s += side === 0 ? v : -v;
  }
  if (ctx.objectiveNeed !== null) s += 60 * (ctx.objective[0] - ctx.objective[1]);
  return stm === 0 ? s : -s;
}

interface Played {
  undo: ReturnType<Pos['make']>;
  killed: number;
  killedSq: number;
  bias: number;
  obj: [number, number];
  terminal: number;
}

function checkBudget(ctx: SearchCtx): void {
  if ((ctx.nodes & 1023) === 0) {
    if (ctx.nodes >= ctx.maxNodes) ctx.aborted = true;
    else if (ctx.now && ctx.now() >= ctx.deadline) ctx.aborted = true;
  }
}

/** Make a move plus the known reactions. `bias` and `terminal` are from the mover's point of view. */
function play(ctx: SearchCtx, m: number): Played {
  const pos = ctx.pos;
  const from = mFrom(m);
  const to = mTo(m);
  const captor = pos.board[from] as number;
  const mover = pos.pside[captor] as number;
  const captorType = pos.ptype[captor] as number;
  let victim = -1;
  if (m & F_EP) victim = pos.board[to + (mover === 0 ? -8 : 8)] as number;
  else if (m & F_CAPTURE) victim = pos.board[to] as number;
  const victimType = victim >= 0 ? (pos.ptype[victim] as number) : -1;
  const undo = pos.make(m);
  const out: Played = {
    undo,
    killed: -1,
    killedSq: -1,
    bias: 0,
    obj: [ctx.objective[0], ctx.objective[1]],
    terminal: 0,
  };
  if (victim < 0) return out;
  if (victimType === 5) {
    out.terminal = WIN; // a Stalwart king captured by a piece (R-RULES-003)
    return out;
  }
  if (victimType !== 0) ctx.objective[mover] = (ctx.objective[mover] ?? 0) + 1;
  if (ctx.abilityAware) {
    const vSide = pos.pside[victim] as 0 | 1;
    const vK = ctx.know[vSide][TYPES[victimType] as PieceType];
    const cK = ctx.know[mover as 0 | 1][TYPES[captorType] as PieceType];
    const sil =
      ctx.silence === 'OFF'
        ? { victim: false, captor: false }
        : silenced(ctx.elem[captor] ?? 'neutral', ctx.elem[victim] ?? 'neutral');
    const capturingSilenced = sil.captor && ctx.silence === 'ALL_TRIGGERS';
    const negated = !capturingSilenced && cK.capturing.negatesVictim;
    const protectedSelf = !capturingSilenced && cK.capturing.protectsSelf;
    const reactions = sil.victim || negated ? null : vK.captured;
    if (reactions?.killsCaptor && captorType !== 5 && !protectedSelf) {
      out.killed = captor;
      out.killedSq = to;
      pos.board[to] = -1;
      pos.psq[captor] = -1;
      const promoted = mPromo(m) || captorType;
      if (promoted !== 0) ctx.objective[vSide] = (ctx.objective[vSide] ?? 0) + 1;
    }
    if (reactions?.selfRevive) out.bias -= Math.round((VALUE[victimType] as number) * 0.6);
    if (reactions?.killsOther) out.bias -= 70;
    if (!sil.captor) {
      if (cK.captures.killsOther) out.bias += 70;
      if (cK.captures.reviveFriendly) out.bias += 60;
      if (cK.captures.bonus) out.bias += 20;
    }
    if (vK.uncertain) out.bias -= Math.round(ctx.risk * (VALUE[captorType] as number));
  }
  if (ctx.objectiveNeed !== null) {
    const need = ctx.objectiveNeed;
    // Earliest qualifying capture wins: the mover's own capture is counted first.
    if ((ctx.objective[mover] ?? 0) >= need) out.terminal = WIN;
    else if ((ctx.objective[mover ^ 1] ?? 0) >= need) out.terminal = -WIN;
  }
  return out;
}

function unplay(ctx: SearchCtx, p: Played): void {
  const pos = ctx.pos;
  if (p.killed >= 0) {
    pos.board[p.killedSq] = p.killed;
    pos.psq[p.killed] = p.killedSq;
  }
  pos.unmake(p.undo);
  ctx.objective[0] = p.obj[0];
  ctx.objective[1] = p.obj[1];
}

function orderMoves(pos: Pos, moves: number[]): number[] {
  const keyed = moves.map((m) => {
    let k = 0;
    if (m & F_CAPTURE) {
      const v = m & F_EP ? 0 : (pos.ptype[pos.board[mTo(m)] as number] as number);
      const a = pos.ptype[pos.board[mFrom(m)] as number] as number;
      k = 10_000 + (VALUE[v] as number) * 10 - (VALUE[a] as number) / 10;
    }
    if (mPromo(m)) k += 8000 + (VALUE[mPromo(m)] as number);
    return { m, k };
  });
  keyed.sort((x, y) => y.k - x.k);
  return keyed.map((x) => x.m);
}

export function quiesce(ctx: SearchCtx, alpha: number, beta: number, qdepth: number): number {
  ctx.nodes++;
  checkBudget(ctx);
  const pos = ctx.pos;
  const stm = pos.turn;
  const stand = evalPos(ctx, stm);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qdepth <= 0 || ctx.aborted) return alpha;
  const moves = orderMoves(
    pos,
    pos.legal(stm).filter((m) => m & F_CAPTURE || mPromo(m)),
  );
  for (const m of moves) {
    const p = play(ctx, m);
    const score =
      p.terminal !== 0
        ? p.terminal
        : -quiesce(ctx, -(beta - p.bias), -(alpha - p.bias), qdepth - 1) + p.bias;
    unplay(ctx, p);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
    if (ctx.aborted) break;
  }
  return alpha;
}

export function negamax(
  ctx: SearchCtx,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  if (depth <= 0) return quiesce(ctx, alpha, beta, 6);
  ctx.nodes++;
  checkBudget(ctx);
  const pos = ctx.pos;
  const stm = pos.turn;
  const moves = pos.legal(stm);
  if (moves.length === 0) {
    const inCheck = pos.inCheck(stm) && !pos.rules.stalwart[stm];
    return inCheck ? -WIN + ply : 0;
  }
  let best = -Infinity;
  for (const m of orderMoves(pos, moves)) {
    const p = play(ctx, m);
    const score =
      p.terminal !== 0
        ? p.terminal - Math.sign(p.terminal) * ply
        : -negamax(ctx, depth - 1, -(beta - p.bias), -(alpha - p.bias), ply + 1) + p.bias;
    unplay(ctx, p);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta || ctx.aborted) break;
  }
  return best;
}
