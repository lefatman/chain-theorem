/**
 * Electric Slide (5.8, PLAYTEST; designer brief 2026-10-06, DD-104): Passive, Storm (signature),
 * all. Base, on any army: a pawn may move straight over one adjacent allied piece to the empty square
 * beyond (a plain move: the jumped square is occupied, so it never grants en passant; landing on the
 * last rank promotes). Attuned (Storm pieces, or any piece through the Attunement Charm): a bishop
 * that meets an allied bishop, rook, queen or king may continue from that ally's square in a new
 * direction, once per move; it never stops on the ally and never continues straight or back; a pawn
 * or a knight blocks it like any ally, and rooks and the queen never turn (DD-106: with pawns as
 * corners the opening pawn wall was a launch pad and the queen's turns alone won 97% of First Blood
 * mirror tests; DD-110, the designer's "most balanced version": bishop lines through a knight won
 * 88% of First Blood mirror tests and rook turns 68-70% of Full Battle ones, while bishops at the
 * other pieces read 58% and 64%, the leap alone 57% and 57%; `docs/BALANCE_BASELINE.md` section 9).
 * Attacks and checks follow the same paths, like Flow (R-ELEM-006). The engine reveals the ability
 * on the piece type the first time a leap or a turn is observable (the move itself, a check, a
 * changed legal move). Which sliders turn and which allies are corners are PLAYTEST values in
 * `CAPS.ELECTRIC_SLIDE` (config, never engine code); the text below describes the shipped values.
 */
import { defineAbility, fx, type ReadCtx, type PieceView } from '@chain-theorem/rules/sdk';

const ID = 'electric_slide';

/** May this ally serve as a corner under the configured corner rule (CAPS.ELECTRIC_SLIDE)? */
function corner(ctx: ReadCtx, ally: PieceView): boolean {
  if (ally.type === 'pawn') return false;
  switch (ctx.caps.ELECTRIC_SLIDE.corners) {
    case 'pieces':
      return true;
    case 'no_knights':
      return ally.type !== 'knight';
    case 'moved':
      return ally.square !== ally.start;
  }
}

export default defineAbility({
  id: ID,
  name: 'Electric Slide',
  version: 4,
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
      // The configured sliders turn once (DD-110: bishops; rooks and the queen never).
      redirects: (ctx, slider) =>
        slider.side === ctx.owner &&
        ctx.caps.ELECTRIC_SLIDE.turners.includes(slider.type) &&
        ctx.hasAbility(slider, ID) &&
        ctx.attuned(slider, ID)
          ? 1
          : 0,
      // Pieces conduct the slide, pawns never (DD-106) and knights not either (DD-110); the corner
      // rule is a config knob.
      redirectCorner: (ctx, ally) => ally.side !== ctx.owner || corner(ctx, ally),
    },
  },
  text: {
    short: 'Pawns leap allies; Storm bishops turn at their bishops, rooks, queen and king.',
    rules:
      'Your pawns may move straight over one adjacent allied piece to the empty square beyond. Attuned: your bishops may change direction once at an allied bishop, rook, queen or king in their path, without stopping on it; their attacks follow the same paths. Pawns and knights block them as in chess; rooks and the queen never turn.',
  },
  status: 'PLAYTEST',
});
