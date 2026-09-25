/**
 * Reinforce (5.7, PLAYTEST): Captures, Grove, all, revive, 1 charge. If the victim was not a pawn,
 * revive your most recently captured pawn on its starting square. Attuned: triggers on any victim.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'reinforce',
  name: 'Reinforce',
  version: 1,
  category: 'CAPTURES',
  affinity: 'grove',
  eligible: 'all',
  tags: ['revive'],
  minLevel: 10,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ victimTypeNot: 'pawn' }],
  effects: [fx.revive(target.mostRecentCaptured('friendly', 'pawn'), square.start())],
  attuned: {
    mode: 'replace',
    conditions: [],
    effects: [fx.revive(target.mostRecentCaptured('friendly', 'pawn'), square.start())],
  },
  text: {
    short: 'Big captures bring a pawn back.',
    rules:
      'After capturing a non-pawn, revive your most recently captured pawn on its starting square (1 charge). Attuned: triggers on any victim.',
  },
  status: 'PLAYTEST',
});
