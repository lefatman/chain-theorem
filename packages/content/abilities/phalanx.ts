/**
 * Phalanx (M7 7.3, PLAYTEST): Capturing, Stone, all. When one of the owner's pawns captures, negate
 * the victim's When-captured abilities for this capture. Attuned: also when a knight or bishop
 * captures (`attuned.conditions` replace the base ones, 3.9).
 *
 * Stone is protection (6.1): the front line trades without fear of retaliation (Poisoned Meat,
 * Backdraft, Riposte). A Capturing NEGATE registers before the victim's reactions are queued, so
 * they are negated as they queue (5.3, the Pierce pattern). It replaced Close Ranks during the M7
 * balance pass (docs/BALANCE_M7.md): a forced step into the vacated square often hurt its owner.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'phalanx',
  name: 'Phalanx',
  version: 1,
  category: 'CAPTURING',
  affinity: 'stone',
  eligible: 'all',
  tags: [],
  minLevel: 10,
  slotCost: 1,
  limits: { perAction: 1 },
  conditions: [{ captorTypeIs: ['pawn'] }],
  effects: [fx.negate('victim', ['CAPTURED'])],
  attuned: {
    mode: 'replace',
    conditions: [{ captorTypeIs: ['pawn', 'knight', 'bishop'] }],
    effects: [fx.negate('victim', ['CAPTURED'])],
  },
  text: {
    short: 'Pawns capture without fear.',
    rules:
      "When one of your pawns captures, negate the victim's When-captured abilities for this capture. Attuned: also when a knight or bishop captures.",
  },
  status: 'PLAYTEST',
});
