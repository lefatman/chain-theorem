/**
 * Dual Adept's Glove — capacity item (R-LOAD-002, D-10, D-22 COMMITTED; min level PLAYTEST, DD-05).
 * Ability capacity 2 for 1 item slot. Capacity items never stack (exclusive group).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'dual_adepts_glove',
  name: "Dual Adept's Glove",
  version: 1,
  slotCost: 1,
  minLevel: 1,
  capacity: 2,
  exclusiveGroup: 'capacity',
  hooks: {},
  text: {
    short: 'Ability capacity 2.',
    rules: 'Each piece type may hold up to 2 ability slots. Capacity items never stack.',
  },
  status: 'COMMITTED',
});
