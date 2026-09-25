/** Last Word (5.7, PLAYTEST): Captured, Tide, all. Reveal all abilities of the captor's piece type. */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'last_word',
  name: 'Last Word',
  version: 1,
  category: 'CAPTURED',
  affinity: 'tide',
  eligible: 'all',
  tags: [],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.reveal({ what: 'typeSet', of: 'captor' })],
  attuned: { mode: 'append', effects: [fx.reveal({ what: 'items' })] },
  text: {
    short: "Reveals its captor's abilities.",
    rules:
      "When captured, reveal all abilities of the captor's piece type. Attuned: also reveal the opponent's item names.",
  },
  status: 'PLAYTEST',
});
