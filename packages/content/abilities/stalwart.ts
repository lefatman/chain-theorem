/**
 * Stalwart (5.7 and 5.8, R-RULES-003; king behaviour COMMITTED, piece-level rules PLAYTEST per the
 * designer brief 2026-10-06, DD-102): Passive, neutral, all.
 *
 * On the king (4.3, unchanged): it cannot be checkmated but still triggers the check alert; its
 * owner may leave it in check, move it into attacked squares and castle through or into attacked
 * squares. It can only be captured by a piece making a move (Royal Immunity), which ends the battle
 * after the chain resolves.
 *
 * On any piece (DD-102): (1) it cannot be removed by an effect capture unless the effect carries the
 * `venom` tag (Poisoned Meat); a move capture always works. (2) It ignores passive restrictions on
 * its own moves and captures (Obstinate, burning squares and later soft restrictions), but not
 * Block Path. (3) A set holding Stalwart holds no CAPTURING or CAPTURES ability (loadout rule 8).
 * (4) On the king it also uses one item slot (loadout rule 9, designer decision 2026-10-09,
 * DD-109): a king that has to be caught rather than mated is paid for in the same currency as
 * Blended Family or a utility item, whichever archetype fields it.
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

const ID = 'stalwart';

export default defineAbility({
  id: ID,
  name: 'Stalwart',
  version: 3,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 16,
  slotCost: 1,
  // Rule 9 (DD-109): in the king's set it also uses one item slot.
  kingItemSlots: 1,
  limits: { perAction: 1 },
  effects: [fx.modifyRule('stalwart_king'), fx.modifyRule('stalwart_piece')],
  excludes: { categories: ['CAPTURING', 'CAPTURES'] },
  hooks: {
    moveFilter: {
      kingMode: (ctx, king) =>
        king.side === ctx.owner && ctx.hasAbility(king, ID) ? 'stalwart' : undefined,
      bypass: (ctx, piece) => piece.side === ctx.owner && ctx.hasAbility(piece, ID),
    },
    effectIntercept: (ctx, eff) => {
      if (eff.kind !== 'effectCapture') return 'allow';
      if (eff.target.side !== ctx.owner || !ctx.hasAbility(eff.target, ID)) return 'allow';
      const src = eff.source;
      if (src.kind === 'ability') {
        const def = ctx.registry.abilities.find((a) => a.id === src.id);
        if (def?.tags.includes('venom')) return 'allow';
      }
      return { fizzle: 'stalwart_guard' };
    },
  },
  text: {
    short: 'Unyielding: only a move or venom removes it.',
    rules:
      'This piece cannot be removed by an effect, except Poisoned Meat; only a capturing move takes it. It ignores restrictions on its moves and captures from passive abilities and burning squares, but not Block Path. It cannot share a set with Capturing or Captures abilities. A Stalwart king cannot be checkmated: you may leave it in check, and it falls only when a piece captures it with a move, which ends the battle. On the king it also uses one of your item slots.',
  },
  status: 'COMMITTED',
});
