/** Poisoned Meat (5.7, 13.5 example, PLAYTEST): Captured, Grove, all. Effect-capture the captor. */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'poisoned_meat',
  name: 'Poisoned Meat',
  version: 1,
  category: 'CAPTURED',
  affinity: 'grove',
  eligible: 'all',
  tags: [],
  minLevel: 2,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.effectCapture(target.captor())],
  attuned: { mode: 'append', effects: [fx.revealIfSurvives(target.captor())] },
  text: {
    short: 'Takes its captor down with it.',
    rules:
      'When captured, effect-capture the captor. Attuned: if the captor survives, reveal all its abilities.',
  },
  status: 'PLAYTEST',
});
