/**
 * Afterimage (M7 7.3, PLAYTEST): Captures, Storm, knights, bishops, rooks and queens. After
 * capturing, move to an empty square adjacent to the landing square (the owner chooses). Attuned:
 * the first effect capture targeting this piece this action also fizzles.
 *
 * Storm's Always First trait (6.1) resolves a Storm bearer's After-capturing abilities before the
 * victim's When-captured ones, so an attuned Storm bearer steps aside and is guarded before the
 * retaliation arrives; any other bearer resolves them after it (5.3 phase 4). Pawns are not eligible:
 * a sidestep could leave a pawn on its last rank without promoting.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'afterimage',
  name: 'Afterimage',
  version: 1,
  category: 'CAPTURES',
  affinity: 'storm',
  eligible: ['knight', 'bishop', 'rook', 'queen'],
  tags: [],
  minLevel: 5,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.move(target.self(), square.chosen({ near: { of: 'landing', pattern: 'adjacent' } })),
  ],
  attuned: { mode: 'append', effects: [fx.protect(target.self(), 1)] },
  text: {
    short: 'Captures, then sidesteps.',
    rules:
      'After capturing, move to an empty square adjacent to the landing square (you choose). Attuned: the first effect capture targeting this piece this action also fizzles.',
  },
  status: 'PLAYTEST',
});
