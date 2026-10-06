import { describe, expect, it } from 'vitest';
import { ARMY_STYLES, armyStylesFor, unitName, units } from './army.ts';
import { PIECE_TYPES } from './sprites.ts';

/**
 * Kept guard for R-ART-003: the nearest Pokémon species and the most famous ones, so a rename
 * cannot drift into them (the full species list was checked when the names were chosen).
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
  'machoke',
  'hitmonlee',
  'throh',
  'sawk',
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

describe('army manifest (R-ART-001, R-ART-003)', () => {
  it('R-ART-001 lists 24 units: one per army style and piece type', () => {
    expect(units).toHaveLength(24);
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        expect(units.filter((u) => u.style === style && u.type === type)).toHaveLength(1);
        expect(unitName(style, type)).toBe(units.find((u) => u.id === `${style}-${type}`)?.name);
      }
    }
  });

  it('R-ART-003 unit names are unique, original and not Pokémon names or look-alikes', () => {
    const names = units.map((u) => u.name);
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

  it('R-ART-001 the chosen style dresses the sides this client controls; the other side always differs', () => {
    const names = { white: 'Alice', black: 'Bob' };
    const mine = armyStylesFor('samurai', names, ['white']);
    expect(mine.white).toBe('samurai');
    expect(mine.black).not.toBe('samurai');
    expect(armyStylesFor('samurai', names, ['black'])).toEqual({
      white: expect.not.stringMatching(/^samurai$/),
      black: 'samurai',
    });
    // Hot-seat: White wears the chosen style, Black a different one.
    const hot = armyStylesFor('roman', names, ['white', 'black']);
    expect(hot.white).toBe('roman');
    expect(hot.black).not.toBe('roman');
    // Spectating: stable per name, and the two armies never match.
    const spec = armyStylesFor('arab', names, []);
    expect(spec).toEqual(armyStylesFor('medieval', names, []));
    expect(spec.white).not.toBe(spec.black);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++)
      seen.add(armyStylesFor('arab', { white: `p${i}`, black: 'x' }, []).white);
    expect(seen.size).toBe(4);
  });
});
