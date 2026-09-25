/**
 * Stalwart (5.7, R-RULES-003 behaviour COMMITTED): Passive, neutral, king. The king cannot be
 * checkmated but still triggers the check alert; its owner may leave it in check, move it into
 * attacked squares and castle through or into attacked squares. It can only be captured by a piece
 * making a move (Royal Immunity), which ends the battle after the chain resolves.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'stalwart',
  name: 'Stalwart',
  version: 1,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: ['king'],
  tags: [],
  minLevel: 16,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.modifyRule('stalwart_king')],
  hooks: {
    moveFilter: {
      kingMode: (ctx, king) =>
        king.side === ctx.owner && ctx.hasAbility(king, 'stalwart') ? 'stalwart' : undefined,
    },
  },
  text: {
    short: 'A king that cannot be checkmated.',
    rules:
      'Your king cannot be checkmated. You may leave it in check. It falls only when a piece captures it with a move, which ends the battle.',
  },
  status: 'COMMITTED',
});
