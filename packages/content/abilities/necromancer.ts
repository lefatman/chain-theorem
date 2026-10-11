/**
 * Necromancer (5.8, PLAYTEST; designer brief 2026-10-06, DD-97, DD-103): Captures, neutral, all,
 * revive, 1 charge. After capturing a victim of equal or higher rank than this piece, revive one
 * of your captured pieces of rank at most this piece's (never a king): on its starting square if
 * that is empty, otherwise on any empty square of your back rank. The `revive` tag puts it under
 * Warden's Stopwatch (D-39); Overabundance adds a charge on a Grove piece.
 */
import { defineAbility, fx, NON_KING, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'necromancer',
  name: 'Necromancer',
  version: 1,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['revive'],
  minLevel: 11,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ rank: { of: 'victim', cmp: '>=', to: 'captor' } }],
  effects: [
    fx.revive(
      target.chosenCaptured({
        side: 'friendly',
        types: NON_KING,
        rank: { cmp: '<=', to: 'captor' },
      }),
      square.startElse({ backRank: true }),
    ),
  ],
  text: {
    short: 'A worthy kill raises a fallen ally.',
    rules:
      'After capturing a piece of equal or higher rank than this piece, revive one of your captured pieces of equal or lower rank than this piece: on its starting square if empty, otherwise on any empty square of your back rank (1 charge).',
  },
  status: 'PLAYTEST',
});
