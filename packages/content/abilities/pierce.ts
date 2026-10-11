/**
 * Pierce (5.7, PLAYTEST): Capturing, neutral, all, 2 charges. Negate the victim's Captured
 * abilities for this capture. Neutral since DD-98: the former Tide Attuned bonus (also reveal all
 * abilities of the victim's piece type) is dropped and there is no Attuned version. Two charges since
 * the B5 brief (2026-10-11): the B3 silence runs found an unsilenced Pierce negating Poisoned Meat on
 * every capture (docs/BALANCE_BASELINE.md section 8), so each piece now pierces twice. A charge is
 * spent whenever Pierce fires, whether or not the victim had anything to negate (DD-17: the negate
 * effect resolves when it is registered).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'pierce',
  name: 'Pierce',
  version: 3,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 3,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  effects: [fx.negate('victim', ['CAPTURED'])],
  text: {
    short: "Stops the victim's last trick.",
    rules:
      "When capturing, negate the victim's When-captured abilities for this capture (2 charges).",
  },
  status: 'PLAYTEST',
});
