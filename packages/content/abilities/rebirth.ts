/**
 * Rebirth (5.7, PLAYTEST): Captured, neutral, non-king, revive, 1 charge. At chain end, return to its
 * starting square if empty. Neutral since DD-98: the former Grove Attuned bonus (may return to any
 * empty back-rank square instead, DD-22) is dropped and there is no Attuned version.
 */
import { NON_KING, defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'rebirth',
  name: 'Rebirth',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: NON_KING,
  tags: ['revive'],
  minLevel: 14,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  effects: [fx.atChainEnd([fx.revive(target.self(), square.start())])],
  text: {
    short: 'Comes back once.',
    rules:
      'When captured, at the end of the chain return to its starting square if empty (1 charge).',
  },
  status: 'PLAYTEST',
});
