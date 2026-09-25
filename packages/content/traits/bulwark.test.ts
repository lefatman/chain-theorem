import { describe, expect, it } from 'vitest';
import { eventsOf, pieceAt, scenario } from '../src/testing.ts';

describe('bulwark', () => {
  it('D-29 the first effect capture targeting a Stone piece fizzles; the next one lands', () => {
    const r = scenario({
      fen: '4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['stone'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5c7'],
    });
    const fizzles = eventsOf(r.events, 'EffectFizzled');
    expect(fizzles.map((f) => f.reason)).toEqual(['bulwark']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('D-29 Bulwark state is public and persistent', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['stone'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
    expect(r.engine.project(r.state, 'black').slices.bulwark).toEqual({ spent: [1] });
  });
});
