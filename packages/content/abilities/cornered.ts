/**
 * Cornered (5.7, PLAYTEST; designer brief 2026-10-09, plan item C6; DD-123): Captured, neutral, all,
 * 1 charge. When captured on a rim square (the a- or h-file, the first or eighth rank), effect-capture
 * the captor. A positional Poisoned Meat: it does nothing in the centre, and Snowdrift, Snowbound and
 * Frost Heave move enemies to the edge for it. Counters: Pierce and Overwhelm (negation), Antidote
 * and Buttress (protection), Bulwark, Stalwart (no venom tag, so a Stalwart captor stays) and Royal
 * Immunity. The rim test is the ZONE trigger condition (DD-123): when it fails the card does not
 * trigger at all, so it stays hidden, spends nothing and is revealed only when it fires.
 */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'cornered',
  name: 'Cornered',
  version: 1,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 4,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ zone: { of: 'victim', is: 'rim' } }],
  effects: [fx.effectCapture(target.captor())],
  text: {
    short: 'Back to the wall, it bites.',
    rules:
      'When captured on a rim square (the a- or h-file, the first or eighth rank), effect-capture the captor (1 charge).',
  },
  status: 'PLAYTEST',
});
