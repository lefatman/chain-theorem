/**
 * Electric Slide (5.8, PLAYTEST; designer brief 2026-10-06, DD-104): Passive, Storm (signature),
 * all. Base, on any army: a pawn may move straight over one adjacent allied piece to the empty square
 * beyond (a plain move: the jumped square is occupied, so it never grants en passant; landing on the
 * last rank promotes). Attuned (Storm pieces, or any piece through the Attunement Charm): a sliding
 * piece that meets an ally may continue from the ally's square in a new direction, once per move, the
 * queen twice; it never stops on the ally and never continues straight or back. Attacks and checks
 * follow the same paths, like Flow (R-ELEM-006). The engine reveals the ability on the piece type
 * the first time a leap or a turn is observable (the move itself, a check, a changed legal move).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

const ID = 'electric_slide';

export default defineAbility({
  id: ID,
  name: 'Electric Slide',
  version: 1,
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
      redirects: (ctx, slider) =>
        slider.side === ctx.owner && ctx.hasAbility(slider, ID) && ctx.attuned(slider, ID)
          ? slider.type === 'queen'
            ? 2
            : 1
          : 0,
    },
  },
  text: {
    short: 'Pawns leap allies; Storm sliders turn at them.',
    rules:
      'Your pawns may move straight over one adjacent allied piece to the empty square beyond. Attuned: your rooks, bishops and queen may change direction at an allied piece in their path, once per move (the queen twice), without stopping on it; their attacks follow the same paths.',
  },
  status: 'PLAYTEST',
});
