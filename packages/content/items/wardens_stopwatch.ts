/**
 * Warden's Stopwatch (R-LOAD-002, D-39 COMMITTED; min level PLAYTEST).
 * Negates every replay and revive ability, for both players, for the whole battle. Since the C7 brief
 * (2026-10-09; DD-127) it also stops an item's revive (Reliquary): the item's `ctx.revive` passes the
 * revive intercepts, where the Stopwatch fizzles it with reason `negated` and is revealed as the
 * source, the way the engine reveals any item whose intercept fizzles an effect.
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'wardens_stopwatch',
  name: "Warden's Stopwatch",
  version: 2,
  slotCost: 1,
  minLevel: 18,
  hooks: {
    // Both players: negate every replay and revive trigger for the whole battle.
    triggerFilter: (_ctx, { ability }) =>
      ability.tags.includes('replay') || ability.tags.includes('revive') ? 'negate' : 'allow',
    // Both players: an item's revive (Reliquary, DD-127) fizzles too.
    effectIntercept: (_ctx, eff) =>
      eff.kind === 'revive' && eff.source.kind === 'item' ? { fizzle: 'negated' } : 'allow',
  },
  text: {
    short: 'No replays or revivals, for both sides.',
    rules:
      'Negates every replay and revive ability, and every revive from an item, for both players, for the whole battle.',
  },
  status: 'COMMITTED',
});
