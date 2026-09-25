/** Progression values (7.1, 7.5 R-LOAD-005, 10.2 R-WORLD-002, 17.2): all PLAYTEST, tuned here. */
import { describe, expect, it } from 'vitest';
import { CAPS } from '../config.ts';
import { abilityById } from '../index.ts';
import {
  BATTLE_XP,
  battleXp,
  lessonById,
  levelForXp,
  PACING,
  questById,
  sessionEncounters,
  WILD_DROPS,
  wildCardPool,
  wildReward,
  wildStepsPerEncounter,
  xpForLevel,
  xpToNext,
  world,
} from './index.ts';

describe('progression (R-LOAD-005)', () => {
  it('R-LOAD-005 the XP curve rises, inverts exactly and stops at the level cap', () => {
    expect(xpForLevel(1)).toBe(0);
    for (let l = 2; l <= CAPS.LEVEL_CAP; l++) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
      expect(xpToNext(l)).toBeGreaterThanOrEqual(l < CAPS.LEVEL_CAP ? xpToNext(l - 1) : 0);
      expect(levelForXp(xpForLevel(l))).toBe(l);
      expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(CAPS.LEVEL_CAP);
    expect(xpToNext(CAPS.LEVEL_CAP)).toBe(0);
    expect(xpForLevel(99)).toBe(xpForLevel(CAPS.LEVEL_CAP));
  });

  it('R-LOAD-005 battle XP is weighted by format and result and grows with the opponent level', () => {
    for (const f of ['first_blood', 'vanguard', 'full'] as const) {
      expect(BATTLE_XP[f].win).toBeGreaterThan(BATTLE_XP[f].draw);
      expect(BATTLE_XP[f].draw).toBeGreaterThan(BATTLE_XP[f].loss);
      expect(BATTLE_XP[f].loss).toBeGreaterThan(0); // losing still pays (pillar 5)
    }
    expect(BATTLE_XP.full.win).toBeGreaterThan(BATTLE_XP.vanguard.win);
    expect(BATTLE_XP.vanguard.win).toBeGreaterThan(BATTLE_XP.first_blood.win);
    // Per minute of median battle length (17.2), longer formats do not pay more.
    expect(BATTLE_XP.full.win / 17.5).toBeLessThan(BATTLE_XP.first_blood.win / 3.5);
    expect(battleXp('first_blood', 'win', 1)).toBe(30);
    expect(battleXp('first_blood', 'win', 11)).toBe(75);
    expect(battleXp('vanguard', 'loss', 500)).toBe(battleXp('vanguard', 'loss', CAPS.LEVEL_CAP));
  });

  it('R-LOAD-005 R-WORLD-005 pacing: the Academy lessons reach level 3, the whole line level 4, the cap is far away', () => {
    const lessonXp = world.lessons.reduce((n, l) => n + l.reward.xp, 0);
    const skippedXp = world.lessons.filter((l) => l.skippable).reduce((n, l) => n + l.reward.xp, 0);
    const questXp = (id: string) => questById.get(id)?.reward.xp ?? 0;
    const enrolled = lessonXp + questXp('academy_enrolment');
    expect(levelForXp(enrolled)).toBe(3);
    expect(levelForXp(enrolled - skippedXp)).toBe(3); // veterans who skip still reach level 3
    // The route quest adds a trainer win and a wild win on top of its reward.
    const road =
      enrolled +
      questXp('academy_first_road') +
      battleXp('first_blood', 'win', 2) +
      60 +
      battleXp('first_blood', 'win', 2);
    expect(levelForXp(road)).toBe(4);
    expect(levelForXp(road + questXp('academy_tide_trial'))).toBeGreaterThanOrEqual(4);
    expect(lessonById.get('ability_poisoned_meat')?.reward.cards?.[0]?.id).toBe('poisoned_meat');
    // Hours to the cap at the PACING session (4-6 First Blood + 1 Vanguard per 30 minutes, 55% wins,
    // 10% draws) against same-level opponents, ignoring quests: on the order of 100 hours.
    const perSession = (level: number) => {
      const fb = sessionEncounters(0.07, 6);
      const avg = (f: 'first_blood' | 'vanguard') =>
        0.55 * battleXp(f, 'win', level) +
        0.1 * battleXp(f, 'draw', level) +
        0.35 * battleXp(f, 'loss', level);
      return fb * avg('first_blood') + avg('vanguard');
    };
    let hours = 0;
    for (let l = 1; l < CAPS.LEVEL_CAP; l++) hours += (xpToNext(l) / perSession(l)) * 0.5;
    expect(hours).toBeGreaterThan(60);
    expect(hours).toBeLessThan(250);
  });
});

describe('wild rewards and encounter pacing (R-WORLD-002)', () => {
  it('R-WORLD-002 wild rewards are seeded, bounded, and any card dropped is equippable at the player level', () => {
    expect(wildReward({ seed: 7, outcome: 'win', playerLevel: 3, npcLevel: 3 })).toEqual(
      wildReward({ seed: 7, outcome: 'win', playerLevel: 3, npcLevel: 3 }),
    );
    let cards = 0;
    for (let seed = 0; seed < 2000; seed++) {
      for (const outcome of ['win', 'draw', 'loss'] as const) {
        const r = wildReward({ seed, outcome, playerLevel: 2, npcLevel: 3, element: 'grove' });
        const [lo, hi] = WILD_DROPS.coins[outcome];
        expect(r.coins).toBeGreaterThanOrEqual(lo);
        expect(r.coins).toBeLessThanOrEqual(hi);
        expect(r.xp).toBe(battleXp('first_blood', outcome, 3));
        if (outcome !== 'win') expect(r.cards).toBeUndefined();
        for (const c of r.cards ?? []) {
          cards++;
          expect(abilityById.get(c.id)?.minLevel).toBeLessThanOrEqual(2);
          expect(abilityById.get(c.id)?.affinity).toBe('grove');
        }
      }
    }
    // About cardChance of the wins drop a card.
    expect(cards / 2000).toBeGreaterThan(WILD_DROPS.cardChance * 0.6);
    expect(cards / 2000).toBeLessThan(WILD_DROPS.cardChance * 1.4);
    // Level 1 has no Grove card: the pool falls back to any enabled element's level-1 cards
    // (Squall, Storm, joined the pool when M7 enabled Storm, Stone and Frost).
    expect(wildCardPool(1, 'grove')).toEqual(['hit_and_run', 'last_word', 'scout', 'squall']);
    expect(wildCardPool(1, 'grove').every((id) => abilityById.get(id)?.minLevel === 1)).toBe(true);
    // M7 (6.5): each new element drops its own cards from its first level.
    expect(wildCardPool(1, 'storm')).toEqual(['squall']);
    expect(wildCardPool(2, 'stone')).toEqual(['buttress']);
    expect(wildCardPool(3, 'frost')).toEqual(['frost_heave']);
  });

  it('R-WORLD-002 the session model: more encounters at higher rates, never more battles than the session holds', () => {
    expect(wildStepsPerEncounter(0.1, 5)).toBe(15);
    expect(wildStepsPerEncounter(0, 5)).toBe(Infinity);
    expect(sessionEncounters(0, 0)).toBe(0);
    expect(sessionEncounters(0.2, 4)).toBeGreaterThan(sessionEncounters(0.05, 4));
    const ceiling =
      (PACING.sessionSeconds - PACING.longBattleSeconds - PACING.otherSeconds) /
      (PACING.firstBloodSeconds + PACING.encounterOverheadSeconds);
    expect(sessionEncounters(1, 0)).toBeLessThan(ceiling);
    expect(ceiling).toBeLessThanOrEqual(PACING.target[1]);
  });
});
