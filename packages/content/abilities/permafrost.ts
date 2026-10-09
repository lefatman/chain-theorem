/**
 * Permafrost (M7 7.3, PLAYTEST; neutral since DD-98): Captured, neutral, all, 1 charge. Send the
 * captor back to its starting square (its identity's start, DD-22), if empty. The attuned bonus
 * (also sending one other adjacent enemy piece home) was dropped by DD-98; the card has no affinity
 * and no attuned version. The charge was added in the M7 balance pass (docs/BALANCE_M7.md).
 *
 * The strongest push, at the top of the level range. The capture stands (D-03); the starting
 * square is a fixed selector, so an occupied, burning or unsafe one fizzles.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'permafrost',
  name: 'Permafrost',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 20,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  effects: [fx.move(target.captor(), square.start())],
  text: {
    short: 'Freezes its captor back home.',
    rules:
      'When captured, send the captor back to its starting square, if that square is empty (1 charge).',
  },
  status: 'PLAYTEST',
});
