import { describe, expect, it } from 'vitest';
import { eventsOf, pieceAt, scenario } from '../src/testing.ts';

describe('stillness', () => {
  it('D-29 a piece that captures a Frost piece has its Captures abilities negated', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['storm'], abilities: ['hit_and_run'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    const neg = eventsOf(r.events, 'AbilityNegated');
    expect(neg.map((e) => [e.ability, e.source])).toEqual([
      ['hit_and_run', { kind: 'trait', id: 'stillness', element: 'frost' }],
    ]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
  });

  it('D-29 capturing a non-Frost piece leaves Captures abilities alone', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      // Tide is in the other triangle, so nothing is silenced (6.2).
      white: { elements: ['storm'], abilities: ['hit_and_run'] },
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([]);
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
  });
});
