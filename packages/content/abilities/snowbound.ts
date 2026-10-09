/**
 * Snowbound (M7 7.3, PLAYTEST; neutral since DD-98): Capturing, neutral, all, 2 charges. When
 * capturing, before the victim is removed, the owner sends one enemy knight, bishop, rook or queen
 * adjacent to the landing square back to its starting square, if empty. The attuned option of
 * sending an enemy pawn home was dropped by DD-98; the card has no affinity and no attuned version.
 * The charges were added in the M7 balance pass (docs/BALANCE_M7.md): uncharged, it made every
 * capture safe from recapture.
 *
 * A Capturing ability prepares the capture (CONTENT_GUIDE 3.3): sending a defender home first can
 * leave the captor safe from recapture. The starting square is a fixed selector, so an occupied,
 * burning or unsafe one fizzles (occupied, burning, inv03).
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'snowbound',
  name: 'Snowbound',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
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
  text: {
    short: 'Sends a defender home first.',
    rules:
      'When capturing, send one enemy knight, bishop, rook or queen next to the landing square back to its starting square, if that square is empty (2 charges).',
  },
  status: 'PLAYTEST',
});
