/**
 * "This square is attacked" hints for new players (10.3, R-WORLD-003). Attacks are computed from the
 * viewer's projection only: the belief state holds the viewer's own loadout plus what has been
 * revealed about the opponent (the same construction as move previews, 8.4), so a hint never
 * depends on hidden information (R-INFO-005). Hidden movement abilities can still surprise.
 */
import { engine } from '@chain-theorem/content';
import { mFrom, mTo, type Loadout, type PublicState } from '@chain-theorem/rules';

export interface AttackHints {
  /** Squares of the viewer's pieces that the opponent attacks now. */
  threatened: number[];
  /** Destinations of the selected piece where it would stand attacked after moving. */
  unsafeTargets: number[];
}

const EMPTY: AttackHints = { threatened: [], unsafeTargets: [] };

export function attackHints(pub: PublicState, own: Loadout, selected: number | null): AttackHints {
  if (pub.result) return EMPTY;
  try {
    const pos = engine.position(engine.beliefState(pub, own));
    const me = pub.viewer === 'white' ? 0 : 1;
    const them = me ^ 1;
    const threatened: number[] = [];
    for (const p of pub.pieces) {
      if (p.side === pub.viewer && p.square >= 0 && pos.attacked(p.square, them))
        threatened.push(p.square);
    }
    const unsafeTargets: number[] = [];
    if (selected !== null && pub.turn === pub.viewer && !pub.pending) {
      for (const m of pos.legal(me)) {
        if (mFrom(m) !== selected) continue;
        const to = mTo(m);
        if (unsafeTargets.includes(to)) continue;
        const undo = pos.make(m);
        if (pos.attacked(to, them)) unsafeTargets.push(to);
        pos.unmake(undo);
      }
    }
    return { threatened, unsafeTargets };
  } catch {
    // A projection the belief builder cannot model (should not happen) just shows no hints.
    return EMPTY;
  }
}
