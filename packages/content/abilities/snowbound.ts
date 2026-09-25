/**
 * Snowbound (M7 7.3, PLAYTEST): Capturing, Frost, all, 2 charges. When capturing, before the victim
 * is removed, the owner sends one enemy knight, bishop, rook or queen adjacent to the landing square
 * back to its starting square, if empty. Attuned: an enemy pawn may be chosen instead (a pawn's
 * starting square is always a square it may stand on). The charges were added in the M7 balance
 * pass (docs/BALANCE_M7.md): uncharged, it made every Frost capture safe from recapture.
 *
 * Frost is control (6.1). A Capturing ability prepares the capture (CONTENT_GUIDE 3.3): sending a
 * defender home first can leave the captor safe from recapture. The starting square is a fixed
 * selector, so an occupied, burning or unsafe one fizzles (occupied, burning, inv03).
 */
import { NON_KING, defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'snowbound',
  name: 'Snowbound',
  version: 1,
  category: 'CAPTURING',
  affinity: 'frost',
  eligible: 'all',
  tags: [],
  minLevel: 14,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  effects: [
    fx.move(
      target.chosen({
        side: 'enemy',
        types: ['knight', 'bishop', 'rook', 'queen'],
        near: { of: 'landing', pattern: 'adjacent' },
        exclude: ['victim'],
      }),
      square.start(),
    ),
  ],
  attuned: {
    mode: 'replace',
    effects: [
      fx.move(
        target.chosen({
          side: 'enemy',
          types: NON_KING,
          near: { of: 'landing', pattern: 'adjacent' },
          exclude: ['victim'],
        }),
        square.start(),
      ),
    ],
  },
  text: {
    short: 'Sends a defender home first.',
    rules:
      'When capturing, send one enemy knight, bishop, rook or queen next to the landing square back to its starting square, if that square is empty (2 charges). Attuned: an enemy pawn may be sent back instead.',
  },
  status: 'PLAYTEST',
});
