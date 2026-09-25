/**
 * Hit and Run (5.7, PLAYTEST): Captures, Tide, non-king. Return to the square it moved from, if
 * empty. Attuned: may instead land on any empty square adjacent to that square (DD-20).
 */
import { NON_KING, defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'hit_and_run',
  name: 'Hit and Run',
  version: 1,
  category: 'CAPTURES',
  affinity: 'tide',
  eligible: NON_KING,
  tags: [],
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.move(target.self(), square.origin())],
  attuned: {
    mode: 'replace',
    effects: [
      fx.move(
        target.self(),
        square.chosen({ near: { of: 'origin', pattern: 'adjacent' }, include: ['origin'] }),
      ),
    ],
  },
  text: {
    short: 'Captures, then steps back.',
    rules:
      'After capturing, return to the square it moved from, if empty. Attuned: may instead land on any empty square adjacent to that square.',
  },
  status: 'PLAYTEST',
});
