/**
 * Obstinate (5.8, PLAYTEST; designer brief 2026-10-06, DD-97; B5 brief 2026-10-11): Passive,
 * neutral, pawn/knight/bishop/rook. This piece cannot be move-captured by an enemy piece of higher
 * rank (5.1: pawn 1 < knight = bishop 2 < rook 3 < queen 4), except by a king: kings ignore it and
 * may move-capture an Obstinate piece of any rank. Effect captures are unaffected. A Stalwart
 * attacker ignores the restriction (DD-102). Costs two ability slots (B5: on its own it scored 89%
 * and 96% in the two formats, docs/BALANCE_BASELINE.md section 5). Queens and kings are not
 * eligible (DD-116): nothing but a king outranks a queen and kings ignore the card, so on either it
 * could never change a capture and would only waste two slots. The engine reveals it the first time
 * it changes which captures are legal (DD-99).
 */
import { defineAbility, fx, pieceRank } from '@chain-theorem/rules/sdk';

const ID = 'obstinate';

export default defineAbility({
  id: ID,
  name: 'Obstinate',
  version: 3,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: ['pawn', 'knight', 'bishop', 'rook'],
  tags: [],
  minLevel: 9,
  slotCost: 2,
  limits: { perAction: 1 },
  effects: [fx.modifyRule(ID)],
  hooks: {
    moveFilter: {
      captureFilter: (ctx, victim) => {
        if (victim.side !== ctx.owner || !ctx.hasAbility(victim, ID)) return null;
        const rank = pieceRank(victim.type);
        // Kings ignore it (B5): a king may move-capture an Obstinate piece of any rank.
        const attackers = ctx
          .pieces(victim.side === 'white' ? 'black' : 'white')
          .filter((p) => p.type !== 'king' && pieceRank(p.type) > rank)
          .map((p) => p.id);
        return attackers.length > 0 ? { attackers } : null;
      },
    },
  },
  text: {
    short: 'Too stubborn to fall to its betters.',
    rules:
      'This piece cannot be captured by a move of an enemy piece of higher rank (pawn, then knight and bishop, rook, queen); kings ignore it. Effect captures still remove it.',
  },
  status: 'PLAYTEST',
});
