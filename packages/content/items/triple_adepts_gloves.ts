/**
 * Triple Adept's Gloves — capacity item (R-LOAD-002, D-10, D-22 COMMITTED; min level PLAYTEST, DD-05).
 * Ability capacity 3 for 2 item slots. Capacity items never stack (exclusive group).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'triple_adepts_gloves',
  name: "Triple Adept's Gloves",
  version: 1,
  slotCost: 2,
  minLevel: 5,
  capacity: 3,
  exclusiveGroup: 'capacity',
  hooks: {},
  text: {
    short: 'Ability capacity 3.',
    rules: 'Each piece type may hold up to 3 ability slots. Capacity items never stack.',
  },
  status: 'COMMITTED',
});
