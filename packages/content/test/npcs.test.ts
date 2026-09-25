/** NPC loadouts are content data that pass R-LOAD-004 at the NPC's level (9.4, R-FMT-005). */
import { describe, expect, it } from 'vitest';
import { abilityById, engine } from '../index.ts';
import { npcBuild } from '../src/npcs.ts';

describe('NPC loadouts (R-FMT-005)', () => {
  it('R-FMT-005 R-LOAD-004 every tier builds a legal loadout at every level and seed', () => {
    for (const tier of ['wild', 'trainer', 'elite'] as const) {
      for (let level = 1; level <= 30; level++) {
        for (let seed = 0; seed < 3; seed++) {
          const b = npcBuild(tier, level, seed);
          expect(
            engine.validateLoadout(b.loadout, { level: b.level }).errors,
            `${tier} ${level} ${seed}`,
          ).toEqual([]);
          expect(b.loadout.sets.flat().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('R-FMT-005 wild NPCs carry 1–2 abilities; higher tiers carry more at high levels', () => {
    for (let level = 1; level <= 30; level++) {
      const n = npcBuild('wild', level, 1).loadout.sets.flat().length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
    expect(npcBuild('elite', 25, 0).loadout.sets.flat().length).toBeGreaterThan(2);
    expect(npcBuild('trainer', 5, 2).name).toMatch(/^Trainer (Ember|Tide|Grove) NPC$/);
  });

  it('R-FMT-005 R-ELEM-001 seeds spread NPC armies over all six enabled elements (6.5), each named for its element', () => {
    const seen = new Map<string, string>();
    for (let seed = 0; seed < 6; seed++) {
      const b = npcBuild('trainer', 12, seed);
      const el = b.loadout.elements[0] ?? 'none';
      seen.set(el, b.name);
    }
    expect([...seen.keys()].sort()).toEqual(['ember', 'frost', 'grove', 'stone', 'storm', 'tide']);
    expect(seen.get('storm')).toBe('Trainer Storm NPC');
    expect(seen.get('stone')).toBe('Trainer Stone NPC');
    expect(seen.get('frost')).toBe('Trainer Frost NPC');
  });

  it('R-FMT-005 an NPC of a new element leads with its own affinity cards (6.3: attuned versions)', () => {
    for (const [element, first] of [
      ['storm', 'squall'],
      ['stone', 'buttress'],
      ['frost', 'frost_heave'],
    ] as const) {
      // Level 3: the element's only card at or below that level comes first.
      const b = npcBuild('wild', 3, 0, element);
      expect(b.loadout.elements).toEqual([element]);
      expect(b.loadout.sets.flat()[0], element).toBe(first);
    }
    for (const element of ['storm', 'stone', 'frost'] as const) {
      const b = npcBuild('trainer', 20, 0, element);
      const own = b.loadout.sets.flat().filter((id) => abilityById.get(id)?.affinity === element);
      expect(own.length, element).toBeGreaterThanOrEqual(3);
    }
  });

  it('R-FMT-005 R-WORLD-002 a wild encounter entry fixes the army element; a disabled one falls back to the seed', () => {
    for (const element of ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'] as const) {
      for (let level = 1; level <= 30; level += 7) {
        const b = npcBuild('wild', level, 5, element);
        expect(b.loadout.elements).toEqual([element]);
        expect(engine.validateLoadout(b.loadout, { level: b.level }).errors).toEqual([]);
      }
    }
    // 'neutral' is never enabled (DD-23): the seed picks the element instead.
    for (let seed = 0; seed < 6; seed++)
      expect(npcBuild('wild', 3, seed, 'neutral')).toEqual(npcBuild('wild', 3, seed));
    expect(npcBuild('wild', 3, 0, 'neutral').loadout.elements).not.toEqual(['neutral']);
  });

  it('R-FMT-005 the build is deterministic per seed', () => {
    expect(npcBuild('trainer', 12, 7)).toEqual(npcBuild('trainer', 12, 7));
  });
});
