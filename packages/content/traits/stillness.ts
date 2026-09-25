/**
 * Stillness — Frost trait (D-29, R-ELEM-001, COMMITTED). A piece that captures your Frost piece has
 * its Captures abilities negated for that capture.
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: 'stillness',
  name: 'Stillness',
  element: 'frost',
  version: 1,
  hooks: {
    triggerFilter: (_ctx, t) =>
      t.category === 'CAPTURES' &&
      t.piece.id === t.capture.captor.id &&
      t.capture.victim.element === 'frost'
        ? 'negate'
        : 'allow',
  },
  text: {
    short: "Its captor's After-capturing abilities are negated.",
    rules:
      'A piece that captures your Frost piece has its Captures abilities negated for that capture.',
  },
  status: 'COMMITTED',
});
