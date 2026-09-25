/**
 * Veil (5.7, R-INFO-002, PLAYTEST): Passive, neutral, all. This piece's abilities are not named when
 * they activate, are silenced, negated or fizzle; only the effect is shown (DD-28).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'veil',
  name: 'Veil',
  version: 1,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 18,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.modifyRule('veil')],
  hooks: {
    revealFilter: {
      reveal: (ctx, req) =>
        req.piece !== undefined && req.piece.side === ctx.owner && ctx.hasAbility(req.piece, 'veil')
          ? 'hide'
          : 'allow',
    },
  },
  text: {
    short: 'Its abilities act unnamed.',
    rules:
      "This piece's abilities are not named when they activate; your opponent sees only the effect.",
  },
  status: 'PLAYTEST',
});
