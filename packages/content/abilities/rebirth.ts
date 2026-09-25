/**
 * Rebirth (5.7, PLAYTEST): Captured, Grove, non-king, revive, 1 charge. At chain end, return to its
 * starting square if empty. Attuned: may return to any empty back-rank square (DD-22).
 */
import { NON_KING, defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'rebirth',
  name: 'Rebirth',
  version: 1,
  category: 'CAPTURED',
  affinity: 'grove',
  eligible: NON_KING,
  tags: ['revive'],
  minLevel: 14,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  effects: [fx.atChainEnd([fx.revive(target.self(), square.start())])],
  attuned: {
    mode: 'replace',
    effects: [
      fx.atChainEnd([
        fx.revive(target.self(), square.chosen({ backRank: true, include: ['start'] })),
      ]),
    ],
  },
  text: {
    short: 'Comes back once.',
    rules:
      'When captured, at the end of the chain return to its starting square if empty (1 charge). Attuned: may return to any empty back-rank square.',
  },
  status: 'PLAYTEST',
});
