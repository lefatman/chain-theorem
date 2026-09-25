import { describe, expect, it } from 'vitest';
import { eventsOf, scenario } from '../src/testing.ts';

describe('always_first', () => {
  it("D-28 R-ELEM-001 Storm abilities resolve before the victim's reactions", () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      // Tide is in the other triangle: no silence either way (6.2).
      white: { elements: ['storm'], abilities: ['cleave'] },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const order = eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability);
    expect(order).toEqual(['cleave', 'last_word']);
  });

  it('D-28 without Storm the victim side resolves first (5.4)', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'], abilities: ['cleave'] },
      black: { elements: ['stone'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'last_word',
      'cleave',
    ]);
  });
});
