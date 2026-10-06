/**
 * Pierce (5.7, PLAYTEST): Capturing, neutral, all. Negate the victim's Captured abilities for this
 * capture. Neutral since DD-98: the former Tide Attuned bonus (also reveal all abilities of the
 * victim's piece type) is dropped and there is no Attuned version.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'pierce',
  name: 'Pierce',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 3,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.negate('victim', ['CAPTURED'])],
  text: {
    short: "Stops the victim's last trick.",
    rules: "When capturing, negate the victim's When-captured abilities for this capture.",
  },
  status: 'PLAYTEST',
});
