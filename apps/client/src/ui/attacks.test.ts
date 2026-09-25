/** "This square is attacked" hints for newcomers (10.3, R-WORLD-003), from the projection only. */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { parseSquare, type Loadout } from '@chain-theorem/rules';
import { attackHints } from './attacks.ts';

const plain: Loadout = { elements: ['tide'], items: [], sets: [[]] };

function pubFor(fen: string) {
  const { state } = engine.newBattle({
    format: 'full',
    white: { level: 1, loadout: plain },
    black: { level: 1, loadout: plain },
    fen,
  });
  return engine.project(state, 'white');
}

const sq = (s: string) => parseSquare(s);

describe('attack hints (R-WORLD-003)', () => {
  it('R-WORLD-003 marks own pieces the opponent attacks and unsafe destinations', () => {
    // White knight e5 is attacked by the d6 pawn; d7 and f7 are covered by the king, g6 by pawns.
    const pub = pubFor('4k3/5p1p/2pp4/4N3/8/8/8/4K3 w - - 0 1');
    const h = attackHints(pub, plain, sq('e5'));
    expect(h.threatened).toEqual([sq('e5')]);
    expect([...h.unsafeTargets].sort((a, b) => a - b)).toEqual([sq('g6'), sq('d7'), sq('f7')]);
  });

  it('R-WORLD-003 shows nothing once the battle is over', () => {
    const pub = {
      ...pubFor('4k3/8/3p4/4N3/8/8/8/4K3 w - - 0 1'),
      result: { winner: null, reason: 'agreement' as const },
    };
    expect(attackHints(pub, plain, sq('e5'))).toEqual({ threatened: [], unsafeTargets: [] });
  });
});
