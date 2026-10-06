/**
 * Core types of the rules engine (R-DATA-002). Everything here is plain, JSON-serializable data so a
 * GameState can be stored in a Durable Object and replayed anywhere (INV-04).
 */

export type Side = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
/**
 * Piece rank for abilities that compare pieces (5.1, DD-97): pawn 1 < knight 2 = bishop 2 < rook 3
 * < queen 4 < king 5. "Equal or higher" includes the knight/bishop tie.
 */
export const PIECE_RANK: Readonly<Record<PieceType, number>> = {
  pawn: 1,
  knight: 2,
  bishop: 2,
  rook: 3,
  queen: 4,
  king: 5,
};
export type RankCmp = '<' | '<=' | '==' | '>=' | '>';
export function pieceRank(t: PieceType): number {
  return PIECE_RANK[t];
}
export function rankCompare(a: PieceType, cmp: RankCmp, b: PieceType): boolean {
  const x = PIECE_RANK[a];
  const y = PIECE_RANK[b];
  switch (cmp) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '==':
      return x === y;
    case '>=':
      return x >= y;
    case '>':
      return x > y;
  }
}
export type PromotionType = 'knight' | 'bishop' | 'rook' | 'queen';
export type ElementId = 'ember' | 'tide' | 'grove' | 'storm' | 'stone' | 'frost' | 'neutral';
export type Category = 'CAPTURING' | 'CAPTURES' | 'CAPTURED' | 'PASSIVE';
export type FormatId = 'first_blood' | 'vanguard' | 'full';
/** 0..63, a1 = 0, b1 = 1, ..., h8 = 63. */
export type Square = number;
/** Stable piece identity 0..31, assigned at battle start in square order a1..h8. */
export type PieceId = number;

export const SIDES: readonly Side[] = ['white', 'black'];
export const PIECE_TYPES: readonly PieceType[] = [
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];
export const ELEMENTS: readonly ElementId[] = ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'];

/** Compass directions on the board as drawn (north = towards rank 8), clockwise (DD-99). */
export type Compass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export const COMPASS: readonly Compass[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_STEP: Readonly<Record<Compass, [number, number]>> = {
  N: [0, 1],
  NE: [1, 1],
  E: [1, 0],
  SE: [1, -1],
  S: [0, -1],
  SW: [-1, -1],
  W: [-1, 0],
  NW: [-1, 1],
};
/** The adjacent square in that direction, or -1 off the board. */
export function stepTowards(sq: Square, dir: Compass): Square {
  const [df, dr] = COMPASS_STEP[dir];
  const f = (sq & 7) + df;
  const r = (sq >> 3) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}
/**
 * The direction in which `other` stands as seen from `sq`: along a shared rank, file or diagonal,
 * or along the long leg of a knight's offset (DD-99); null for any other pair.
 */
export function compassFrom(sq: Square, other: Square): Compass | null {
  const df = (other & 7) - (sq & 7);
  const dr = (other >> 3) - (sq >> 3);
  if (df === 0 && dr === 0) return null;
  if (df === 0) return dr > 0 ? 'N' : 'S';
  if (dr === 0) return df > 0 ? 'E' : 'W';
  if (Math.abs(df) === Math.abs(dr)) return dr > 0 ? (df > 0 ? 'NE' : 'NW') : df > 0 ? 'SE' : 'SW';
  if (Math.abs(df) + Math.abs(dr) === 3) {
    // Knight offset: the two-square leg names the direction.
    if (Math.abs(dr) === 2) return dr > 0 ? 'N' : 'S';
    return df > 0 ? 'E' : 'W';
  }
  return null;
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: PromotionType;
}

export interface Loadout {
  /** [A] or [A, B]; with Blended Family A goes to pawns/knights/bishops, B to rooks/queen/king (6.4). */
  elements: ElementId[];
  items: string[];
  itemParams?: Record<string, { element?: ElementId }>;
  /** One army-wide set, or six sets in PIECE_TYPES order with Multitasker's Schedule (7.3). */
  sets: string[][];
}

export interface PieceState {
  id: PieceId;
  side: Side;
  type: PieceType;
  element: ElementId;
  /** -1 while captured (off the board). */
  square: Square;
  /** Starting square of this piece identity (revive target). */
  start: Square;
  /** captureSeq value when this piece was last captured; -1 if never. */
  capturedSeq: number;
}

export interface ArmyState {
  level: number;
  loadout: Loadout;
  sets: Record<PieceType, string[]>;
  consumedSlots: number;
}

export interface RevealLog {
  abilities: Partial<Record<PieceType, string[]>>;
  complete: PieceType[];
  items: string[];
  allItems: boolean;
  veiled: PieceType[];
}

export type ResultReason =
  | 'checkmate'
  | 'stalwart_captured'
  | 'objective'
  | 'resign'
  | 'timeout'
  | 'abandon'
  | 'stalemate'
  | 'repetition'
  | 'fifty_move'
  | 'agreement'
  | 'double_royal_defeat';

export interface BattleResult {
  winner: Side | null;
  reason: ResultReason;
}

export type ChoiceOption =
  | { kind: 'decline' }
  | { kind: 'piece'; piece: PieceId; square: Square }
  | { kind: 'square'; square: Square }
  | { kind: 'move'; from: Square; to: Square; promotion?: PromotionType };

export interface ChoiceRequest {
  promptId: string;
  chooser: Side;
  source: { ability: string; piece: PieceId; side: Side };
  kind: 'target' | 'square' | 'bonusMove';
  /**
   * Target prompts: what the effect does to the chosen piece. Square prompts with `facing`: the
   * chosen square names the direction the subject will face (Block Path, DD-99).
   */
  purpose?: 'capture' | 'move' | 'revive' | 'protect' | 'facing';
  /** Square prompts: the piece that will be moved, revived or turned. */
  subject?: PieceId;
  options: ChoiceOption[];
  /** Index used when the chooser does not answer in time (5.4, DD-18). */
  defaultOption: number;
}

export interface PendingAction {
  pre: GameState;
  input: MoveInput;
  answers: ChoiceOption[];
  request: ChoiceRequest;
  /** Pre-supplied commit choices already consumed (5.3 step 1). */
  preUsed: number;
  emitted: number;
  queue: { piece: PieceId; ability: string }[];
}

/**
 * The position before an action, kept for Redo (REWIND, DD-100): everything a rewind restores.
 * Charges (`usage`), reveals and the event sequence are not part of it and survive a rewind.
 */
export interface RewindPoint {
  ply: number;
  turn: Side;
  board: number[];
  pieces: PieceState[];
  castling: number;
  ep: Square;
  halfmove: number;
  fullmove: number;
  slices: Record<string, unknown>;
  objective: Record<Side, number>;
  inCheck: Side | null;
  repetition: string[];
}

export interface GameState {
  schema: 1;
  contentVersion: string;
  format: FormatId;
  board: number[];
  pieces: PieceState[];
  turn: Side;
  /** Bitmask: white king side 1, white queen side 2, black king side 4, black queen side 8. */
  castling: number;
  ep: Square;
  halfmove: number;
  fullmove: number;
  ply: number;
  armies: Record<Side, ArmyState>;
  usage: Record<string, number>;
  slices: Record<string, unknown>;
  reveals: Record<Side, RevealLog>;
  objective: Record<Side, number>;
  captureSeq: number;
  repetition: string[];
  pending: PendingAction | null;
  result: BattleResult | null;
  inCheck: Side | null;
  eventSeq: number;
  /** Pre-action snapshots of the last two actions, kept only while a side carries a REWIND ability. */
  history?: RewindPoint[];
}

export type MoveInput = { kind: 'move'; side: Side; move: Move; choices?: ChoiceOption[] };

export type ActionInput =
  | MoveInput
  | { kind: 'choice'; side: Side; promptId: string; option: number }
  | { kind: 'resign'; side: Side }
  | { kind: 'timeout'; side: Side }
  | { kind: 'abandon'; side: Side }
  | { kind: 'agreeDraw' };

export type SourceRef =
  | { kind: 'ability'; id: string; piece: PieceId; side: Side }
  | { kind: 'item'; id: string; side: Side }
  | { kind: 'trait'; id: string; element: ElementId }
  | { kind: 'rule'; id: 'royal_immunity' | 'inv03' | 'silence' | 'depth' | 'bonus_in_bonus' }
  /** Projection only: the source is hidden from this viewer. */
  | { kind: 'hidden' };

export type FizzleReason =
  | 'no_body'
  | 'royal_immunity'
  | 'inv03'
  | 'protected'
  | 'bulwark'
  | 'burning'
  /** A Stalwart piece is removed only by a move capture or a venom effect (DD-102). */
  | 'stalwart'
  | 'occupied'
  | 'no_target'
  | 'depth_limit'
  | 'bonus_in_bonus'
  | 'already_on_board'
  | 'condition';

export type RevealInfo =
  | { kind: 'ability'; pieceType: PieceType; ability: string }
  | { kind: 'set'; pieceType: PieceType; abilities: string[] }
  | { kind: 'item'; item: string }
  | { kind: 'items'; items: string[] }
  | { kind: 'veiled'; pieceType: PieceType }
  | { kind: 'elements'; elements: ElementId[] };

export type RevealCause = 'activated' | 'silenced' | 'negated' | 'fizzled' | 'effect' | 'observed';

interface EventBase {
  /** Battle-wide sequence index. */
  i: number;
  /** 0 = the committed action; 1+ = nested bonus-action pipeline. */
  depth: number;
}

export type BattleEvent = EventBase &
  (
    | { k: 'BattleStarted'; format: FormatId; contentVersion: string }
    | { k: 'ActionStarted'; side: Side; ply: number; move: Move }
    | {
        k: 'MoveMade';
        side: Side;
        piece: PieceId;
        pieceType: PieceType;
        from: Square;
        to: Square;
        capture: boolean;
        enPassant?: boolean;
        castle?: 'K' | 'Q';
        promotion?: PromotionType;
        bonus: boolean;
      }
    | {
        k: 'Captured';
        victim: PieceId;
        victimSide: Side;
        victimType: PieceType;
        square: Square;
        by: 'move' | 'effect';
        captor: PieceId | null;
        source?: SourceRef;
      }
    | { k: 'Promoted'; piece: PieceId; side: Side; to: PromotionType; element: ElementId }
    | {
        k: 'AbilityTriggered';
        side: Side;
        piece: PieceId;
        /** The piece type whose set produced the trigger (R-INFO-002). */
        pieceType: PieceType;
        ability: string | null;
        /** Null in projections when the ability is hidden from the viewer (Veil, DD-28). */
        category: Category | null;
        attuned: boolean | null;
      }
    | {
        k: 'AbilitySilenced';
        side: Side;
        piece: PieceId;
        pieceType: PieceType;
        ability: string | null;
        category: Category | null;
        by: PieceId;
      }
    | {
        k: 'AbilityNegated';
        side: Side;
        piece: PieceId;
        pieceType: PieceType;
        ability: string | null;
        category: Category | null;
        source: SourceRef;
      }
    | {
        k: 'EffectFizzled';
        side: Side;
        piece: PieceId;
        pieceType: PieceType;
        ability: string | null;
        effect: string;
        reason: FizzleReason;
        target?: PieceId;
        source?: SourceRef;
      }
    | {
        k: 'ChargeSpent';
        side: Side;
        piece: PieceId;
        pieceType: PieceType;
        ability: string | null;
        remaining: number;
      }
    | { k: 'SquareIgnited'; square: Square; side: Side; turns: number }
    | { k: 'SquareExtinguished'; square: Square }
    /** A piece turned to face a direction (Block Path, DD-99). */
    | {
        k: 'FacingSet';
        piece: PieceId;
        side: Side;
        square: Square;
        facing: Compass;
        source: SourceRef;
      }
    /** The position returned to the start of ply `toPly`, undoing `plies` plies (Redo, DD-100). */
    | { k: 'Rewound'; side: Side; toPly: number; toTurn: Side; plies: number; source: SourceRef }
    | { k: 'Revealed'; side: Side; info: RevealInfo; cause: RevealCause; source?: SourceRef }
    | { k: 'PieceMoved'; piece: PieceId; side: Side; from: Square; to: Square; source: SourceRef }
    | { k: 'PieceRevived'; piece: PieceId; side: Side; square: Square; source: SourceRef }
    | { k: 'ChoiceMade'; side: Side; promptId: string; option: ChoiceOption }
    | { k: 'Check'; side: Side; square: Square }
    | { k: 'TurnPassed'; side: Side; ply: number }
    | { k: 'BattleEnded'; result: BattleResult }
  );

/** Distributive helper: an event without the index fields, as passed to `emit`. */
export type EventInput = BattleEvent extends infer E
  ? E extends BattleEvent
    ? Omit<E, 'i' | 'depth'> & { depth?: number }
    : never
  : never;

export type EventKind = BattleEvent['k'];

export type ApplyResult =
  | { kind: 'done'; state: GameState; events: BattleEvent[] }
  | { kind: 'needsChoice'; state: GameState; events: BattleEvent[]; request: ChoiceRequest };

export interface BattleSetup {
  format: FormatId;
  white: { level: number; loadout: Loadout };
  black: { level: number; loadout: Loadout };
  /** Custom starting position (tests, Scenario Lab). Standard start when omitted. */
  fen?: string;
  /**
   * Validate both loadouts with R-LOAD-004 (INVARIANT at battle start) and throw on any error. Every
   * real battle sets this (server, local play, simulator, fuzzer); tests and the Scenario Lab leave it
   * off so they can use sandbox loadouts (DD-23).
   */
  strict?: boolean;
}

export interface PlayerFacts {
  level: number;
  /** Owned item ids and ability card ids; omit to skip ownership checks (NPCs, sandbox). */
  ownedItems?: readonly string[];
  ownedAbilities?: readonly string[];
}

export type LoadoutErrorCode =
  | 'slots_exceeded'
  | 'item_level'
  | 'ability_level'
  | 'exclusive_group'
  | 'duplicate_item'
  | 'capacity_exceeded'
  | 'duplicate_ability'
  | 'set_count'
  | 'elements_count'
  | 'elements_same'
  | 'element_disabled'
  | 'not_owned'
  | 'retired'
  | 'unknown_item'
  | 'unknown_ability'
  | 'item_param'
  | 'bad_level'
  | 'excluded_category';

export interface LoadoutError {
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  code: LoadoutErrorCode;
  message: string;
  ref?: string;
}

export interface LoadoutValidation {
  ok: boolean;
  errors: LoadoutError[];
  consumedSlots: number;
  unlockedSlots: number;
  capacity: number;
}

export type RulesErrorCode =
  | 'illegal_move'
  | 'not_your_turn'
  | 'battle_over'
  | 'pending_choice'
  | 'no_pending_choice'
  | 'bad_choice'
  | 'bad_fen'
  | 'bad_setup'
  | 'internal';

export class RulesError extends Error {
  readonly code: RulesErrorCode;
  constructor(code: RulesErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'RulesError';
  }
}
