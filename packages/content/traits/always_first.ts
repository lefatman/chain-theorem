/**
 * Always First — Storm trait (D-28, R-ELEM-001, COMMITTED). Your Storm pieces' abilities resolve
 * before every other ability in the same queue. If both sides have Storm triggers, the default order
 * (5.4) applies among them (a stable partition keeps it).
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: 'always_first',
  name: 'Always First',
  element: 'storm',
  version: 1,
  hooks: {
    queueOrder: (_ctx, queue) => [
      ...queue.filter((t) => t.element === 'storm'),
      ...queue.filter((t) => t.element !== 'storm'),
    ],
  },
  text: {
    short: 'Its abilities resolve first.',
    rules: "Your Storm pieces' abilities resolve before every other ability in the same queue.",
  },
  status: 'COMMITTED',
});
