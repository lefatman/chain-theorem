/**
 * Reliquary (R-LOAD-002; PLAYTEST; designer brief 2026-10-09, plan item C7; DD-127). The first piece
 * its owner loses this battle returns to its starting square at the end of the opponent's next turn,
 * if that square is empty. One payout: it is spent whether the return succeeds or fizzles (occupied,
 * INV-03 for the acting player's king, a burning square, Warden's Stopwatch), and it stays armed while
 * the piece is back on the board by other means (Rebirth), for that same piece. A piece lost during
 * the owner's own turn (Poisoned Meat, Riposte) returns at the end of the opponent's following turn.
 *
 * The return is the engine's hook-level revive (`ctx.revive`, DD-127): the same intercepts as a REVIVE
 * effect, `PieceRevived` with this item as source, or `EffectFizzled` naming the reason and this item
 * (hidden from the opponent until the item is known). On the throwaway drafts that legal-move
 * generation runs `onTurnEnd` on, `ctx.revive` answers `unavailable` and the hook changes nothing.
 * Revealed when a piece returns (the opponent sees it). The slice is private: a projected slice keyed
 * by the item's id would tell the opponent the item is worn (R-SEC-001), so neither the first loss
 * nor the `used` flag is shown to anyone; the NPC infers "unused" from "no piece lost yet".
 */
import { defineItem } from '@chain-theorem/rules/sdk';
import { type PieceId, type Side, opposite } from '@chain-theorem/rules';

export interface ReliquaryState {
  /** The first piece each side lost this battle (private). */
  lost: Record<Side, PieceId | null>;
  /** Whether the payout has been attempted (private too). */
  used: Record<Side, boolean>;
}
const ID = 'reliquary';

export default defineItem({
  id: ID,
  name: 'Reliquary',
  version: 1,
  slotCost: 1,
  minLevel: 12,
  hooks: {
    stateSlice: {
      id: ID,
      init: (): ReliquaryState => ({
        lost: { white: null, black: null },
        used: { white: false, black: false },
      }),
    },
    // Remember the first loss (move or effect capture).
    onEvent: (ctx, ev) => {
      const owner = ctx.owner;
      if (!owner || ev.k !== 'Captured' || ev.victimSide !== owner) return;
      const s = ctx.slice<ReliquaryState>(ID);
      if (s.lost[owner] !== null) return;
      ctx.setSlice<ReliquaryState>({ ...s, lost: { ...s.lost, [owner]: ev.victim } });
    },
    // At the end of the opponent's turn, the first lost piece returns to its start, once.
    onTurnEnd: (ctx, { side }) => {
      const owner = ctx.owner;
      if (!owner || side !== opposite(owner)) return;
      const s = ctx.slice<ReliquaryState>(ID);
      const id = s.lost[owner];
      if (id === null || s.used[owner]) return;
      const piece = ctx.piece(id);
      // Back by other means (Rebirth): nothing to do, the payout stays armed for this piece.
      if (piece.square >= 0) return;
      const result = ctx.revive(id, piece.start);
      if (result === 'unavailable') return; // a draft: change nothing
      ctx.setSlice<ReliquaryState>({ ...s, used: { ...s.used, [owner]: true } });
      if (result === 'revived') ctx.revealSelf('observed');
    },
  },
  text: {
    short: 'Your first loss comes back, once.',
    rules:
      "The first piece you lose this battle returns to its starting square at the end of your opponent's next turn, if that square is empty. Once.",
  },
  status: 'PLAYTEST',
});
