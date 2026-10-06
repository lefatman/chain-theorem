/**
 * Backdraft (5.7, PLAYTEST): Captured, neutral, all. Effect-capture one enemy pawn, knight or bishop
 * adjacent to this square, other than the captor. Neutral since DD-98: the former Ember Attuned
 * bonus (knights and bishops as targets) is folded into the base and there is no Attuned version.
 */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'backdraft',
  name: 'Backdraft',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 4,
  slotCost: 1,
  limits: { perAction: 1 },
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
  text: {
    short: 'Burns an adjacent enemy as it falls.',
    rules:
      'When captured, effect-capture one enemy pawn, knight or bishop adjacent to this square, other than the captor.',
  },
  status: 'PLAYTEST',
});
