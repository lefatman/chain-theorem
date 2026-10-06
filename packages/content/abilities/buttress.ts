/**
 * Buttress (M7 7.3, PLAYTEST; neutral since DD-98): Capturing, neutral, all. When capturing, the
 * owner chooses one of its other pieces (not the king, which Royal Immunity already guards) adjacent
 * to the landing square: every effect capture targeting it this action fizzles. The first effect
 * capture targeting this piece this action also fizzles. The self-guard was the attuned bonus until
 * DD-98 folded it into the base; the card has no affinity and no attuned version.
 *
 * The retaliations it answers resolve in the same action: Backdraft-style captures of pieces next
 * to the capture square and a Poisoned-Meat-style capture of the captor. PROTECT is checked last
 * among intercepts (DD-35), so a Stone bearer's Bulwark (6.1) is spent first.
 */
import { NON_KING, defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'buttress',
  name: 'Buttress',
  version: 2,
  category: 'CAPTURING',
  affinity: 'neutral',
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
    fx.protect(target.self(), 1),
  ],
  text: {
    short: 'Shields a neighbour from retaliation.',
    rules:
      'When capturing, choose one of your other pieces adjacent to the landing square: every effect capture targeting it this action fizzles. The first effect capture targeting this piece this action also fizzles.',
  },
  status: 'PLAYTEST',
});
