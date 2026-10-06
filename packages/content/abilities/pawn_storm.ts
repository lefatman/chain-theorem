/**
 * Pawn Storm (M7 7.3, PLAYTEST): Captures, neutral, pawn, replay. Bonus action: this pawn may make
 * one non-capturing move (a push, which may promote, DD-31). Neutral since DD-98: the former Storm
 * Attuned bonus (any friendly pawn could make the move instead) is dropped and there is no Attuned
 * version. Tempo for the smallest pieces; a pawn that promotes while capturing uses its new type's
 * set, so this no longer fires for it (R-RULES-002).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'pawn_storm',
  name: 'Pawn Storm',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: ['pawn'],
  tags: ['replay'],
  minLevel: 7,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'self', capture: 'none', optional: true })],
  text: {
    short: 'A capturing pawn pushes on.',
    rules: 'After capturing, this pawn may make one move that does not capture.',
  },
  status: 'PLAYTEST',
});
