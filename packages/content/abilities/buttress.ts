/**
 * Buttress (M7 7.3, PLAYTEST): Capturing, Stone, all. When capturing, the owner chooses one of its
 * other pieces (not the king, which Royal Immunity already guards) adjacent to the landing square:
 * every effect capture targeting it this action fizzles. Attuned: the first effect capture targeting
 * this piece this action also fizzles.
 *
 * Stone is protection (6.1, R-ELEM-001). The retaliations it answers resolve in the same action:
 * Backdraft-style captures of pieces next to the capture square, and (attuned) a Poisoned-Meat-style
 * capture of the captor. PROTECT is checked last among intercepts (DD-35), so a Stone piece's
 * Bulwark is spent first.
 */
import { NON_KING, defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'buttress',
  name: 'Buttress',
  version: 1,
  category: 'CAPTURING',
  affinity: 'stone',
  eligible: 'all',
  tags: [],
  minLevel: 2,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [
    fx.protect(
      target.chosen({
        side: 'friendly',
        types: NON_KING,
        near: { of: 'landing', pattern: 'adjacent' },
        exclude: ['self'],
      }),
      'all',
    ),
  ],
  attuned: { mode: 'append', effects: [fx.protect(target.self(), 1)] },
  text: {
    short: 'Shields a neighbour from retaliation.',
    rules:
      'When capturing, choose one of your other pieces adjacent to the landing square: every effect capture targeting it this action fizzles. Attuned: the first effect capture targeting this piece this action also fizzles.',
  },
  status: 'PLAYTEST',
});
