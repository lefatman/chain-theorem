/** Scout (5.7, PLAYTEST): Capturing, Tide, all. Reveal the victim's abilities before they resolve. */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'scout',
  name: 'Scout',
  version: 1,
  category: 'CAPTURING',
  affinity: 'tide',
  eligible: 'all',
  tags: [],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.reveal({ what: 'typeSet', of: 'victim' })],
  attuned: { mode: 'append', effects: [fx.reveal({ what: 'highestCostItem' })] },
  text: {
    short: "Reveals the victim's abilities.",
    rules:
      "When capturing, reveal all abilities of the victim's piece type before they resolve. Attuned: also reveal the opponent's highest-cost item.",
  },
  status: 'PLAYTEST',
});
