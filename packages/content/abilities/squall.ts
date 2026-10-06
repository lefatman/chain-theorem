/**
 * Squall (M7 7.3, PLAYTEST): Captured, neutral, all, replay. Bonus action for the owner: one of its
 * pawns may make one non-capturing move. Tempo on loss: losing a piece still gains a move. The
 * bearer is off the board when it resolves, so only pawns are offered. One bonus move, never inside
 * a bonus action (INV-01, DD-12); the move may not leave the acting player's ordinary king in check
 * (INV-03, DD-21). Storm's signature until Electric Slide shipped (DD-98, DD-104); neutral since,
 * with its former attuned version (any piece may move) retired.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'squall',
  name: 'Squall',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'selfOrFriendlyPawn', capture: 'none', optional: true })],
  text: {
    short: 'Falls, and a pawn moves up.',
    rules: 'When captured, you may move one of your pawns (a move that does not capture).',
  },
  status: 'PLAYTEST',
});
