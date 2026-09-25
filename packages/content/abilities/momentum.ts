/**
 * Momentum (5.7, PLAYTEST): Captures, Ember, non-king, replay, 2 charges. Bonus action: this piece
 * makes one non-capturing move. Attuned: the bonus move may be made by any friendly pawn instead.
 */
import { NON_KING, defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'momentum',
  name: 'Momentum',
  version: 1,
  category: 'CAPTURES',
  affinity: 'ember',
  eligible: NON_KING,
  tags: ['replay'],
  minLevel: 8,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  effects: [fx.bonusAction({ movers: 'self', capture: 'none', optional: true })],
  attuned: {
    mode: 'replace',
    effects: [fx.bonusAction({ movers: 'selfOrFriendlyPawn', capture: 'none', optional: true })],
  },
  text: {
    short: 'Captures, then moves again.',
    rules:
      'After capturing, this piece may make one non-capturing move (2 charges). Attuned: the bonus move may be made by any friendly pawn instead.',
  },
  status: 'PLAYTEST',
});
