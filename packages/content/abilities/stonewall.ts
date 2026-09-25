/**
 * Stonewall (M7 7.3, PLAYTEST): Captured, Stone, all. Negate the captor's After-capturing abilities
 * for this capture. Attuned: also reveal all abilities of the captor's piece type.
 *
 * The mirror of Pierce (5.7): the victim's When-captured triggers are queued before the captor's
 * After-capturing ones (5.3 phase 4), so the NEGATE lands on them while they wait. A Storm captor's
 * abilities resolve first (Always First, 6.1) and are already done when Stonewall resolves; a Frost
 * bearer gets the same negation from its Stillness trait, so the attuned reveal is its real gain.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'stonewall',
  name: 'Stonewall',
  version: 1,
  category: 'CAPTURED',
  affinity: 'stone',
  eligible: 'all',
  tags: [],
  minLevel: 6,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.negate('captor', ['CAPTURES'])],
  attuned: { mode: 'append', effects: [fx.reveal({ what: 'typeSet', of: 'captor' })] },
  text: {
    short: "Stops the captor's follow-up.",
    rules:
      "When captured, negate the captor's After-capturing abilities for this capture. Attuned: also reveal all abilities of the captor's piece type.",
  },
  status: 'PLAYTEST',
});
