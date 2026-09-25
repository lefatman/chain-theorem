/**
 * Warden's Stopwatch (R-LOAD-002, D-39 COMMITTED; min level PLAYTEST).
 * Negates every replay and revive ability, for both players, for the whole battle.
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'wardens_stopwatch',
  name: "Warden's Stopwatch",
  version: 1,
  slotCost: 1,
  minLevel: 18,
  hooks: {
    // Both players: negate every replay and revive trigger for the whole battle.
    triggerFilter: (_ctx, { ability }) =>
      ability.tags.includes('replay') || ability.tags.includes('revive') ? 'negate' : 'allow',
  },
  text: {
    short: 'No replays or revivals, for both sides.',
    rules: 'Negates every replay and revive ability, for both players, for the whole battle.',
  },
  status: 'COMMITTED',
});
