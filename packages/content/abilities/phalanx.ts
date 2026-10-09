/**
 * Phalanx (M7 7.3, PLAYTEST; neutral since DD-98): Capturing, neutral, all. When one of the owner's
 * pawns, knights or bishops captures, negate the victim's When-captured abilities for this capture.
 * Knights and bishops were the attuned extension until DD-98 folded them into the base condition;
 * the card has no affinity and no attuned version.
 *
 * The front line trades without fear of retaliation (Poisoned Meat, Backdraft, Riposte). A
 * Capturing NEGATE registers before the victim's reactions are queued, so they are negated as they
 * queue (5.3, the Pierce pattern). It replaced Close Ranks during the M7 balance pass
 * (docs/BALANCE_M7.md): a forced step into the vacated square often hurt its owner.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'phalanx',
  name: 'Phalanx',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 10,
  slotCost: 1,
  limits: { perAction: 1 },
  conditions: [{ captorTypeIs: ['pawn', 'knight', 'bishop'] }],
  effects: [fx.negate('victim', ['CAPTURED'])],
  text: {
    short: 'Minor pieces capture without fear.',
    rules:
      "When one of your pawns, knights or bishops captures, negate the victim's When-captured abilities for this capture.",
  },
  status: 'PLAYTEST',
});
