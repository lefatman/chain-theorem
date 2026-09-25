/** Antidote (5.7, PLAYTEST): Capturing, Grove, all. The first effect capture targeting this piece this action fizzles. */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'antidote',
  name: 'Antidote',
  version: 1,
  category: 'CAPTURING',
  affinity: 'grove',
  eligible: 'all',
  tags: [],
  minLevel: 5,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.protect(target.self(), 1)],
  attuned: { mode: 'replace', effects: [fx.protect(target.self(), 'all')] },
  text: {
    short: 'Shrugs off the first retaliation.',
    rules:
      'When capturing, the first effect capture targeting this piece this action fizzles. Attuned: every effect capture targeting it this action fizzles.',
  },
  status: 'PLAYTEST',
});
