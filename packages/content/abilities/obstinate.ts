/**
 * Obstinate (5.8, PLAYTEST; designer brief 2026-10-06, DD-97): Passive, neutral, all. This piece
 * cannot be move-captured by an enemy piece of higher rank (5.1: pawn 1 < knight = bishop 2 < rook 3
 * < queen 4 < king 5). Effect captures are unaffected. A Stalwart attacker ignores the restriction
 * (DD-102). The engine reveals it the first time it changes which captures are legal (DD-99).
 */
import { defineAbility, fx, pieceRank } from '@chain-theorem/rules/sdk';

const ID = 'obstinate';

export default defineAbility({
  id: ID,
  name: 'Obstinate',
  version: 1,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 9,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.modifyRule(ID)],
  hooks: {
    moveFilter: {
      captureFilter: (ctx, victim) => {
        if (victim.side !== ctx.owner || !ctx.hasAbility(victim, ID)) return null;
        const rank = pieceRank(victim.type);
        const attackers = ctx
          .pieces(victim.side === 'white' ? 'black' : 'white')
          .filter((p) => pieceRank(p.type) > rank)
          .map((p) => p.id);
        return attackers.length > 0 ? { attackers } : null;
      },
    },
  },
  text: {
    short: 'Too stubborn to fall to its betters.',
    rules:
      'This piece cannot be captured by a move of an enemy piece of higher rank (pawn, then knight and bishop, rook, queen, king). Effect captures still remove it.',
  },
  status: 'PLAYTEST',
});
