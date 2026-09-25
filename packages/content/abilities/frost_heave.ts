/**
 * Frost Heave (M7 7.3, PLAYTEST): Captured, Frost, all. Push the captor back to the square it moved
 * from, if empty. Attuned: the owner may instead place a non-pawn captor on any empty square
 * adjacent to that square; a pawn captor always goes straight back (so no pawn lands on a rank it
 * could never reach by moving).
 *
 * Frost is control (6.1, R-ELEM-001): the capture stands (D-03), but the captor loses the ground it
 * gained. A Frost bearer's Stillness also negates the captor's After-capturing abilities.
 */
import { cond, defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'frost_heave',
  name: 'Frost Heave',
  version: 1,
  category: 'CAPTURED',
  affinity: 'frost',
  eligible: 'all',
  tags: [],
  minLevel: 3,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.move(target.captor(), square.origin())],
  attuned: {
    mode: 'replace',
    effects: [
      fx.when(cond.typeIs('captor', ['pawn']), [fx.move(target.captor(), square.origin())]),
      fx.when(cond.not(cond.typeIs('captor', ['pawn'])), [
        fx.move(
          target.captor(),
          square.chosen({ near: { of: 'origin', pattern: 'adjacent' }, include: ['origin'] }),
        ),
      ]),
    ],
  },
  text: {
    short: 'Heaves its captor back.',
    rules:
      'When captured, push the captor back to the square it moved from, if empty. Attuned: you may instead place it on any empty square next to that square (a pawn always goes straight back).',
  },
  status: 'PLAYTEST',
});
