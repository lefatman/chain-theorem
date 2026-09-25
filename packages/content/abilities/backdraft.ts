/**
 * Backdraft (5.7, PLAYTEST): Captured, Ember, all. Effect-capture one enemy pawn adjacent to this
 * square, other than the captor. Attuned: may target an adjacent knight or bishop instead.
 */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'backdraft',
  name: 'Backdraft',
  version: 1,
  category: 'CAPTURED',
  affinity: 'ember',
  eligible: 'all',
  tags: [],
  minLevel: 4,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.effectCapture(
      target.chosen({
        side: 'enemy',
        types: ['pawn'],
        near: { of: 'self', pattern: 'adjacent' },
        exclude: ['captor'],
      }),
    ),
  ],
  attuned: {
    mode: 'replace',
    effects: [
      fx.effectCapture(
        target.chosen({
          side: 'enemy',
          types: ['pawn', 'knight', 'bishop'],
          near: { of: 'self', pattern: 'adjacent' },
          exclude: ['captor'],
        }),
      ),
    ],
  },
  text: {
    short: 'Burns an adjacent enemy pawn as it falls.',
    rules:
      'When captured, effect-capture one enemy pawn adjacent to this square, other than the captor. Attuned: may target an adjacent knight or bishop instead.',
  },
  status: 'PLAYTEST',
});
