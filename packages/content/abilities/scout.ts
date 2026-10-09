/**
 * Scout (5.7, PLAYTEST): Capturing, neutral, all. Reveal the victim's abilities before they resolve.
 * Neutral since DD-98: the former Tide Attuned bonus (also reveal the opponent's highest-cost item,
 * DD-40) is dropped and there is no Attuned version.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'scout',
  name: 'Scout',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.reveal({ what: 'typeSet', of: 'victim' })],
  text: {
    short: "Reveals the victim's abilities.",
    rules: "When capturing, reveal all abilities of the victim's piece type before they resolve.",
  },
  status: 'PLAYTEST',
});
