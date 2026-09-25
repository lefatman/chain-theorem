/**
 * Cleave (5.7, PLAYTEST): Captures, Ember, all. Effect-capture one enemy pawn diagonally adjacent to
 * the landing square. Attuned: may pick an orthogonally adjacent pawn instead.
 */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'cleave',
  name: 'Cleave',
  version: 1,
  category: 'CAPTURES',
  affinity: 'ember',
  eligible: 'all',
  tags: [],
  minLevel: 6,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.effectCapture(
      target.chosen({ side: 'enemy', types: ['pawn'], near: { of: 'self', pattern: 'diagonal' } }),
    ),
  ],
  attuned: {
    mode: 'replace',
    effects: [
      fx.effectCapture(
        target.chosen({
          side: 'enemy',
          types: ['pawn'],
          near: { of: 'self', pattern: 'adjacent' },
        }),
      ),
    ],
  },
  text: {
    short: 'Cuts down a nearby pawn.',
    rules:
      'After capturing, effect-capture one enemy pawn diagonally adjacent to the landing square. Attuned: may pick an orthogonally adjacent pawn instead.',
  },
  status: 'PLAYTEST',
});
