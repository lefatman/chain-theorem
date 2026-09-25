/**
 * Headmaster Ring — capacity item (R-LOAD-002, D-10, D-22 COMMITTED; min level PLAYTEST, DD-05).
 * Ability capacity 5 for 4 item slots. Capacity items never stack (exclusive group).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'headmaster_ring',
  name: 'Headmaster Ring',
  version: 1,
  slotCost: 4,
  minLevel: 20,
  capacity: 5,
  exclusiveGroup: 'capacity',
  hooks: {},
  text: {
    short: 'Ability capacity 5.',
    rules: 'Each piece type may hold up to 5 ability slots. Capacity items never stack.',
  },
  status: 'COMMITTED',
});
