/**
 * Last Word (5.7, PLAYTEST): Captured, neutral, all. Reveal all abilities of the captor's piece type.
 * Neutral since DD-98: the former Tide Attuned bonus (also reveal the opponent's item names, DD-40)
 * is dropped and there is no Attuned version.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'last_word',
  name: 'Last Word',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.reveal({ what: 'typeSet', of: 'captor' })],
  text: {
    short: "Reveals its captor's abilities.",
    rules: "When captured, reveal all abilities of the captor's piece type.",
  },
  status: 'PLAYTEST',
});
