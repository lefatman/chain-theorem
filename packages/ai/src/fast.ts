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
import { type PieceKnowledge, silenced, traitEffects } from './knowledge.ts';

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
  /** Each piece's starting square (its identity's start, DD-22), for sends-home effects. */
  start: number[];
  /** 1 for a Stone piece whose Bulwark is already spent (public slice, 6.1). */
  bulwarkSpent: Uint8Array;
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

export interface Played {
  undo: ReturnType<Pos['make']>;
  killed: number;
  killedSq: number;
  /** A captor pushed back or sent home by a known reaction (Frost Heave, Permafrost), or -1. */
  pushed: number;
  pushedTo: number;
  bias: number;
  obj: [number, number];
  terminal: number;
}

/** Budget check every 256 nodes: a clock read costs little next to 256 move generations. */
function checkBudget(ctx: SearchCtx): void {
  if ((ctx.nodes & 255) === 0) {
    if (ctx.nodes >= ctx.maxNodes) ctx.aborted = true;
    else if (ctx.now && ctx.now() >= ctx.deadline) ctx.aborted = true;
  }
}

/** Make a move plus the known reactions. `bias` and `terminal` are from the mover's point of view. */
export function play(ctx: SearchCtx, m: number): Played {
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
    pushed: -1,
    pushedTo: -1,
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
    const captorEl = ctx.elem[captor] ?? 'neutral';
    const victimEl = ctx.elem[victim] ?? 'neutral';
    const sil =
      ctx.silence === 'OFF' ? { victim: false, captor: false } : silenced(captorEl, victimEl);
    const trait = traitEffects(captorEl, victimEl);
    const capturingSilenced = sil.captor && ctx.silence === 'ALL_TRIGGERS';
    const negated = !capturingSilenced && cK.capturing.negatesVictim;
    // Always First (6.1): a Storm captor's own After-capturing guard resolves before retaliation.
    const protectedSelf =
      (!capturingSilenced && cK.capturing.protectsSelf) ||
      (trait.stormFirst && !sil.captor && !trait.stillness && cK.captures.protectsSelf);
    const reactions = sil.victim || negated ? null : vK.captured;
    // Bulwark (6.1): a Stone captor's first effect capture fizzles.
    const bulwark = trait.captorBulwark && ctx.bulwarkSpent[captor] !== 1;
    if (reactions?.killsCaptor && captorType !== 5 && !protectedSelf && !bulwark) {
      out.killed = captor;
      out.killedSq = to;
      pos.board[to] = -1;
      pos.psq[captor] = -1;
      const promoted = mPromo(m) || captorType;
      if (promoted !== 0) ctx.objective[vSide] = (ctx.objective[vSide] ?? 0) + 1;
    } else if ((reactions?.pushesCaptor || reactions?.sendsCaptorHome) && captorType !== 5) {
      // Frost Heave / Permafrost: the capture stands, but the captor loses the ground it gained.
      const home = ctx.start[captor] ?? -1;
      let dest = -1;
      if (reactions.sendsCaptorHome && home >= 0 && (pos.board[home] as number) < 0) dest = home;
      else if (reactions.pushesCaptor && (pos.board[from] as number) < 0) dest = from;
      if (dest >= 0) {
        out.pushed = captor;
        out.pushedTo = dest;
        pos.board[to] = -1;
        pos.board[dest] = captor;
        pos.psq[captor] = dest;
      }
    }
    if (reactions?.selfRevive) out.bias -= Math.round((VALUE[victimType] as number) * 0.6);
    // Buttress: the captor's CAPTURING guard shields a neighbour from Backdraft-style captures.
    const guarded = !capturingSilenced && cK.capturing.protectsFriend;
    if (reactions?.killsOther && !guarded) out.bias -= 70;
    // Squall: the victim's side gets a free move (Riposte's recapture is a capture, not tempo).
    if (reactions?.bonus && !reactions.recaptures) out.bias -= 15;
    if (reactions?.movesEnemy) out.bias -= 25;
    if (!capturingSilenced && cK.capturing.movesEnemy) out.bias += 30;
    // Stillness negates the captor's After-capturing abilities; so does a Stonewall-style reaction,
    // unless Always First resolves them before it.
    const capturesNegated =
      trait.stillness || (reactions?.negatesCaptor === true && !trait.stormFirst);
    if (!sil.captor && !capturesNegated) {
      if (cK.captures.killsOther) out.bias += 70;
      if (cK.captures.reviveFriendly) out.bias += 60;
      if (cK.captures.bonus) out.bias += 20;
      if (cK.captures.movesEnemy) out.bias += 25;
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

export function unplay(ctx: SearchCtx, p: Played): void {
  const pos = ctx.pos;
  if (p.killed >= 0) {
    pos.board[p.killedSq] = p.killed;
    pos.psq[p.killed] = p.killedSq;
  }
  if (p.pushed >= 0) {
    // Back onto the capture square before the move itself is undone.
    const to = mTo(p.undo.m);
    pos.board[p.pushedTo] = -1;
    pos.board[to] = p.pushed;
    pos.psq[p.pushed] = to;
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

/**
 * Legal captures and promotions for `side`: the same list as `pos.legal(side)` filtered to
 * tactical moves, but only tactical pseudo-moves pay for the king-safety check.
 */
function tacticalMoves(pos: Pos, side: number): number[] {
  const pseudo: number[] = [];
  pos.pseudo(side, pseudo);
  const stalwart = pos.rules.stalwart[side] === true;
  const out: number[] = [];
  for (const m of pseudo) {
    if (!(m & F_CAPTURE) && !mPromo(m)) continue;
    if (stalwart || !pos.leavesInCheck(m, side)) out.push(m);
  }
  return out;
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
  const moves = orderMoves(pos, tacticalMoves(pos, stm));
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
