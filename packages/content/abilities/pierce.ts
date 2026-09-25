/** Pierce (5.7, PLAYTEST): Capturing, Tide, all. Negate the victim's Captured abilities for this capture. */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'pierce',
  name: 'Pierce',
  version: 1,
  category: 'CAPTURING',
  affinity: 'tide',
  eligible: 'all',
  tags: [],
  minLevel: 3,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.negate('victim', ['CAPTURED'])],
  attuned: { mode: 'append', effects: [fx.reveal({ what: 'typeSet', of: 'victim' })] },
  text: {
    short: "Stops the victim's last trick.",
    rules:
      "When capturing, negate the victim's When-captured abilities for this capture. Attuned: also reveal all abilities of the victim's piece type.",
  },
  status: 'PLAYTEST',
});
