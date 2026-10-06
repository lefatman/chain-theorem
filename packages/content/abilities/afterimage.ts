/**
 * Afterimage (M7 7.3, PLAYTEST): Captures, neutral, knights, bishops, rooks and queens. After
 * capturing, move to an empty square adjacent to the landing square (the owner chooses), and the
 * first effect capture targeting this piece this action fizzles. Neutral since DD-98: the former
 * Storm Attuned bonus (that guard) is folded into the base and there is no Attuned version.
 *
 * Storm's Always First trait (6.1) resolves a Storm bearer's After-capturing abilities before the
 * victim's When-captured ones, so a Storm bearer steps aside and is guarded before the retaliation
 * arrives; any other bearer resolves them after it (5.3 phase 4), so its guard only covers what
 * follows in the same action. Pawns are not eligible: a sidestep could leave a pawn on its last rank
 * without promoting.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'afterimage',
  name: 'Afterimage',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: ['knight', 'bishop', 'rook', 'queen'],
  tags: [],
  minLevel: 5,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.move(target.self(), square.chosen({ near: { of: 'landing', pattern: 'adjacent' } })),
    fx.protect(target.self(), 1),
  ],
  text: {
    short: 'Captures, then sidesteps.',
    rules:
      'After capturing, move to an empty square adjacent to the landing square (you choose). The first effect capture targeting this piece this action fizzles.',
  },
  status: 'PLAYTEST',
});
