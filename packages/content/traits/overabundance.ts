/**
 * Overabundance — Grove trait (R-ELEM-007, COMMITTED). Every consumable ability (one with charges)
 * on a Grove piece has double the charges. Charges persist through revival. Implemented with the
 * modifyCharges hook so promoted pieces follow their current element (DD-14).
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: 'overabundance',
  name: 'Overabundance',
  element: 'grove',
  version: 1,
  hooks: {
    modifyCharges: (_ctx, piece, _ability, charges) =>
      piece.element === 'grove' ? charges * 2 : charges,
  },
  text: {
    short: 'Consumable abilities have double charges.',
    rules: 'Every consumable ability on a Grove piece starts each battle with double the charges.',
  },
  status: 'COMMITTED',
});
