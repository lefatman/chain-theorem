/**
 * The lesson puzzle board (M5, spec 10.3, R-WORLD-003): a DOM mini chessboard built from the
 * puzzle's FEN. The player clicks a piece of the side to move, then a target square; the zone
 * checks the answer (R-SEC-003). Legal-move highlighting and "this square is attacked" hints use
 * the rules engine when the position is a full one (both kings); lesson positions without kings
 * still show and play, just without hints. Pure logic; the component is ui/world/MiniBoard.tsx.
 */
import { engine } from '@chain-theorem/content';
import {
  moveToUci,
  squareName,
  type Loadout,
  type PieceType,
  type Side,
} from '@chain-theorem/rules';

export interface MiniPiece {
  side: Side;
  type: PieceType;
}

export interface MiniPosition {
  /** a1 = 0 … h8 = 63. */
  board: (MiniPiece | null)[];
  turn: Side;
}

const TYPES: Record<string, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Read a FEN leniently (any number of kings); null when the placement is malformed. */
export function readFen(fen: string): MiniPosition | null {
  const [placement = '', turn = 'w'] = fen.trim().split(/\s+/);
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;
  const board: (MiniPiece | null)[] = new Array<MiniPiece | null>(64).fill(null);
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of ranks[i] ?? '') {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const type = TYPES[ch.toLowerCase()];
      if (!type || file > 7) return null;
      board[rank * 8 + file] = { side: ch === ch.toUpperCase() ? 'white' : 'black', type };
      file++;
    }
    if (file !== 8) return null;
  }
  return { board, turn: turn === 'b' ? 'black' : 'white' };
}

export interface PickState {
  selected: number | null;
}

export type PickResult =
  | { kind: 'select'; selected: number | null }
  | { kind: 'move'; uci: string }
  | { kind: 'promote'; from: number; to: number };

/**
 * One click on the board: select a piece of the side to move, reselect another, deselect it, or
 * answer with a move to any other square. A pawn reaching the last rank asks for a promotion.
 * Legality is the zone's call: a wrong move gets the lesson's hint.
 */
export function pick(pos: MiniPosition, state: PickState, square: number): PickResult {
  const piece = pos.board[square] ?? null;
  const own = piece !== null && piece.side === pos.turn;
  const sel = state.selected;
  if (sel === null) return { kind: 'select', selected: own ? square : null };
  if (square === sel) return { kind: 'select', selected: null };
  if (own) return { kind: 'select', selected: square };
  const mover = pos.board[sel];
  if (!mover) return { kind: 'select', selected: null };
  const lastRank = pos.turn === 'white' ? 7 : 0;
  if (mover.type === 'pawn' && square >> 3 === lastRank)
    return { kind: 'promote', from: sel, to: square };
  return { kind: 'move', uci: `${squareName(sel)}${squareName(square)}` };
}

export const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'] as const;

export function promotionUci(from: number, to: number, piece: (typeof PROMOTIONS)[number]): string {
  return moveToUci({ from, to, promotion: piece });
}

/** Board squares in display order (rows top to bottom), seen from `side`. */
export function displayOrder(side: Side): number[] {
  const out: number[] = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      out.push(side === 'white' ? (7 - row) * 8 + col : row * 8 + (7 - col));
  return out;
}

export interface MiniHints {
  /** Legal destinations per origin square. */
  targets: Map<number, number[]>;
  /** Squares of the mover's pieces that the other side attacks now. */
  attacked: number[];
}

const PLAIN: Loadout = { elements: ['neutral'], items: [], sets: [[]] };
const hintCache = new Map<string, MiniHints | null>();

/** Engine hints for a full position; null when the engine cannot play it (lesson sketches). */
export function hintsFor(fen: string): MiniHints | null {
  if (hintCache.has(fen)) return hintCache.get(fen) ?? null;
  let out: MiniHints | null;
  try {
    const { state } = engine.newBattle({
      format: 'full',
      white: { level: 1, loadout: PLAIN },
      black: { level: 1, loadout: PLAIN },
      fen,
    });
    const targets = new Map<number, number[]>();
    for (const m of engine.legalMoves(state, state.turn)) {
      const list = targets.get(m.from) ?? [];
      if (!list.includes(m.to)) list.push(m.to);
      targets.set(m.from, list);
    }
    const pos = engine.position(state);
    const them = state.turn === 'white' ? 1 : 0;
    const attacked = state.pieces
      .filter((p) => p.side === state.turn && p.square >= 0 && pos.attacked(p.square, them))
      .map((p) => p.square);
    out = { targets, attacked };
  } catch {
    out = null;
  }
  hintCache.set(fen, out);
  return out;
}
