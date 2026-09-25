/**
 * Hot Foot — Ember trait (R-ELEM-005, D-40, COMMITTED).
 * A move capture by an Ember piece leaves a pending burn on its landing square. When that piece
 * leaves the square for any reason other than being captured, the square ignites: until the igniting
 * player's opponent has taken 3 turns, no non-Ember piece may move to or capture on it. Sliders may
 * pass over it. Effects cannot place a non-Ember piece there. Burning squares are public state.
 */
import { defineTrait } from '@chain-theorem/rules/sdk';
import type { Side } from '@chain-theorem/rules';
import { HOT_FOOT_TURNS } from '../config.ts';

export interface Burn {
  sq: number;
  /** The igniting player. */
  side: Side;
  /** Opponent turns left. */
  turns: number;
}
export interface HotFootState {
  burning: Burn[];
  pending: { piece: number; sq: number }[];
}

const ID = 'hot_foot';

export default defineTrait({
  id: ID,
  name: 'Hot Foot',
  element: 'ember',
  version: 1,
  hooks: {
    stateSlice: {
      id: ID,
      init: (): HotFootState => ({ burning: [], pending: [] }),
      // Public: drawn on the board and part of the repetition hash (R-ELEM-005).
      project: (value) => value,
    },
    moveFilter: {
      blockedSquares: (ctx, piece) => {
        if (piece.element === 'ember') return null;
        const s = ctx.slice<HotFootState>(ID);
        return s.burning.length > 0 ? s.burning.map((b) => b.sq) : null;
      },
    },
    effectIntercept: (ctx, eff) => {
      if (eff.kind === 'effectCapture' || eff.to === undefined || eff.target.element === 'ember')
        return 'allow';
      const s = ctx.slice<HotFootState>(ID);
      return s.burning.some((b) => b.sq === eff.to) ? { fizzle: 'burning' } : 'allow';
    },
    onPieceMoved: (ctx, m) => {
      const s = ctx.slice<HotFootState>(ID);
      let burning = s.burning;
      let pending = s.pending;
      const pend = pending.find((p) => p.piece === m.piece.id);
      if (pend && m.from === pend.sq && m.to !== pend.sq) {
        // Leaving the square ignites it; re-igniting a burning square resets its count.
        pending = pending.filter((p) => p !== pend);
        burning = [
          ...burning.filter((b) => b.sq !== pend.sq),
          { sq: pend.sq, side: m.piece.side, turns: HOT_FOOT_TURNS },
        ];
        ctx.emit({
          k: 'SquareIgnited',
          square: pend.sq,
          side: m.piece.side,
          turns: HOT_FOOT_TURNS,
        });
      }
      if (m.capture && m.piece.element === 'ember' && (m.cause === 'move' || m.cause === 'bonus')) {
        pending = [
          ...pending.filter((p) => p.piece !== m.piece.id),
          { piece: m.piece.id, sq: m.to },
        ];
      }
      if (burning !== s.burning || pending !== s.pending)
        ctx.setSlice<HotFootState>({ burning, pending });
    },
    onEvent: (ctx, ev) => {
      // Being captured on the square does not ignite it; the pending burn is gone.
      if (ev.k !== 'Captured') return;
      const s = ctx.slice<HotFootState>(ID);
      if (s.pending.some((p) => p.piece === ev.victim)) {
        ctx.setSlice<HotFootState>({
          ...s,
          pending: s.pending.filter((p) => p.piece !== ev.victim),
        });
      }
    },
    onTurnEnd: (ctx, { side }) => {
      const s = ctx.slice<HotFootState>(ID);
      if (s.burning.length === 0) return;
      const burning: Burn[] = [];
      for (const b of s.burning) {
        if (b.side === side) {
          burning.push(b);
          continue;
        }
        const turns = b.turns - 1;
        if (turns > 0) burning.push({ ...b, turns });
        else ctx.emit({ k: 'SquareExtinguished', square: b.sq });
      }
      ctx.setSlice<HotFootState>({ ...s, burning });
    },
  },
  text: {
    short: 'Squares it captured on burn after it leaves.',
    rules:
      'After an Ember piece captures with a move, that square burns once the piece moves off it. Until your opponent has taken 3 turns, no non-Ember piece can move to or capture on it. Sliding pieces may pass over it.',
  },
  status: 'COMMITTED',
});
