/**
 * R-ART-003 (COMMITTED): original names for ability, item and trait modules. The M7 7.3 names were
 * checked at authoring time against Pokémon move, ability and item names (no exact match, no
 * near-collision); this kept guard lists the nearest ones and the franchise naming patterns, so a
 * rename cannot drift into them. The starter names come from the spec (5.7, 7.2) and stay as the
 * designer chose them.
 */
import { describe, expect, it } from 'vitest';
import { abilities, items, traits } from '../index.ts';

/** Franchise move, ability and item names nearest to ours, or common in this design space. */
const DENY = [
  'tailwind',
  'thunderclap',
  'thunder wave',
  'volt switch',
  'discharge',
  'static',
  'lightning rod',
  'electroweb',
  'baton pass',
  'quick guard',
  'wide guard',
  'protect',
  'detect',
  'sturdy',
  'stealth rock',
  'rock slide',
  'stone edge',
  'iron defense',
  'key stone',
  'cornerstone',
  'moon stone',
  'hard stone',
  'everstone',
  'whiteout',
  'white out',
  'sheer cold',
  'icy wind',
  'frost breath',
  'freeze dry',
  'blizzard',
  'snowscape',
  'snow cloak',
  'ice body',
  'aurora veil',
  'avalanche',
  'rapid spin',
  'rollout',
  'aftermath',
  'retaliate',
  'revenge',
  'iron ball',
  'quick claw',
  'red card',
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

describe('module names (R-ART-003)', () => {
  const names = [...abilities, ...items, ...traits].map((m) => m.name);

  it('R-ART-003 ability, item and trait names are unique', () => {
    expect(new Set(names.map(norm)).size).toBe(names.length);
  });

  it('R-ART-003 no module name is, contains or nearly spells a franchise move, ability or item name', () => {
    expect(names.length).toBeGreaterThanOrEqual(45);
    for (const name of names) {
      const n = norm(name);
      for (const d of DENY) {
        expect(` ${n} `.includes(` ${d} `), `${name} contains "${d}"`).toBe(false);
        expect(
          lev(n.replace(/ /g, ''), d.replace(/ /g, '')),
          `${name} vs ${d}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('R-ART-003 no item follows the franchise item patterns ("<word> Stone" evolution stones, "<word> Ball" capture balls)', () => {
    for (const i of items) {
      expect(norm(i.name), i.name).not.toMatch(/ (stone|ball)$/);
      expect(norm(i.name), i.name).not.toMatch(/ball/);
    }
  });
});
