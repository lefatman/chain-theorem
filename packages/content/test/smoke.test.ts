import { describe, expect, it } from 'vitest';
import { scenario, pieceAt } from '../src/testing.ts';

describe('smoke', () => {
  it('E1 knight with Hit and Run captures a Poisoned Meat pawn', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['hit_and_run'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    console.log(r.events.map((e) => JSON.stringify(e)).join('\n'));
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
  });
});
