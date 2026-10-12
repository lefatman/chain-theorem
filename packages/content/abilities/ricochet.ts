/**
 * Ricochet (5.7, PLAYTEST; designer brief 2026-10-09, plan item C6; DD-124): Captures, neutral,
 * bishops, rooks and queens, 2 charges. After capturing, continue one square past the capture square
 * in the direction of the move, if that square is empty. The CONTINUE square selector (DD-124) names
 * the square beyond the capture square along the line from the square the piece moved from; the move
 * fizzles `no_target` when that line is not one the piece slides on (a turned Electric Slide path) or
 * the step leaves the board, `occupied` when a piece stands there, `burning` on a Hot Foot square and
 * `inv03` when it would expose the own king; a fizzle spends no charge (DD-17). Leaving the capture
 * square ignites a pending Hot Foot burn (R-ELEM-005). Brakes: the charges, INV-03, occupied and
 * burning squares.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'ricochet',
  name: 'Ricochet',
  version: 1,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: ['bishop', 'rook', 'queen'],
  tags: [],
  minLevel: 8,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  effects: [fx.move(target.self(), square.continue())],
  text: {
    short: 'Takes, and keeps going.',
    rules:
      'After capturing, continue one square past the capture square in the direction of the move, if that square is empty (2 charges). A capture made through a turn does not continue.',
  },
  status: 'PLAYTEST',
});
