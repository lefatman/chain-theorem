/**
 * Module SDK (R-DATA-005, spec 13.5): content modules are built only from these helpers and the
 * effect primitives of spec 5.2. `rules` never imports content; content imports this.
 */
import type { Category, PieceType } from '../types.ts';
import type {
  AbilityDef,
  BonusSpec,
  EffectCondition,
  EffectSpec,
  ItemDef,
  PieceFilter,
  RevealSpec,
  SquareFilter,
  SquareSpec,
  TargetSpec,
  TraitDef,
} from './types.ts';

export type * from './types.ts';

/** Identity helpers that type-check a module definition. */
export function defineAbility<const T extends AbilityDef>(def: T): T {
  return def;
}
export function defineItem<const T extends ItemDef>(def: T): T {
  return def;
}
export function defineTrait<const T extends TraitDef>(def: T): T {
  return def;
}

/** Target selectors (5.2): SELF, CAPTOR, VICTIM, CHOSEN(filter). */
export const target = {
  self: (): TargetSpec => ({ t: 'self' }),
  captor: (): TargetSpec => ({ t: 'captor' }),
  victim: (): TargetSpec => ({ t: 'victim' }),
  /** The ability's owner chooses among pieces matching the filter. */
  chosen: (filter: PieceFilter): TargetSpec => ({ t: 'chosen', filter }),
  mostRecentCaptured: (side: 'friendly' | 'enemy', type: PieceType): TargetSpec => ({
    t: 'mostRecentCaptured',
    side,
    type,
  }),
};

export const square = {
  /** The square the piece moved from in this capture. */
  origin: (): SquareSpec => ({ s: 'origin' }),
  /** The piece's starting square. */
  start: (): SquareSpec => ({ s: 'start' }),
  /** The ability's owner chooses an empty square matching the filter. */
  chosen: (filter: Omit<SquareFilter, 'empty'>): SquareSpec => ({
    s: 'chosen',
    filter: { empty: true, ...filter },
  }),
};

const selfLike = (t: TargetSpec): 'captor' | 'victim' | 'self' => {
  if (t.t === 'captor' || t.t === 'victim' || t.t === 'self') return t.t;
  throw new Error('revealIfSurvives needs self, captor or victim');
};

/** Effect primitives (5.2) plus two structural helpers (`when`, `atChainEnd`). */
export const fx = {
  /** EFFECT_CAPTURE(target) */
  effectCapture: (t: TargetSpec): EffectSpec => ({ op: 'effectCapture', target: t }),
  /** NEGATE(filter): cancel the chosen piece's triggers of these categories for this capture. */
  negate: (of: 'victim' | 'captor', categories: Category[]): EffectSpec => ({
    op: 'negate',
    of,
    categories,
  }),
  /** PROTECT(target, filter): the next `count` effect captures targeting it this action fizzle. */
  protect: (t: TargetSpec, count: number | 'all' = 1): EffectSpec => ({
    op: 'protect',
    target: t,
    against: 'effectCapture',
    count,
  }),
  /** MOVE(piece, square) */
  move: (piece: TargetSpec, to: SquareSpec): EffectSpec => ({ op: 'move', piece, to }),
  /** REVIVE(pieceId, square) */
  revive: (piece: TargetSpec, to: SquareSpec): EffectSpec => ({ op: 'revive', piece, to }),
  /** BONUS_ACTION(constraints) — at most one per ability, never inside a bonus action (INV-01). */
  bonusAction: (bonus: BonusSpec): EffectSpec => ({ op: 'bonusAction', bonus }),
  /** REVEAL(target) */
  reveal: (reveal: RevealSpec): EffectSpec => ({ op: 'reveal', reveal }),
  /** MODIFY_RULE(ruleId, params): passive marker; the behaviour lives in the module's hooks. */
  modifyRule: (rule: string, params?: Record<string, string | number | boolean>): EffectSpec =>
    params ? { op: 'modifyRule', rule, params } : { op: 'modifyRule', rule },
  when: (cond: EffectCondition, then: EffectSpec[]): EffectSpec => ({ op: 'when', cond, then }),
  atChainEnd: (effects: EffectSpec[]): EffectSpec => ({ op: 'atChainEnd', effects }),
  /** If the piece is still on the board, reveal all abilities of its piece type. */
  revealIfSurvives: (t: TargetSpec): EffectSpec => {
    const of = selfLike(t);
    return {
      op: 'when',
      cond: { survives: of },
      then: [{ op: 'reveal', reveal: { what: 'typeSet', of } }],
    };
  },
};

export const cond = {
  survives: (of: 'captor' | 'victim' | 'self'): EffectCondition => ({ survives: of }),
  noLegalCapturerOfCaptor: (): EffectCondition => ({ noLegalCapturerOf: 'captor' }),
  typeIs: (of: 'captor' | 'victim' | 'self', types: PieceType[]): EffectCondition => ({
    typeIs: { of, types },
  }),
  not: (c: EffectCondition): EffectCondition => ({ not: c }),
  all: (...cs: EffectCondition[]): EffectCondition => ({ all: cs }),
};

export const NON_KING: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
