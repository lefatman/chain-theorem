/**
 * Slipstream (M7 7.3, PLAYTEST): Captures, Storm, all, replay, 1 charge. After capturing a piece that
 * is not a pawn, any friendly piece may make one non-capturing move. Attuned: triggers on any victim
 * (the Reinforce pattern: `attuned.conditions: []`). With Always First (6.1) a Storm captor's bonus
 * move comes before the victim's When-captured abilities resolve.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'slipstream',
  name: 'Slipstream',
  version: 1,
  category: 'CAPTURES',
  affinity: 'storm',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 12,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ victimTypeNot: 'pawn' }],
  effects: [fx.bonusAction({ movers: 'anyFriendly', capture: 'none', optional: true })],
  attuned: {
    mode: 'replace',
    conditions: [],
    effects: [fx.bonusAction({ movers: 'anyFriendly', capture: 'none', optional: true })],
  },
  text: {
    short: 'A big capture lets any piece move.',
    rules:
      'After capturing a piece that is not a pawn, any of your pieces may make one move that does not capture (1 charge). Attuned: triggers on any victim.',
  },
  status: 'PLAYTEST',
});
