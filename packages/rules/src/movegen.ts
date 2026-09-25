/**
 * Fast, hook-aware move generation on a mutable scratch position (R-RULES-001, R-RULES-003,
 * R-ELEM-005, R-ELEM-006). The public engine converts GameState into a `Pos` once per call; perft runs
 * directly on `Pos` with make/unmake.
 *
 * Movement modifiers come from hooks as per-piece data (`MoveRules`), so move generation stays fast:
 * - passThrough[id]: Flow — the piece may slide (or double-push) through its own side's pieces.
 * - blocked[id]:     Hot Foot — squares the piece may not move to or capture a piece standing on.
 * - stalwart[side]:  Stalwart king — its owner may leave it in check and castle through attacks.
 */
import {
  BISHOP,
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  castlingMaskFor,
  fileOf,
  rankOf,
  sideCode,
  typeCode,
  typeOf,
} from './board.ts';
import type { GameState, Move, PromotionType, Side, Square } from './types.ts';

export const F_CAPTURE = 1 << 15;
export const F_EP = 1 << 16;
export const F_CASTLE = 1 << 17;
export const F_DOUBLE = 1 << 18;

export const mFrom = (m: number): number => m & 63;
export const mTo = (m: number): number => (m >> 6) & 63;
export const mPromo = (m: number): number => (m >> 12) & 7;

export function encodeMove(from: Square, to: Square, promo = 0, flags = 0): number {
  return from | (to << 6) | (promo << 12) | flags;
}

export function decodeMove(m: number): Move {
  const promo = mPromo(m);
  const move: Move = { from: mFrom(m), to: mTo(m) };
  if (promo) move.promotion = typeOf(promo) as PromotionType;
  return move;
}

export interface MoveRules {
  passThrough: Uint8Array;
  blocked: (Uint8Array | null)[];
  stalwart: [boolean, boolean];
  anyPass: [boolean, boolean];
}

export function defaultRules(n: number): MoveRules {
  return {
    passThrough: new Uint8Array(n),
    blocked: new Array<Uint8Array | null>(n).fill(null),
    stalwart: [false, false],
    anyPass: [false, false],
  };
}

// ---- precomputed tables -------------------------------------------------------------------------

const KNIGHT_TARGETS: number[][] = [];
const KING_TARGETS: number[][] = [];
/** RAYS[sq][dir]: dirs 0..3 orthogonal (N, S, E, W), 4..7 diagonal (NE, NW, SE, SW). */
const RAYS: number[][][] = [];
const DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const CASTLE_MASK = new Int32Array(64);

for (let s = 0; s < 64; s++) {
  const f = s & 7;
  const r = s >> 3;
  const kn: number[] = [];
  for (const [df, dr] of [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
  ] as const) {
    const nf = f + df;
    const nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kn.push(nr * 8 + nf);
  }
  KNIGHT_TARGETS.push(kn);
  const kg: number[] = [];
  for (const [df, dr] of DIRS) {
    const nf = f + df;
    const nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kg.push(nr * 8 + nf);
  }
  KING_TARGETS.push(kg);
  const rays: number[][] = [];
  for (const [df, dr] of DIRS) {
    const ray: number[] = [];
    let nf = f + df;
    let nr = r + dr;
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      ray.push(nr * 8 + nf);
      nf += df;
      nr += dr;
    }
    rays.push(ray);
  }
  RAYS.push(rays);
  CASTLE_MASK[s] = castlingMaskFor(s);
}

export function kingTargets(s: Square): readonly number[] {
  return KING_TARGETS[s] as number[];
}

// ---- scratch position -----------------------------------------------------------------------------

interface Undo {
  m: number;
  id: number;
  captured: number;
  capSq: number;
  castling: number;
  ep: number;
  prevType: number;
  rook: number;
  rookFrom: number;
  rookTo: number;
}

export class Pos {
  readonly board = new Int8Array(64).fill(-1);
  readonly ptype: Uint8Array;
  readonly pside: Uint8Array;
  readonly psq: Int8Array;
  readonly king = new Int8Array([-1, -1]);
  turn = WHITE;
  castling = 0;
  ep = -1;
  rules: MoveRules;

  constructor(readonly n: number) {
    this.ptype = new Uint8Array(n);
    this.pside = new Uint8Array(n);
    this.psq = new Int8Array(n).fill(-1);
    this.rules = defaultRules(n);
  }

  static fromState(
    state: Pick<GameState, 'pieces' | 'board' | 'turn' | 'castling' | 'ep'>,
    rules?: MoveRules,
  ): Pos {
    const pos = new Pos(state.pieces.length);
    for (const p of state.pieces) {
      pos.ptype[p.id] = typeCode(p.type);
      pos.pside[p.id] = sideCode(p.side);
      pos.psq[p.id] = p.square;
      if (p.square >= 0) pos.board[p.square] = p.id;
      if (p.type === 'king') pos.king[sideCode(p.side)] = p.id;
    }
    pos.turn = sideCode(state.turn);
    pos.castling = state.castling;
    pos.ep = state.ep;
    if (rules) pos.rules = rules;
    return pos;
  }

  private blk(id: number, s: number): boolean {
    const b = this.rules.blocked[id];
    return b != null && b[s] === 1;
  }

  /** An ordinary king is never captured (INV-02); a Stalwart king can be (R-RULES-003). */
  private capturable(id: number): boolean {
    return this.ptype[id] !== KING || this.rules.stalwart[this.pside[id] as number] === true;
  }

  /** Is `target` attacked by a piece of side `by`? Hook-aware: Flow rays and Hot Foot blocks. */
  attacked(target: number, by: number): boolean {
    const board = this.board;
    const ptype = this.ptype;
    const pside = this.pside;
    // Pawns: a white pawn on s attacks s+7 (file-1) and s+9 (file+1).
    const tf = target & 7;
    if (by === WHITE) {
      if (tf > 0 && target - 9 >= 0) {
        const id = board[target - 9] as number;
        if (id >= 0 && pside[id] === WHITE && ptype[id] === PAWN && !this.blk(id, target))
          return true;
      }
      if (tf < 7 && target - 7 >= 0) {
        const id = board[target - 7] as number;
        if (id >= 0 && pside[id] === WHITE && ptype[id] === PAWN && !this.blk(id, target))
          return true;
      }
    } else {
      if (tf < 7 && target + 9 < 64) {
        const id = board[target + 9] as number;
        if (id >= 0 && pside[id] === BLACK && ptype[id] === PAWN && !this.blk(id, target))
          return true;
      }
      if (tf > 0 && target + 7 < 64) {
        const id = board[target + 7] as number;
        if (id >= 0 && pside[id] === BLACK && ptype[id] === PAWN && !this.blk(id, target))
          return true;
      }
    }
    for (const s of KNIGHT_TARGETS[target] as number[]) {
      const id = board[s] as number;
      if (id >= 0 && pside[id] === by && ptype[id] === KNIGHT && !this.blk(id, target)) return true;
    }
    for (const s of KING_TARGETS[target] as number[]) {
      const id = board[s] as number;
      if (id >= 0 && pside[id] === by && ptype[id] === KING && !this.blk(id, target)) return true;
    }
    const anyPass = this.rules.anyPass[by] === true;
    const pass = this.rules.passThrough;
    const rays = RAYS[target] as number[][];
    for (let d = 0; d < 8; d++) {
      const ray = rays[d] as number[];
      const diag = d >= 4;
      let allyBlocked = false;
      for (let i = 0; i < ray.length; i++) {
        const id = board[ray[i] as number] as number;
        if (id < 0) continue;
        if (pside[id] !== by) break;
        const t = ptype[id];
        const matches = t === QUEEN || (diag ? t === BISHOP : t === ROOK);
        if (matches && (!allyBlocked || pass[id] === 1) && !this.blk(id, target)) return true;
        if (!anyPass) break;
        allyBlocked = true;
      }
    }
    return false;
  }

  inCheck(side: number): boolean {
    const k = this.king[side] as number;
    if (k < 0) return false;
    const s = this.psq[k] as number;
    if (s < 0) return false;
    return this.attacked(s, side ^ 1);
  }

  private pushPawn(
    out: number[],
    from: number,
    to: number,
    flags: number,
    promoRank: number,
  ): void {
    if (to >> 3 === promoRank) {
      out.push(encodeMove(from, to, QUEEN, flags));
      out.push(encodeMove(from, to, ROOK, flags));
      out.push(encodeMove(from, to, BISHOP, flags));
      out.push(encodeMove(from, to, KNIGHT, flags));
    } else {
      out.push(encodeMove(from, to, 0, flags));
    }
  }

  /** Pseudo-legal moves for `side` (king safety not yet checked; castling fully checked). */
  pseudo(side: number, out: number[]): void {
    const board = this.board;
    const pside = this.pside;
    const pass = this.rules.passThrough;
    for (let id = 0; id < this.n; id++) {
      if (pside[id] !== side) continue;
      const from = this.psq[id] as number;
      if (from < 0) continue;
      const t = this.ptype[id];
      if (t === PAWN) {
        const dir = side === WHITE ? 8 : -8;
        const startRank = side === WHITE ? 1 : 6;
        const promoRank = side === WHITE ? 7 : 0;
        const to = from + dir;
        if (to < 0 || to >= 64) continue;
        const ahead = board[to] as number;
        if (ahead < 0) {
          if (!this.blk(id, to)) this.pushPawn(out, from, to, 0, promoRank);
        }
        if (from >> 3 === startRank) {
          const canPass = ahead < 0 || (pass[id] === 1 && pside[ahead] === side);
          const to2 = to + dir;
          if (canPass && (board[to2] as number) < 0 && !this.blk(id, to2)) {
            out.push(encodeMove(from, to2, 0, F_DOUBLE));
          }
        }
        const f = from & 7;
        for (const df of [-1, 1]) {
          if (f + df < 0 || f + df > 7) continue;
          const cs = to + df;
          const victim = board[cs] as number;
          if (victim >= 0) {
            if (pside[victim] !== side && this.capturable(victim) && !this.blk(id, cs)) {
              this.pushPawn(out, from, cs, F_CAPTURE, promoRank);
            }
          } else if (cs === this.ep) {
            const vs = cs - dir;
            const v = board[vs] as number;
            if (
              v >= 0 &&
              pside[v] !== side &&
              this.ptype[v] === PAWN &&
              !this.blk(id, cs) &&
              !this.blk(id, vs)
            ) {
              out.push(encodeMove(from, cs, 0, F_CAPTURE | F_EP));
            }
          }
        }
      } else if (t === KNIGHT || t === KING) {
        const targets = (t === KNIGHT ? KNIGHT_TARGETS[from] : KING_TARGETS[from]) as number[];
        for (let i = 0; i < targets.length; i++) {
          const to = targets[i] as number;
          const v = board[to] as number;
          if (v < 0) {
            if (!this.blk(id, to)) out.push(encodeMove(from, to));
          } else if (pside[v] !== side && this.capturable(v) && !this.blk(id, to)) {
            out.push(encodeMove(from, to, 0, F_CAPTURE));
          }
        }
        if (t === KING) this.castles(id, side, from, out);
      } else {
        const d0 = t === BISHOP ? 4 : 0;
        const d1 = t === ROOK ? 4 : 8;
        const rays = RAYS[from] as number[][];
        const canPass = pass[id] === 1;
        for (let d = d0; d < d1; d++) {
          const ray = rays[d] as number[];
          for (let i = 0; i < ray.length; i++) {
            const to = ray[i] as number;
            const v = board[to] as number;
            if (v < 0) {
              if (!this.blk(id, to)) out.push(encodeMove(from, to));
              continue;
            }
            if (pside[v] === side) {
              if (canPass) continue;
              break;
            }
            if (this.capturable(v) && !this.blk(id, to))
              out.push(encodeMove(from, to, 0, F_CAPTURE));
            break;
          }
        }
      }
    }
  }

  private castles(kid: number, side: number, from: number, out: number[]): void {
    const home = side === WHITE ? 4 : 60;
    if (from !== home) return;
    const kBit = side === WHITE ? CASTLE_WK : CASTLE_BK;
    const qBit = side === WHITE ? CASTLE_WQ : CASTLE_BQ;
    const rights = this.castling & (kBit | qBit);
    if (!rights) return;
    const board = this.board;
    const stalwart = this.rules.stalwart[side] === true;
    const opp = side ^ 1;
    const isOwnRook = (s: number) => {
      const r = board[s] as number;
      return r >= 0 && this.pside[r] === side && this.ptype[r] === ROOK;
    };
    if (rights & kBit && isOwnRook(home + 3) && board[home + 1]! < 0 && board[home + 2]! < 0) {
      const rook = board[home + 3] as number;
      if (!this.blk(kid, home + 2) && !this.blk(rook, home + 1)) {
        if (stalwart || (!this.attacked(home, opp) && !this.attacked(home + 1, opp))) {
          out.push(encodeMove(home, home + 2, 0, F_CASTLE));
        }
      }
    }
    if (
      rights & qBit &&
      isOwnRook(home - 4) &&
      board[home - 1]! < 0 &&
      board[home - 2]! < 0 &&
      board[home - 3]! < 0
    ) {
      const rook = board[home - 4] as number;
      if (!this.blk(kid, home - 2) && !this.blk(rook, home - 1)) {
        if (stalwart || (!this.attacked(home, opp) && !this.attacked(home - 1, opp))) {
          out.push(encodeMove(home, home - 2, 0, F_CASTLE));
        }
      }
    }
  }

  make(m: number): Undo {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const id = this.board[from] as number;
    const u: Undo = {
      m,
      id,
      captured: -1,
      capSq: -1,
      castling: this.castling,
      ep: this.ep,
      prevType: this.ptype[id] as number,
      rook: -1,
      rookFrom: -1,
      rookTo: -1,
    };
    if (m & F_EP) {
      const capSq = to + (this.pside[id] === WHITE ? -8 : 8);
      u.captured = this.board[capSq] as number;
      u.capSq = capSq;
      this.board[capSq] = -1;
      this.psq[u.captured] = -1;
    } else if (m & F_CAPTURE) {
      u.captured = this.board[to] as number;
      u.capSq = to;
      this.psq[u.captured] = -1;
    }
    this.board[from] = -1;
    this.board[to] = id;
    this.psq[id] = to;
    if (promo) this.ptype[id] = promo;
    if (m & F_CASTLE) {
      const kingSide = to > from;
      u.rookFrom = kingSide ? from + 3 : from - 4;
      u.rookTo = kingSide ? from + 1 : from - 1;
      u.rook = this.board[u.rookFrom] as number;
      this.board[u.rookFrom] = -1;
      this.board[u.rookTo] = u.rook;
      this.psq[u.rook] = u.rookTo;
    }
    this.castling &= ~((CASTLE_MASK[from] as number) | (CASTLE_MASK[to] as number));
    this.ep = m & F_DOUBLE && (this.board[(from + to) >> 1] as number) < 0 ? (from + to) >> 1 : -1;
    this.turn ^= 1;
    return u;
  }

  unmake(u: Undo): void {
    const m = u.m;
    const from = m & 63;
    const to = (m >> 6) & 63;
    this.turn ^= 1;
    this.castling = u.castling;
    this.ep = u.ep;
    if (u.rook >= 0) {
      this.board[u.rookTo] = -1;
      this.board[u.rookFrom] = u.rook;
      this.psq[u.rook] = u.rookFrom;
    }
    this.ptype[u.id] = u.prevType;
    this.board[to] = -1;
    this.board[from] = u.id;
    this.psq[u.id] = from;
    if (u.captured >= 0) {
      this.board[u.capSq] = u.captured;
      this.psq[u.captured] = u.capSq;
    }
  }

  /** Legal moves for `side` (R-RULES-001; Stalwart relaxes king safety, R-RULES-003). */
  legal(side: number, out: number[] = []): number[] {
    const pseudo: number[] = [];
    this.pseudo(side, pseudo);
    if (this.rules.stalwart[side]) {
      for (const m of pseudo) out.push(m);
      return out;
    }
    const saved = this.turn;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i] as number;
      const u = this.make(m);
      if (!this.inCheck(side)) out.push(m);
      this.unmake(u);
    }
    this.turn = saved;
    return out;
  }

  /** Would making `m` leave `side`'s king attacked? (used for Stalwart reveal and INV-03 checks) */
  leavesInCheck(m: number, side: number): boolean {
    const u = this.make(m);
    const r = this.inCheck(side);
    this.unmake(u);
    return r;
  }
}

export function perft(pos: Pos, depth: number): number {
  const moves = pos.legal(pos.turn);
  if (depth <= 1) return depth === 1 ? moves.length : 1;
  let total = 0;
  for (let i = 0; i < moves.length; i++) {
    const u = pos.make(moves[i] as number);
    total += perft(pos, depth - 1);
    pos.unmake(u);
  }
  return total;
}

export function divide(pos: Pos, depth: number): Map<string, number> {
  const result = new Map<string, number>();
  for (const m of pos.legal(pos.turn)) {
    const u = pos.make(m);
    const mv = decodeMove(m);
    const key = `${mv.from}-${mv.to}${mv.promotion ?? ''}`;
    result.set(key, perft(pos, depth - 1));
    pos.unmake(u);
  }
  return result;
}

export const sideIndex = (s: Side): number => sideCode(s);
export { fileOf, rankOf };
