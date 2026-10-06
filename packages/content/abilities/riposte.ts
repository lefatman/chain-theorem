/**
 * Riposte (5.7, PLAYTEST): Captured, neutral, all, replay. Bonus action for the owner: capture the
 * captor with any piece that legally can (a nested pipeline, 5.3). Neutral since DD-98: the former
 * Ember Attuned fallback (effect-capture a pawn captor nobody can take) is dropped and there is no
 * Attuned version.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'riposte',
  name: 'Riposte',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 12,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'anyFriendly', capture: 'captor', optional: true })],
  text: {
    short: 'Answers a capture with a capture.',
    rules: 'When captured, you may capture the captor with any piece that legally can.',
  },
  status: 'PLAYTEST',
});
