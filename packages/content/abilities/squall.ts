/**
 * Squall (M7 7.3, PLAYTEST): Captured, Storm, all, replay. Bonus action for the owner: one of its
 * pawns may make one non-capturing move. Attuned: any of its pieces may make the move instead.
 * Storm is tempo (6.1, R-ELEM-001): losing a piece still gains a move. The bearer is off the board
 * when it resolves, so the base version offers pawns only. One bonus move, never inside a bonus
 * action (INV-01, DD-12); the move may not leave the acting player's ordinary king in check (INV-03,
 * DD-21).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'squall',
  name: 'Squall',
  version: 1,
  category: 'CAPTURED',
  affinity: 'storm',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'selfOrFriendlyPawn', capture: 'none', optional: true })],
  attuned: {
    mode: 'replace',
    effects: [fx.bonusAction({ movers: 'anyFriendly', capture: 'none', optional: true })],
  },
  text: {
    short: 'Falls, and a pawn moves up.',
    rules:
      'When captured, you may move one of your pawns (a move that does not capture). Attuned: any of your pieces may make the move instead.',
  },
  status: 'PLAYTEST',
});
