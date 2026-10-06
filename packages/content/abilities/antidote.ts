/**
 * Antidote (5.7, PLAYTEST): Capturing, neutral, all. The first effect capture targeting this piece
 * this action fizzles. Neutral since DD-98: the former Grove Attuned bonus (every effect capture
 * targeting it this action fizzles) is dropped and there is no Attuned version.
 */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'antidote',
  name: 'Antidote',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 5,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.protect(target.self(), 1)],
  text: {
    short: 'Shrugs off the first retaliation.',
    rules: 'When capturing, the first effect capture targeting this piece this action fizzles.',
  },
  status: 'PLAYTEST',
});
