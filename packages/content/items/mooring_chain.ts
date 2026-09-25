/**
 * Mooring Chain (M7 7.3, R-LOAD-002; PLAYTEST). The first time one of the opponent's abilities would
 * move one of the wearer's pieces this battle, that move fizzles (reason `protected`). The answer to
 * Frost's control (Frost Heave, Snowdrift, Snowbound, Permafrost): one push per battle is ignored.
 * Only enemy moves count: the wearer's own Hit and Run or Afterimage are never stopped.
 *
 * The engine reveals an item whose `effectIntercept` fizzles an effect (8.2), so no explicit reveal
 * is needed. The per-side "used" flag is private (like Resonance Crystal): previews and NPCs assume
 * an unknown Mooring Chain is absent, and a revealed one's use is in the public event log.
 */
import type { Side } from '@chain-theorem/rules';
import { defineItem } from '@chain-theorem/rules/sdk';

export interface MooringState {
  used: Record<Side, boolean>;
}
const ID = 'mooring_chain';

export default defineItem({
  id: ID,
  name: 'Mooring Chain',
  version: 1,
  slotCost: 1,
  minLevel: 8,
  hooks: {
    stateSlice: { id: ID, init: (): MooringState => ({ used: { white: false, black: false } }) },
    effectIntercept: (ctx, eff) => {
      const owner = ctx.owner;
      if (!owner || eff.kind !== 'move') return 'allow';
      if (eff.target.side !== owner || eff.sourceSide === owner) return 'allow';
      const s = ctx.slice<MooringState>(ID);
      if (s.used[owner]) return 'allow';
      ctx.setSlice<MooringState>({ used: { ...s.used, [owner]: true } });
      return { fizzle: 'protected' };
    },
  },
  text: {
    short: 'Your first piece to be pushed stays put.',
    rules:
      "The first time one of your opponent's abilities would move one of your pieces this battle, that move fizzles.",
  },
  status: 'PLAYTEST',
});
