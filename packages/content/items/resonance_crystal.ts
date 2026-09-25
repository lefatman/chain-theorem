/**
 * Resonance Crystal (R-LOAD-002; PLAYTEST). The first time one of your pieces would be silenced this
 * battle, it is not (DD-30): none of that piece's triggers are silenced for that capture. Revealed
 * when it fires.
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
  version: 1,
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
      return used.capture === t.capture.id && used.piece === t.piece.id;
    },
  },
  text: {
    short: 'Your first silence this battle does not happen.',
    rules: 'The first time one of your pieces would be silenced this battle, it is not.',
  },
  status: 'PLAYTEST',
});
