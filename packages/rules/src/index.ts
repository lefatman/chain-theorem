/**
 * @chain-theorem/rules — pure, deterministic rules engine (R-DATA-002). Zero runtime dependencies.
 */
export * from './types.ts';
export {
  START_FEN,
  squareName,
  parseSquare,
  moveToUci,
  uciToMove,
  relOrder,
  opposite,
  elementFor,
  parseFen,
  toFen,
} from './board.ts';
export { createEngine, cloneState, type Engine } from './engine/index.ts';
export type { PublicState, PublicPiece, PublicArmy, PublicEvent } from './engine/project.ts';
export type { Preview, Unknown } from './engine/preview.ts';
export { applyWithDefaults } from './engine/preview.ts';
export type { Deductions } from './engine/deduce.ts';
export { beats, foilOf } from './engine/elements.ts';
export { expandSets, loadoutShape } from './engine/loadout.ts';
export { eligibleFor } from './engine/action.ts';
export {
  Pos,
  perft,
  divide,
  decodeMove,
  encodeMove,
  F_CAPTURE,
  F_EP,
  F_CASTLE,
  F_DOUBLE,
  mFrom,
  mTo,
  mPromo,
  type MoveRules,
} from './movegen.ts';
export { canonicalJson, fnv1a64 } from './hash.ts';
export type * from './sdk/types.ts';
