/**
 * Journeyman's Medallion — capacity item (R-LOAD-002, D-10, D-22 COMMITTED; min level PLAYTEST, DD-05).
 * Ability capacity 4 for 3 item slots. Capacity items never stack (exclusive group).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'journeymans_medallion',
  name: "Journeyman's Medallion",
  version: 1,
  slotCost: 3,
  minLevel: 12,
  capacity: 4,
  exclusiveGroup: 'capacity',
  hooks: {},
  text: {
    short: 'Ability capacity 4.',
    rules: 'Each piece type may hold up to 4 ability slots. Capacity items never stack.',
  },
  status: 'COMMITTED',
});
