/**
 * Wild encounters (R-WORLD-002, R-SEC-003): server-side rolls per wild step at the zone rate times
 * key-item multipliers, a grace after each encounter, no rolls on paths or while battling, weighted
 * entries and levels clamped to the player's level ± 2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { encounterRate, pickEntry, wildLevel } from './encounters.ts';
import { Harness, SeqRng, effects, fixtureWorld, msgs, player } from './testing.ts';
import type { BattleRequest, PlayerInit } from './types.ts';
import type { EncounterEntry } from './world.ts';

type Wild = Extract<BattleRequest, { kind: 'wild' }>;

let h: Harness;
afterEach(() => {
  expect(h.problems).toEqual([]);
});

/** A route channel with a seeded RNG; the player starts on (1, row). */
function route(
  o: { rate: number; grace?: number; seed?: number; row?: number } & Partial<PlayerInit>,
) {
  const rng = new SeqRng(o.seed ?? 1);
  h = Harness.of(fixtureWorld({ routeRate: o.rate, routeGrace: o.grace ?? 0 }), 'route', {
    rng: rng.next,
  });
  const { rate: _r, grace: _g, seed: _s, row, ...over } = o;
  h.enter(player('a', { x: 1, y: row ?? 3, ...over }));
  return rng;
}

/** Walk east and west along the row; every encounter's battle ends at once. */
function roam(steps: number): Wild[] {
  const found: Wild[] = [];
  let x = h.me('a').x;
  let dir: 'e' | 'w' = 'e';
  for (let i = 0; i < steps; i++) {
    if (x >= 10) dir = 'w';
    else if (x <= 1) dir = 'e';
    const out = h.step('a', dir);
    x += dir === 'e' ? 1 : -1;
    for (const e of effects(out, 'battle')) {
      if (e.battle.kind !== 'wild') throw new Error('not a wild battle');
      found.push(e.battle);
      expect(msgs(out, 'a', 'zbattle')[0]?.d).toEqual({ p: 'a', battling: true });
      h.core.battleEnded(
        'a',
        { result: 'win', kind: 'wild', format: 'first_blood', tier: 'wild', affinities: [] },
        h.tick(),
      );
    }
  }
  return found;
}

describe('encounter rolls (R-WORLD-002, R-SEC-003)', () => {
  it('R-WORLD-002 R-SEC-003 wild steps roll at the zone rate (20,000 seeded steps)', () => {
    route({ rate: 0.1, seed: 7 });
    const n = roam(20_000).length;
    // Binomial(20000, 0.1): mean 2000, sd 42.4; 4 sd bounds.
    expect(n).toBeGreaterThan(1830);
    expect(n).toBeLessThan(2170);
  });

  it('R-WORLD-002 no roll during the grace steps after an encounter', () => {
    const rng = route({ rate: 1, grace: 3 });
    const found: number[] = [];
    let x = 1;
    let dir: 'e' | 'w' = 'e';
    for (let i = 1; i <= 40; i++) {
      if (x >= 10) dir = 'w';
      else if (x <= 1) dir = 'e';
      const out = h.step('a', dir);
      x += dir === 'e' ? 1 : -1;
      if (effects(out, 'battle').length > 0) {
        found.push(i);
        h.core.battleEnded('a', null, h.tick());
      }
    }
    // Rate 1 and a grace of 3: steps 1, 5, 9, ... hit; grace steps never touch the RNG.
    expect(found).toEqual([1, 5, 9, 13, 17, 21, 25, 29, 33, 37]);
    expect(rng.calls).toBe(found.length * 3);
  });

  it('R-WORLD-002 a key item multiplies the rate (Calm Charm halves it); others do not', () => {
    route({ rate: 0.2, seed: 11 });
    const plain = roam(10_000).length;
    route({ rate: 0.2, seed: 11, keyItems: ['map'] });
    expect(roam(10_000).length).toBe(plain);
    route({ rate: 0.2, seed: 12, keyItems: ['calm-charm'] });
    const charmed = roam(10_000).length;
    // Binomial(10000, 0.2) ~ 2000 +- 160 and Binomial(10000, 0.1) ~ 1000 +- 120 (4 sd).
    expect(plain).toBeGreaterThan(1840);
    expect(plain).toBeLessThan(2160);
    expect(charmed).toBeGreaterThan(880);
    expect(charmed).toBeLessThan(1120);
  });

  it('R-WORLD-002 a key item granted in the zone applies at once', () => {
    route({ rate: 0.2 });
    h.core.grant('a', { xp: 0, keyItems: ['calm-charm'] }, 5, h.tick());
    expect(h.me('a').keyItems).toEqual(['calm-charm']);
    const n = roam(10_000).length;
    expect(n).toBeGreaterThan(880);
    expect(n).toBeLessThan(1120);
  });

  it('R-WORLD-002 paths never roll, and towns never roll', () => {
    const rng = route({ rate: 1, row: 1 });
    expect(roam(2_000)).toEqual([]);
    expect(rng.calls).toBe(0);
    const town = new SeqRng(3);
    h = Harness.of(fixtureWorld({ routeRate: 1 }), 'town', { rng: town.next });
    h.enter(player('b', { x: 1, y: 5 }));
    for (let i = 0; i < 500; i++)
      expect(effects(h.step('b', i % 2 ? 'w' : 'e'), 'battle')).toEqual([]);
    expect(town.calls).toBe(0);
  });

  it('R-WORLD-002 never while battling: steps are refused and nothing is rolled', () => {
    const rng = route({ rate: 1 });
    const out = h.step('a', 'e');
    expect(effects(out, 'battle')).toHaveLength(1);
    const calls = rng.calls;
    for (let i = 0; i < 20; i++) {
      const s = h.step('a', i % 2 ? 'w' : 'e');
      expect(msgs(s, 'a', 'zpos')).toHaveLength(1);
      expect(effects(s, 'battle')).toEqual([]);
    }
    expect(rng.calls).toBe(calls);
    expect(h.me('a')).toMatchObject({ x: 2, battling: true });
    const end = h.core.battleEnded('a', null, h.tick());
    expect(msgs(end, 'a', 'zbattle')[0]?.d).toEqual({ p: 'a', battling: false });
    // A repeated end changes nothing.
    expect(h.core.battleEnded('a', null, h.tick()).send).toEqual([]);
  });

  it('R-WORLD-002 R-SEC-003 the battle request carries the server-chosen entry, level and format', () => {
    route({ rate: 1, seed: 5, level: 5 });
    const found = roam(4_000);
    expect(found.length).toBe(4_000);
    const ember = found.filter((b) => b.entry.name === 'Wild Cindermoth');
    const tide = found.filter((b) => b.entry.name === 'Wild Brookhound');
    // Weights 3:1.
    expect(ember.length / found.length).toBeGreaterThan(0.72);
    expect(ember.length / found.length).toBeLessThan(0.78);
    // Level 5: entry 2-4 clamps to 3-4; entry 8-10 is above 3-7, so the window's top (7).
    expect(new Set(ember.map((b) => b.level))).toEqual(new Set([3, 4]));
    expect(new Set(tide.map((b) => b.level))).toEqual(new Set([7]));
    for (const b of found) {
      expect(b).toMatchObject({
        kind: 'wild',
        players: ['a'],
        format: 'first_blood',
        zone: 'route',
      });
    }
  });
});

describe('encounter helpers (R-WORLD-002)', () => {
  const a: EncounterEntry = { weight: 1, levels: [1, 3], name: 'A' };
  const b: EncounterEntry = { weight: 3, levels: [20, 30], name: 'B' };
  const keys = new Map([
    ['half', { id: 'half', name: 'Half', text: '', encounterRate: 0.5 }],
    ['none', { id: 'none', name: 'None', text: '' }],
  ]);

  it('R-WORLD-002 rate = zone rate x owned key-item multipliers, within [0, 1]', () => {
    expect(encounterRate({ encounterRate: 0.2 }, [], keys)).toBe(0.2);
    expect(encounterRate({ encounterRate: 0.2 }, ['half', 'none', 'unknown'], keys)).toBe(0.1);
    expect(encounterRate({ encounterRate: 0.2 }, ['half', 'half'], keys)).toBe(0.1);
    expect(encounterRate({ encounterRate: 3 }, [], keys)).toBe(1);
    expect(encounterRate({ encounterRate: -1 }, [], keys)).toBe(0);
  });

  it('R-WORLD-002 entries are picked by weight', () => {
    expect(pickEntry([a, b], 0)).toBe(a);
    expect(pickEntry([a, b], 0.2499)).toBe(a);
    expect(pickEntry([a, b], 0.25)).toBe(b);
    expect(pickEntry([a, b], 0.9999)).toBe(b);
    expect(pickEntry([{ ...a, weight: 0 }], 0.5)).toBeNull();
    expect(pickEntry([], 0.5)).toBeNull();
  });

  it('R-WORLD-002 wild levels stay within the player level +- 2 and the entry range', () => {
    expect(wildLevel(a, 2, 0)).toBe(1);
    expect(wildLevel(a, 2, 0.999)).toBe(3);
    expect(wildLevel(b, 25, 0)).toBe(23);
    expect(wildLevel(b, 25, 0.999)).toBe(27);
    // No overlap: the nearest level in the player's window.
    expect(wildLevel(b, 5, 0.5)).toBe(7);
    expect(wildLevel(a, 40, 0.5)).toBe(38);
    expect(wildLevel(a, 1, 0.5)).toBeGreaterThanOrEqual(1);
  });
});
