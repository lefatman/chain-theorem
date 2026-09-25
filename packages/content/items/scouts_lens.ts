/**
 * Scout's Lens (R-LOAD-002; PLAYTEST). At battle start, reveal the first ability in the opponent's
 * pawn set. The Lens is revealed when it fires (DD-27).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'scouts_lens',
  name: "Scout's Lens",
  version: 1,
  slotCost: 1,
  minLevel: 3,
  hooks: {
    onBattleStart: (ctx) => {
      const owner = ctx.owner;
      if (!owner) return;
      const opp = owner === 'white' ? 'black' : 'white';
      const first = ctx.state.armies[opp].sets.pawn[0];
      ctx.revealSelf('observed');
      if (first) {
        ctx.reveal(opp, { kind: 'ability', pieceType: 'pawn', ability: first }, 'effect', {
          kind: 'item',
          id: 'scouts_lens',
          side: owner,
        });
      }
    },
  },
  text: {
    short: "Reveal the first ability in the opponent's pawn set.",
    rules: "At battle start, reveal the first ability in the opponent's pawn set.",
  },
  status: 'PLAYTEST',
});
