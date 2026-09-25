/**
 * Permafrost (M7 7.3, PLAYTEST): Captured, Frost, all, 1 charge. Send the captor back to its
 * starting square (its identity's start, DD-22), if empty. Attuned: also send one other enemy
 * knight, bishop, rook or queen adjacent to this square (its last known square, 5.4) back to its
 * starting square. The charge was added in the M7 balance pass (docs/BALANCE_M7.md).
 *
 * Frost is control (6.1): the strongest push, at the top of the level range. The capture stands
 * (D-03); starting squares are fixed selectors, so an occupied, burning or unsafe one fizzles.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'permafrost',
  name: 'Permafrost',
  version: 1,
  category: 'CAPTURED',
  affinity: 'frost',
  eligible: 'all',
  tags: [],
  minLevel: 20,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  effects: [fx.move(target.captor(), square.start())],
  attuned: {
    mode: 'append',
    effects: [
      fx.move(
        target.chosen({
          side: 'enemy',
          types: ['knight', 'bishop', 'rook', 'queen'],
          near: { of: 'self', pattern: 'adjacent' },
          exclude: ['captor'],
        }),
        square.start(),
      ),
    ],
  },
  text: {
    short: 'Freezes its captor back home.',
    rules:
      'When captured, send the captor back to its starting square, if that square is empty (1 charge). Attuned: also send one other enemy knight, bishop, rook or queen next to this square back to its starting square.',
  },
  status: 'PLAYTEST',
});
