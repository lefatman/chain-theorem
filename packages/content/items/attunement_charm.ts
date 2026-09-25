/**
 * Attunement Charm (R-LOAD-002; PLAYTEST). Abilities of the chosen affinity count as Attuned on all
 * your pieces (DD-29: one module with an element parameter chosen in the loadout).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

const ID = 'attunement_charm';

export default defineItem({
  id: ID,
  name: 'Attunement Charm',
  version: 1,
  slotCost: 1,
  minLevel: 4,
  param: { element: 'required' },
  hooks: {
    attunement: (ctx, piece, ability) => {
      const owner = ctx.owner;
      if (!owner || piece.side !== owner) return false;
      const el = ctx.itemParam(owner, ID)?.element;
      return el !== undefined && ability.affinity === el;
    },
  },
  text: {
    short: 'One affinity counts as Attuned on every piece.',
    rules: 'Abilities of the chosen affinity count as Attuned on all your pieces.',
  },
  status: 'PLAYTEST',
});
