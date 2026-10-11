/**
 * Resonance Crystal (R-LOAD-002; PLAYTEST). The first time one of your pieces would be silenced this
 * battle, it is not (DD-30): none of that piece's triggers are silenced for that capture. Revealed
 * when it fires. The same under every silenceScope (6.2): the B5 brief (2026-10-11) retires DD-108's
 * reading that the Crystal meant "never" under ONCE_PER_ABILITY, because the B3 runs measured that
 * reading as no silence at all for every Crystal holder (docs/BALANCE_BASELINE.md section 8). The
 * engine consults silenceOverride before it records a once-per-ability silence (action.ts,
 * filterTrigger), so the spared ability still gets its one silence later.
 */
import { defineItem } from '@chain-theorem/rules/sdk';
import type { Side } from '@chain-theorem/rules';

export interface ResonanceState {
  used: Record<Side, { capture: number; piece: number } | null>;
}
const ID = 'resonance_crystal';

export default defineItem({
  id: ID,
  name: 'Resonance Crystal',
  version: 3,
  slotCost: 1,
  minLevel: 6,
  hooks: {
    stateSlice: { id: ID, init: (): ResonanceState => ({ used: { white: null, black: null } }) },
    silenceOverride: (ctx, t) => {
      const owner = ctx.owner;
      if (!owner || t.side !== owner) return false;
      const s = ctx.slice<ResonanceState>(ID);
      const used = s.used[owner];
      if (used === null) {
        ctx.setSlice<ResonanceState>({
          used: { ...s.used, [owner]: { capture: t.capture.id, piece: t.piece.id } },
        });
        ctx.revealSelf('observed');
        return true;
      }
      // The same piece in the same capture: all of its triggers are spared together (DD-30).
      return used.capture === t.capture.id && used.piece === t.piece.id;
    },
  },
  text: {
    short: 'Your first silence this battle does not happen.',
    rules: 'The first time one of your pieces would be silenced this battle, it is not.',
  },
  status: 'PLAYTEST',
});
