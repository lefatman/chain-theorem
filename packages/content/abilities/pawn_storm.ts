/**
 * Pawn Storm (M7 7.3, PLAYTEST): Captures, Storm, pawn, replay. Bonus action: this pawn may make one
 * non-capturing move (a push, which may promote, DD-31). Attuned: any friendly pawn may make the
 * move instead. Storm tempo (6.1) for the smallest pieces; a pawn that promotes while capturing uses
 * its new type's set, so this no longer fires for it (R-RULES-002).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'pawn_storm',
  name: 'Pawn Storm',
  version: 1,
  category: 'CAPTURES',
  affinity: 'storm',
  eligible: ['pawn'],
  tags: ['replay'],
  minLevel: 7,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.bonusAction({ movers: 'self', capture: 'none', optional: true })],
  attuned: {
    mode: 'replace',
    effects: [fx.bonusAction({ movers: 'selfOrFriendlyPawn', capture: 'none', optional: true })],
  },
  text: {
    short: 'A capturing pawn pushes on.',
    rules:
      'After capturing, this pawn may make one move that does not capture. Attuned: any of your pawns may make the move instead.',
  },
  status: 'PLAYTEST',
});
