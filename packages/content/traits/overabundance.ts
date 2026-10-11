/**
 * Overabundance — Grove trait (R-ELEM-007, COMMITTED identity; PLAYTEST number, DD-114). Every
 * consumable ability (one with charges) on a Grove piece has one extra charge. The number is the
 * `CAPS.TRAITS.OVERABUNDANCE` knob (plan item B4): `{ mode: 'add', amount: 1 }` ships, and
 * `{ mode: 'multiply', amount: 2 }` restores the launch rule of double charges. "A Grove piece starts
 * each battle with" the extra charge: it is fixed per piece identity at battle start (onBattleStart),
 * so a promotion that changes the piece's element later neither grants nor removes it (DD-43).
 * Charges persist through revival.
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
  version: 3,
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
    modifyCharges: (ctx, piece, _ability, charges) => {
      // Abilities without charges reach here as Infinity from the pipeline and stay unlimited.
      if (!Number.isFinite(charges) || !ctx.slice<OverabundanceState>(ID).grove.includes(piece.id))
        return charges;
      const knob = ctx.caps.TRAITS.OVERABUNDANCE;
      return knob.mode === 'add' ? charges + knob.amount : Math.floor(charges * knob.amount);
    },
  },
  text: {
    short: 'Consumable abilities have one extra charge.',
    rules: 'Every consumable ability on a Grove piece starts each battle with one extra charge.',
  },
  status: 'COMMITTED',
});
