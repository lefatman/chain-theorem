/**
 * Snowdrift (M7 7.3, PLAYTEST; neutral since DD-98): Captures, neutral, all. After capturing, the
 * owner moves one enemy knight, bishop, rook or queen adjacent to the landing square to another
 * empty square adjacent to the landing square, or to the square the captor moved from. Offering the
 * origin square was the attuned bonus until DD-98 folded it into the base (one chosen-square
 * selector: the adjacent empties plus `include: ['origin']`); the card has no affinity and no
 * attuned version.
 *
 * A free shove of an enemy piece around the capture. Kings and pawns are never moved (a pawn could
 * be left on a rank it could never reach by moving). The chosen square may not leave the acting
 * player's ordinary king in check (INV-03, DD-19).
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

const DRIFTERS = ['knight', 'bishop', 'rook', 'queen'] as const;

export default defineAbility({
  id: 'snowdrift',
  name: 'Snowdrift',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 9,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.move(
      target.chosen({
        side: 'enemy',
        types: [...DRIFTERS],
        near: { of: 'landing', pattern: 'adjacent' },
      }),
      square.chosen({ near: { of: 'landing', pattern: 'adjacent' }, include: ['origin'] }),
    ),
  ],
  text: {
    short: 'Drifts a neighbour aside.',
    rules:
      'After capturing, move one enemy knight, bishop, rook or queen next to the landing square to another empty square next to it, or to the square this piece moved from.',
  },
  status: 'PLAYTEST',
});
