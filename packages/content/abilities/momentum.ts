/**
 * Momentum (5.7, PLAYTEST): Captures, neutral, non-king, replay, 2 charges. Bonus action: this piece
 * makes one non-capturing move. Neutral since DD-98: the former Ember Attuned bonus (any friendly
 * pawn could make the move instead) is dropped and there is no Attuned version.
 */
import { NON_KING, defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'momentum',
  name: 'Momentum',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: NON_KING,
  tags: ['replay'],
  minLevel: 8,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  effects: [fx.bonusAction({ movers: 'self', capture: 'none', optional: true })],
  text: {
    short: 'Captures, then moves again.',
    rules: 'After capturing, this piece may make one non-capturing move (2 charges).',
  },
  status: 'PLAYTEST',
});
