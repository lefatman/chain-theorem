/**
 * State hashing for threefold repetition (R-RULES-005, 4.5, DD-33, DD-34).
 * Board: Zobrist keys over (piece id, square), (piece id, type) and (piece id, element), plus side to
 * move, castling rights and the en passant file (only when a pawn could capture en passant).
 * Everything else that defines "the full engine state" (reveal logs, usage counters, hashed slices)
 * is folded in with a 64-bit FNV-1a hash of its canonical JSON.
 */
import { ELEMENTS, PIECE_TYPES, type GameState } from './types.ts';

const MAX_PIECES = 32;
const TYPE_INDEX = new Map(PIECE_TYPES.map((t, i) => [t, i]));
const ELEMENT_INDEX = new Map([...ELEMENTS, 'neutral' as const].map((e, i) => [e, i]));

// Zobrist keys come from xoshiro128** with a fixed seed, so every build hashes identically (DD-34).
let s0 = 0x9e3779b9;
let s1 = 0x243f6a88;
let s2 = 0xb7e15162;
let s3 = 0x8aed2a6b;
function next32(): number {
  // xoshiro128** by Blackman and Vigna.
  const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  s2 ^= s0;
  s3 ^= s1;
  s1 ^= s2;
  s0 ^= s3;
  s2 ^= t;
  s3 = rotl(s3, 11);
  return result;
}
function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

function table(n: number): Uint32Array {
  const t = new Uint32Array(n * 2);
  for (let i = 0; i < t.length; i++) t[i] = next32();
  return t;
}

const SQ_KEYS = table(MAX_PIECES * 64);
const TYPE_KEYS = table(MAX_PIECES * 6);
const ELEM_KEYS = table(MAX_PIECES * 7);
const SIDE_KEY = table(1);
const CASTLE_KEYS = table(16);
const EP_KEYS = table(8);

/** Canonical JSON: object keys sorted recursively, so equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** 64-bit FNV-1a over a string, returned as two uint32 halves. */
export function fnv1a64(text: string): [number, number] {
  // 64-bit arithmetic with 16-bit limbs (no BigInt, no dependencies).
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h0 ^= c & 0xff;
    if (c > 0xff) h1 ^= c >> 8;
    // multiply by FNV prime 0x100000001b3 = 2^40 + 0x1b3
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3;
    const t2 = h2 * 0x1b3;
    const t3 = h3 * 0x1b3;
    // + (h << 40): limb shift by 2 limbs (32 bits) plus 8 bits
    const u2 = t2 + (h0 << 8);
    const u3 = t3 + (h1 << 8);
    h0 = t0 & 0xffff;
    const c1 = t1 + (t0 >>> 16);
    h1 = c1 & 0xffff;
    const c2 = u2 + (c1 >>> 16);
    h2 = c2 & 0xffff;
    h3 = (u3 + (c2 >>> 16)) & 0xffff;
  }
  return [((h3 << 16) | h2) >>> 0, ((h1 << 16) | h0) >>> 0];
}

function hex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** Zobrist hash of the board part of the state as two uint32 halves. */
export function boardHash(
  state: Pick<GameState, 'pieces' | 'turn' | 'castling' | 'ep' | 'board'>,
): [number, number] {
  let hi = 0;
  let lo = 0;
  for (const p of state.pieces) {
    if (p.square < 0) continue;
    const id = p.id;
    const sqk = (id * 64 + p.square) * 2;
    const tk = (id * 6 + (TYPE_INDEX.get(p.type) ?? 0)) * 2;
    const ek = (id * 7 + (ELEMENT_INDEX.get(p.element) ?? 6)) * 2;
    hi ^= (SQ_KEYS[sqk] as number) ^ (TYPE_KEYS[tk] as number) ^ (ELEM_KEYS[ek] as number);
    lo ^=
      (SQ_KEYS[sqk + 1] as number) ^ (TYPE_KEYS[tk + 1] as number) ^ (ELEM_KEYS[ek + 1] as number);
  }
  if (state.turn === 'black') {
    hi ^= SIDE_KEY[0] as number;
    lo ^= SIDE_KEY[1] as number;
  }
  hi ^= CASTLE_KEYS[state.castling * 2] as number;
  lo ^= CASTLE_KEYS[state.castling * 2 + 1] as number;
  if (state.ep >= 0 && epCapturable(state)) {
    const f = state.ep & 7;
    hi ^= EP_KEYS[f * 2] as number;
    lo ^= EP_KEYS[f * 2 + 1] as number;
  }
  return [hi >>> 0, lo >>> 0];
}

/** Only count the en passant square when a pawn of the side to move stands ready to use it. */
function epCapturable(state: Pick<GameState, 'pieces' | 'turn' | 'ep' | 'board'>): boolean {
  const ep = state.ep;
  const f = ep & 7;
  const fromRank = state.turn === 'white' ? 4 : 3;
  for (const df of [-1, 1]) {
    if (f + df < 0 || f + df > 7) continue;
    const s = fromRank * 8 + f + df;
    const id = state.board[s] ?? -1;
    if (id < 0) continue;
    const p = state.pieces[id];
    if (p && p.type === 'pawn' && p.side === state.turn) return true;
  }
  return false;
}

/**
 * Hash of the full engine state used for repetition (4.5): board, side to move, castling and en
 * passant rights, revealed info, ability usage counters and hashed state slices.
 */
export function stateHashOf(state: GameState, hashedSlices: readonly string[]): string {
  const [bh, bl] = boardHash(state);
  const slices: Record<string, unknown> = {};
  for (const id of hashedSlices) slices[id] = state.slices[id];
  const [xh, xl] = fnv1a64(canonicalJson({ r: state.reveals, u: state.usage, s: slices }));
  return hex(bh ^ xh) + hex(bl ^ xl);
}
