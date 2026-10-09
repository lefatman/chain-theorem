/**
 * Reinforce (5.7, PLAYTEST): Captures, neutral, all, revive, 1 charge. If the victim was not a pawn,
 * revive your most recently captured pawn on its starting square. Neutral since DD-98: the former
 * Grove Attuned bonus (triggers on any victim) is dropped and there is no Attuned version.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'reinforce',
  name: 'Reinforce',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['revive'],
  minLevel: 10,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ victimTypeNot: 'pawn' }],
  effects: [fx.revive(target.mostRecentCaptured('friendly', 'pawn'), square.start())],
  text: {
    short: 'Big captures bring a pawn back.',
    rules:
      'After capturing a non-pawn, revive your most recently captured pawn on its starting square (1 charge).',
  },
  status: 'PLAYTEST',
});
