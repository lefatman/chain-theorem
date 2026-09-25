/**
 * Riposte (5.7, PLAYTEST): Captured, Ember, all, replay. Bonus action for the owner: capture the
 * captor with any piece that legally can (a nested pipeline, 5.3). Attuned: if none can and the
 * captor is a pawn, effect-capture it.
 */
import { cond, defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'riposte',
  name: 'Riposte',
  version: 1,
  category: 'CAPTURED',
  affinity: 'ember',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 12,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'anyFriendly', capture: 'captor', optional: true })],
  attuned: {
    mode: 'append',
    effects: [
      fx.when(cond.all(cond.noLegalCapturerOfCaptor(), cond.typeIs('captor', ['pawn'])), [
        fx.effectCapture(target.captor()),
      ]),
    ],
  },
  text: {
    short: 'Answers a capture with a capture.',
    rules:
      'When captured, you may capture the captor with any piece that legally can. Attuned: if none can and the captor is a pawn, effect-capture it.',
  },
  status: 'PLAYTEST',
});
