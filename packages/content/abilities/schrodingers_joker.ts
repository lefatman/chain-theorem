/**
 * Schrödinger's Joker (5.8, PLAYTEST; designer brief 2026-10-06, DD-97, DD-101): Captures, neutral,
 * non-king, 1 charge. After capturing a victim of higher rank than this piece, the captor gets a
 * twin: a second piece of the same type, element and abilities that waits on the captor's square
 * and, from the owner's next turn, makes its own move right after the owner's normal move each turn
 * (a declinable prompt). Capturing or effect-capturing any member of a twin group removes the whole
 * group (linked fate). A twin that captures a higher-rank piece spawns another twin into the group
 * (its own charge); a group holds at most CAPS.TWIN_GROUP_MAX pieces. Behind a PLAYTEST flag.
 */
import { defineAbility, fx, NON_KING } from '@chain-theorem/rules/sdk';
import { PLAYTEST_FLAGS } from '../config.ts';

export default defineAbility({
  id: 'schrodingers_joker',
  name: "Schr\u00f6dinger's Joker",
  version: 1,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: NON_KING,
  tags: [],
  minLevel: 20,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ rank: { of: 'victim', cmp: '>', to: 'captor' } }],
  effects: [fx.spawn()],
  text: {
    short: 'Beat a better piece and become two.',
    rules:
      'After capturing a piece of higher rank than this piece, it gains a twin: a copy with the same abilities that waits on this square and, from your next turn, makes its own move right after your normal move each turn. Capturing any member of a twin group removes them all. A group holds at most three pieces (1 charge).',
  },
  status: 'PLAYTEST',
  retired: !PLAYTEST_FLAGS.schrodingers_joker,
});
