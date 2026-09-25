/**
 * Flow — Tide trait (R-ELEM-006, D-40, COMMITTED). Tide pieces treat their own side's pieces as
 * empty squares while sliding, double-pushing or attacking through them, but cannot end a move on
 * one. Knights and single king steps are unaffected; castling is unchanged.
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: 'flow',
  name: 'Flow',
  element: 'tide',
  version: 1,
  hooks: {
    moveFilter: {
      passThrough: (_ctx, piece) => piece.element === 'tide',
    },
  },
  text: {
    short: 'Moves and attacks through its own side.',
    rules:
      "Tide pieces may slide (and make a pawn's two-square first move) through their own side's pieces, and attack through them, but cannot stop on one. Castling is unchanged.",
  },
  status: 'COMMITTED',
});
