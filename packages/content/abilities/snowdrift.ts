/**
 * Snowdrift (M7 7.3, PLAYTEST): Captures, Frost, all. After capturing, the owner moves one enemy
 * knight, bishop, rook or queen adjacent to the landing square to another empty square adjacent to
 * the landing square. Attuned: the square the captor moved from is offered too.
 *
 * Frost is control (6.1): a free shove of an enemy piece around the capture. Kings and pawns are
 * never moved (a pawn could be left on a rank it could never reach by moving). The chosen square
 * may not leave the acting player's ordinary king in check (INV-03, DD-19).
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

const DRIFTERS = ['knight', 'bishop', 'rook', 'queen'] as const;
const neighbour = () =>
  target.chosen({
    side: 'enemy',
    types: [...DRIFTERS],
    near: { of: 'landing', pattern: 'adjacent' },
  });

export default defineAbility({
  id: 'snowdrift',
  name: 'Snowdrift',
  version: 1,
  category: 'CAPTURES',
  affinity: 'frost',
  eligible: 'all',
  tags: [],
  minLevel: 9,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.move(neighbour(), square.chosen({ near: { of: 'landing', pattern: 'adjacent' } }))],
  attuned: {
    mode: 'replace',
    effects: [
      fx.move(
        neighbour(),
        square.chosen({ near: { of: 'landing', pattern: 'adjacent' }, include: ['origin'] }),
      ),
    ],
  },
  text: {
    short: 'Drifts a neighbour aside.',
    rules:
      'After capturing, move one enemy knight, bishop, rook or queen next to the landing square to another empty square next to it. Attuned: you may put it on the square this piece moved from instead.',
  },
  status: 'PLAYTEST',
});
