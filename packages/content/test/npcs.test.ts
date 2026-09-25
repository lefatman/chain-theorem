/** NPC loadouts are content data that pass R-LOAD-004 at the NPC's level (9.4, R-FMT-005). */
import { describe, expect, it } from 'vitest';
import { engine } from '../index.ts';
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

  it('R-FMT-005 R-WORLD-002 a wild encounter entry fixes the army element; a disabled one falls back to the seed', () => {
    for (const element of ['ember', 'tide', 'grove'] as const) {
      for (let level = 1; level <= 30; level += 7) {
        const b = npcBuild('wild', level, 5, element);
        expect(b.loadout.elements).toEqual([element]);
        expect(engine.validateLoadout(b.loadout, { level: b.level }).errors).toEqual([]);
      }
    }
    expect(npcBuild('wild', 3, 5, 'frost')).toEqual(npcBuild('wild', 3, 5));
  });

  it('R-FMT-005 the build is deterministic per seed', () => {
    expect(npcBuild('trainer', 12, 7)).toEqual(npcBuild('trainer', 12, 7));
  });
});
