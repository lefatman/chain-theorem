/**
 * Scout's Lens (R-LOAD-002; PLAYTEST; B5 brief 2026-10-11). At battle start, reveal the opponent's
 * whole pawn set: every ability in it, in the set's order, and the pawn type reads complete (the
 * engine's `set` reveal, the one Scout and Last Word use). The Lens is revealed when it fires
 * (DD-27). An explicit reveal, so it names veiled abilities (DD-28). Until B5 it revealed only the
 * first ability of the set.
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'scouts_lens',
  name: "Scout's Lens",
  version: 2,
  slotCost: 1,
  minLevel: 3,
  hooks: {
    onBattleStart: (ctx) => {
      const owner = ctx.owner;
      if (!owner) return;
      const opp = owner === 'white' ? 'black' : 'white';
      ctx.revealSelf('observed');
      // The whole set, in order; an empty set is revealed as complete too (the pawns carry nothing).
      ctx.reveal(
        opp,
        { kind: 'set', pieceType: 'pawn', abilities: [...ctx.state.armies[opp].sets.pawn] },
        'effect',
        { kind: 'item', id: 'scouts_lens', side: owner },
      );
    },
  },
  text: {
    short: "Reveal the opponent's whole pawn set.",
    rules: "At battle start, reveal every ability in the opponent's pawn set.",
  },
  status: 'PLAYTEST',
});
