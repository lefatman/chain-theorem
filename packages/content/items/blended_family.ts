/**
 * Blended Family (R-ELEM-004, R-LOAD-002, D-06 COMMITTED; min level PLAYTEST).
 * Two different elements split by group: pawns, knights and bishops take element A; rooks, queen
 * and king take element B (DD-13: `grants.secondElement`).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'blended_family',
  name: 'Blended Family',
  version: 1,
  slotCost: 1,
  minLevel: 15,
  grants: { secondElement: true },
  hooks: {},
  text: {
    short: 'Two elements, split by piece group.',
    rules:
      'Pawns, knights and bishops take element A; rooks, queen and king take element B. The two elements must differ.',
  },
  status: 'COMMITTED',
});
