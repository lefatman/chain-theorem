/**
 * Electric Slide (5.8, PLAYTEST; designer brief 2026-10-06, DD-104; designer rule 2026-10-09,
 * DD-111): Passive, Storm (signature), all. Base, on any army: a pawn may move straight over one
 * adjacent allied piece to the empty square beyond (a plain move: the jumped square is occupied, so
 * it never grants en passant; landing on the last rank promotes). Attuned (Storm pieces, or any
 * piece through the Attunement Charm): a rook or bishop that meets an allied piece of equal or
 * higher rank than itself (5.1, DD-97: pawn < knight = bishop < rook < queen) may continue from that
 * ally's square in a new direction, once per move; the queen may do so twice, at an allied rook or
 * bishop; the king is never a corner and nothing turns at a pawn. A slider never stops on the ally
 * and never continues straight or back; an ally that is not a corner for it blocks it as in chess.
 * Attacks and checks follow the same paths, like Flow (R-ELEM-006). The engine reveals the ability
 * on the piece type the first time a leap or a turn is observable (the move itself, a check, a
 * changed legal move). DD-106 (pawns never conduct, the queen's turns were cut) and DD-110 (a
 * bishops-only turn) are the measured history behind the designer's rule.
 */
import { defineAbility, fx, pieceRank, type PieceView } from '@chain-theorem/rules/sdk';
import type { PieceType } from '@chain-theorem/rules';

const ID = 'electric_slide';

/** May `ally` serve as a corner for a turning slider of type `slider` (DD-111)? */
export function slideCorner(ally: PieceView, slider: PieceType): boolean {
  if (ally.type === 'king' || ally.type === 'pawn') return false;
  if (slider === 'queen') return ally.type === 'rook' || ally.type === 'bishop';
  return pieceRank(ally.type) >= pieceRank(slider);
}

export default defineAbility({
  id: ID,
  name: 'Electric Slide',
  version: 5,
  category: 'PASSIVE',
  affinity: 'storm',
  eligible: 'all',
  tags: [],
  minLevel: 3,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.modifyRule('electric_slide_leap')],
  attuned: { mode: 'append', effects: [fx.modifyRule('electric_slide_redirect')] },
  hooks: {
    moveFilter: {
      pawnLeap: (ctx, pawn) => pawn.side === ctx.owner && ctx.hasAbility(pawn, ID),
      // Rooks and bishops turn once, the queen twice (DD-111).
      redirects: (ctx, slider) =>
        slider.side === ctx.owner && ctx.hasAbility(slider, ID) && ctx.attuned(slider, ID)
          ? slider.type === 'queen'
            ? 2
            : 1
          : 0,
      // Corners by rank: an ally of equal or higher rank than the slider, never the king or a pawn;
      // the queen's corners are rooks and bishops (DD-111).
      redirectCorner: (ctx, ally, slider) => ally.side !== ctx.owner || slideCorner(ally, slider),
    },
  },
  text: {
    short: 'Pawns leap allies; Storm sliders turn at allies of their rank or higher.',
    rules:
      'Your pawns may move straight over one adjacent allied piece to the empty square beyond. Attuned: your rooks and bishops may change direction once at an allied piece of equal or higher rank in their path (a rook at a rook or queen; a bishop at a knight, bishop, rook or queen), and your queen may change direction twice, at allied rooks and bishops; none stops on the ally, nothing turns at a pawn or at the king, and their attacks follow the same paths.',
  },
  status: 'PLAYTEST',
});
