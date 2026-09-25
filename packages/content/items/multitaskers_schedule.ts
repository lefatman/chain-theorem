/**
 * Multitasker's Schedule (R-LOAD-002, R-LOAD-003, D-09 COMMITTED; min level PLAYTEST).
 * A separate ability set for each of the six piece types (DD-13: `grants.perTypeSets`).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'multitaskers_schedule',
  name: "Multitasker's Schedule",
  version: 1,
  slotCost: 1,
  minLevel: 10,
  grants: { perTypeSets: true },
  hooks: {},
  text: {
    short: 'A separate ability set per piece type.',
    rules: 'Instead of one army-wide set, give each of the six piece types its own ability set.',
  },
  status: 'COMMITTED',
});
