import { describe, expect, it } from 'vitest';
import { creatureName, creatures } from './creatures.ts';
import { ELEMENTS, PIECE_TYPES } from './sprites.ts';

/**
 * Kept guard for R-ART-003. The full check (every name against all 1,025 Pokémon species: no
 * match, no species name inside a name, edit distance >= 3) was run when the names were chosen;
 * this list keeps the nearest species and the most famous ones so a rename cannot drift into them.
 */
const DENY = [
  'rowlet',
  'budew',
  'marill',
  'kingler',
  'cinderace',
  'coalossal',
  'nymble',
  'dwebble',
  'sobble',
  'rufflet',
  'sunflora',
  'mareep',
  'boldore',
  'voltorb',
  'zapdos',
  'primeape',
  'floette',
  'azurill',
  'crustle',
  'shellder',
  'thundurus',
  'ironcrown',
  'pikachu',
  'charmander',
  'squirtle',
  'bulbasaur',
  'eevee',
  'flareon',
  'glaceon',
  'vulpix',
  'ponyta',
  'geodude',
  'snorunt',
  'pichu',
  'mew',
];

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] ?? 0;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] ?? 0;
      d[j] = Math.min((d[j] ?? 0) + 1, (d[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] ?? 0;
}

describe('creature manifest (R-ART-001, R-ART-003)', () => {
  it('R-ART-001 lists 36 creatures: one per element and piece type', () => {
    expect(creatures).toHaveLength(36);
    for (const el of ELEMENTS) {
      for (const type of PIECE_TYPES) {
        expect(creatures.filter((c) => c.element === el && c.type === type)).toHaveLength(1);
      }
    }
  });

  it('R-ART-003 names are unique, original and not Pokémon names or look-alikes', () => {
    const names = creatures.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      const low = n.toLowerCase();
      expect(low).toMatch(/^[a-z]+$/);
      for (const p of DENY) {
        expect(low.includes(p), `${n} contains ${p}`).toBe(false);
        expect(lev(low, p), `${n} vs ${p}`).toBeGreaterThanOrEqual(3);
      }
      expect(low.includes('ball')).toBe(false);
    }
  });

  it('R-ART-003 creatureName covers every piece, with neutral training dummies', () => {
    expect(creatureName('king', 'ember')).toBe('Coalcrown');
    expect(creatureName('pawn', 'neutral')).toBe('Training Pawn');
    for (const c of creatures) expect(creatureName(c.type, c.element)).toBe(c.name);
  });
});
