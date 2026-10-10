/**
 * Flow — Tide trait (R-ELEM-006, D-40; identity COMMITTED, number PLAYTEST: plan item B4, DD-112).
 * Tide pieces treat their own side's pieces as empty squares while sliding, double-pushing or
 * attacking through them, up to `CAPS.TRAITS.FLOW_PASS_LIMIT` of them in one move (ships as 1; 0
 * means no limit, the launch rule), and cannot end a move on one. Knights and single king steps are
 * unaffected; castling is unchanged.
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: 'flow',
  name: 'Flow',
  element: 'tide',
  version: 2,
  hooks: {
    moveFilter: {
      // `true` is no limit; a number is the most allies passed in one move (sdk `passThrough`).
      passThrough: (ctx, piece) =>
        piece.element === 'tide'
          ? ctx.caps.TRAITS.FLOW_PASS_LIMIT === 0
            ? true
            : ctx.caps.TRAITS.FLOW_PASS_LIMIT
          : false,
    },
  },
  text: {
    short: 'Moves and attacks through one of its own pieces.',
    rules:
      "Tide pieces may slide (and make a pawn's two-square first move) through one of their own side's pieces per move, and attack through one, but cannot stop on one. Castling is unchanged.",
  },
  status: 'COMMITTED',
});
