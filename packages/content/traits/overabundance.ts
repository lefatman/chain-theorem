/**
 * Overabundance — Grove trait (R-ELEM-007, COMMITTED). Every consumable ability (one with charges)
 * on a Grove piece has double the charges. "A Grove piece starts each battle with double the
 * charges": the doubling is fixed per piece identity at battle start (onBattleStart), so a promotion
 * that changes the piece's element later neither grants nor removes it (DD-43). Charges persist
 * through revival.
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export interface OverabundanceState {
  /** Ids of pieces that started the battle as Grove pieces. */
  grove: number[];
}
const ID = 'overabundance';

export default defineTrait({
  id: ID,
  name: 'Overabundance',
  element: 'grove',
  version: 2,
  hooks: {
    stateSlice: {
      id: ID,
      init: (ctx): OverabundanceState => ({
        grove: ctx
          .pieces()
          .filter((p) => p.element === 'grove')
          .map((p) => p.id),
      }),
      // Private: a viewer's belief state rebuilds it from the elements it can see, so a Masquerade
      // Mask is never exposed through this slice (DD-26).
    },
    modifyCharges: (ctx, piece, _ability, charges) =>
      ctx.slice<OverabundanceState>(ID).grove.includes(piece.id) ? charges * 2 : charges,
  },
  text: {
    short: 'Consumable abilities have double charges.',
    rules: 'Every consumable ability on a Grove piece starts each battle with double the charges.',
  },
  status: 'COMMITTED',
});
