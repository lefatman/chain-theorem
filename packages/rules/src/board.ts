/**
 * Square helpers, piece-type codes, FEN parsing/serialization and the standard start position
 * (R-RULES-001).
 */
import {
  type ArmyState,
  type ElementId,
  type GameState,
  type PieceState,
  type PieceType,
  type PromotionType,
  type Side,
  type Square,
  PIECE_TYPES,
  RulesError,
} from './types.ts';

export const PAWN = 0;
export const KNIGHT = 1;
export const BISHOP = 2;
export const ROOK = 3;
export const QUEEN = 4;
export const KING = 5;

export const WHITE = 0;
export const BLACK = 1;

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const typeCode = (t: PieceType): number => PIECE_TYPES.indexOf(t);
export const typeOf = (code: number): PieceType => PIECE_TYPES[code] as PieceType;
export const sideCode = (s: Side): number => (s === 'white' ? WHITE : BLACK);
export const sideOf = (code: number): Side => (code === WHITE ? 'white' : 'black');
export const opposite = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export const fileOf = (sq: Square): number => sq & 7;
export const rankOf = (sq: Square): number => sq >> 3;
export const sq = (file: number, rank: number): Square => rank * 8 + file;

const FILES = 'abcdefgh';
export function squareName(s: Square): string {
  return `${FILES[fileOf(s)]}${rankOf(s) + 1}`;
}
export function parseSquare(name: string): Square {
  const f = FILES.indexOf(name[0] ?? '');
  const r = Number(name[1]) - 1;
  if (name.length !== 2 || f < 0 || !(r >= 0 && r < 8)) {
    throw new RulesError('bad_fen', `bad square ${name}`);
  }
  return sq(f, r);
}

/** Square order a1..h8 seen from `side` (5.4): white a1 first, black a8 first. */
export function relOrder(side: Side, s: Square): number {
  return side === 'white' ? s : (7 - rankOf(s)) * 8 + fileOf(s);
}

/** The owner's back rank (rank 1 for white, rank 8 for black). */
export function backRank(side: Side): number {
  return side === 'white' ? 0 : 7;
}

const PROMO_LETTERS: Record<PromotionType, string> = {
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
};
const LETTER_PROMO: Record<string, PromotionType> = {
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
};

export function moveToUci(m: { from: Square; to: Square; promotion?: PromotionType }): string {
  return `${squareName(m.from)}${squareName(m.to)}${m.promotion ? PROMO_LETTERS[m.promotion] : ''}`;
}

export function uciToMove(uci: string): { from: Square; to: Square; promotion?: PromotionType } {
  if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(uci))
    throw new RulesError('illegal_move', `bad UCI ${uci}`);
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const p = uci[4];
  return p ? { from, to, promotion: LETTER_PROMO[p] as PromotionType } : { from, to };
}

const FEN_LETTERS = 'pnbrqk';

export interface ParsedFen {
  placement: { square: Square; side: Side; type: PieceType }[];
  turn: Side;
  castling: number;
  ep: Square;
  halfmove: number;
  fullmove: number;
}

export function parseFen(fen: string): ParsedFen {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new RulesError('bad_fen', `FEN needs at least 4 fields: ${fen}`);
  const [placementStr, turnStr, castleStr, epStr, hmStr, fmStr] = parts as [
    string,
    string,
    string,
    string,
    string | undefined,
    string | undefined,
  ];
  const rows = placementStr.split('/');
  if (rows.length !== 8) throw new RulesError('bad_fen', `FEN needs 8 ranks: ${fen}`);
  const placement: ParsedFen['placement'] = [];
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const code = FEN_LETTERS.indexOf(ch.toLowerCase());
      if (code < 0 || file > 7) throw new RulesError('bad_fen', `bad FEN rank ${row}`);
      placement.push({
        square: sq(file, rank),
        side: ch === ch.toUpperCase() ? 'white' : 'black',
        type: typeOf(code),
      });
      file++;
    }
    if (file !== 8) throw new RulesError('bad_fen', `FEN rank ${row} does not have 8 files`);
  });
  if (turnStr !== 'w' && turnStr !== 'b')
    throw new RulesError('bad_fen', `bad side to move ${turnStr}`);
  let castling = 0;
  if (castleStr !== '-') {
    for (const ch of castleStr) {
      const bit = { K: CASTLE_WK, Q: CASTLE_WQ, k: CASTLE_BK, q: CASTLE_BQ }[ch];
      if (bit === undefined) throw new RulesError('bad_fen', `bad castling field ${castleStr}`);
      castling |= bit;
    }
  }
  const ep = epStr === '-' ? -1 : parseSquare(epStr);
  const halfmove = hmStr === undefined ? 0 : Number(hmStr);
  const fullmove = fmStr === undefined ? 1 : Number(fmStr);
  if (!Number.isInteger(halfmove) || !Number.isInteger(fullmove)) {
    throw new RulesError('bad_fen', `bad move counters in ${fen}`);
  }
  for (const side of ['white', 'black'] as const) {
    const kings = placement.filter((p) => p.side === side && p.type === 'king').length;
    if (kings !== 1) throw new RulesError('bad_fen', `${side} must have exactly one king`);
  }
  if (placement.length > 32) throw new RulesError('bad_fen', 'at most 32 pieces');
  return { placement, turn: turnStr === 'w' ? 'white' : 'black', castling, ep, halfmove, fullmove };
}

/** Element of a piece under the army's loadout: group A (pawn/knight/bishop) or group B (6.4). */
export function elementFor(loadoutElements: readonly ElementId[], type: PieceType): ElementId {
  const a = loadoutElements[0] ?? 'neutral';
  const b = loadoutElements[1] ?? a;
  return type === 'rook' || type === 'queen' || type === 'king' ? b : a;
}

/**
 * Build the board and pieces from a FEN. Piece ids are assigned in square order a1..h8, so the
 * standard start position gives white ids 0..15 and black ids 16..31.
 */
export function piecesFromFen(
  parsed: ParsedFen,
  elements: Record<Side, readonly ElementId[]>,
): { board: number[]; pieces: PieceState[] } {
  const board = new Array<number>(64).fill(-1);
  const sorted = [...parsed.placement].sort((a, b) => a.square - b.square);
  const pieces: PieceState[] = sorted.map((p, id) => {
    board[p.square] = id;
    return {
      id,
      side: p.side,
      type: p.type,
      element: elementFor(elements[p.side], p.type),
      square: p.square,
      start: p.square,
      capturedSeq: -1,
    };
  });
  return { board, pieces };
}

export function toFen(
  state: Pick<GameState, 'board' | 'pieces' | 'turn' | 'castling' | 'ep' | 'halfmove' | 'fullmove'>,
): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const id = state.board[sq(file, rank)] ?? -1;
      if (id < 0) {
        empty++;
        continue;
      }
      if (empty) {
        row += String(empty);
        empty = 0;
      }
      const p = state.pieces[id] as PieceState;
      const letter = FEN_LETTERS[typeCode(p.type)] as string;
      row += p.side === 'white' ? letter.toUpperCase() : letter;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  let castle = '';
  if (state.castling & CASTLE_WK) castle += 'K';
  if (state.castling & CASTLE_WQ) castle += 'Q';
  if (state.castling & CASTLE_BK) castle += 'k';
  if (state.castling & CASTLE_BQ) castle += 'q';
  return [
    rows.join('/'),
    state.turn === 'white' ? 'w' : 'b',
    castle || '-',
    state.ep >= 0 ? squareName(state.ep) : '-',
    String(state.halfmove),
    String(state.fullmove),
  ].join(' ');
}

/** Castling rights are dropped when a king or rook leaves (or is captured on) its home square. */
export function castlingMaskFor(square: Square): number {
  switch (square) {
    case 4:
      return CASTLE_WK | CASTLE_WQ;
    case 7:
      return CASTLE_WK;
    case 0:
      return CASTLE_WQ;
    case 60:
      return CASTLE_BK | CASTLE_BQ;
    case 63:
      return CASTLE_BK;
    case 56:
      return CASTLE_BQ;
    default:
      return 0;
  }
}

/** Castling rights that are consistent with the pieces actually on their home squares. */
export function sanitizeCastling(
  castling: number,
  pieceAt: (s: Square) => { side: Side; type: PieceType } | null,
): number {
  const is = (s: Square, side: Side, type: PieceType) => {
    const p = pieceAt(s);
    return p !== null && p.side === side && p.type === type;
  };
  let c = castling;
  if (!is(4, 'white', 'king')) c &= ~(CASTLE_WK | CASTLE_WQ);
  if (!is(7, 'white', 'rook')) c &= ~CASTLE_WK;
  if (!is(0, 'white', 'rook')) c &= ~CASTLE_WQ;
  if (!is(60, 'black', 'king')) c &= ~(CASTLE_BK | CASTLE_BQ);
  if (!is(63, 'black', 'rook')) c &= ~CASTLE_BK;
  if (!is(56, 'black', 'rook')) c &= ~CASTLE_BQ;
  return c;
}

export function emptyArmy(level = 1): ArmyState {
  const sets = Object.fromEntries(PIECE_TYPES.map((t) => [t, [] as string[]])) as Record<
    PieceType,
    string[]
  >;
  return {
    level,
    loadout: { elements: ['neutral'], items: [], sets: [[]] },
    sets,
    consumedSlots: 0,
  };
}
