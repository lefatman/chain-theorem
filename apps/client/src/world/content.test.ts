/**
 * World content on the client and reward text (M5, spec 10.2–10.5): registry indexing, zone names,
 * skippable lessons (10.3) and reward toasts in plain words.
 */
import { describe, expect, it } from 'vitest';
import { zoneById } from '@chain-theorem/content/world';
import { lessonSkippable, loadWorld, zoneGeometry, zoneName } from './content.ts';
import { rewardText } from './rewards.ts';

describe('world content on the client (R-WORLD-003, R-WORLD-005)', () => {
  it('R-WORLD-003 reads the world registry: zone maps, names and skippable lessons', async () => {
    const ix = await loadWorld();
    expect(ix.zones).toBe(zoneById);
    const start = [...ix.zones.keys()][0] ?? '';
    const geo = await zoneGeometry(start);
    expect(geo?.width).toBeGreaterThan(0);
    expect(await zoneGeometry('no_such_zone')).toBeNull();
    expect(zoneName(start, ix)).toBe(ix.zones.get(start)?.name);
    expect(zoneName('route-9', null)).toBe('Route 9');
    // Chess lessons may be skipped; ability and element lessons may not (10.3).
    const lessons = [...ix.lessons.values()];
    expect(lessons.some((l) => l.kind === 'puzzles')).toBe(true);
    for (const l of lessons) expect(lessonSkippable(l.id, ix)).toBe(l.kind === 'puzzles');
    expect(lessonSkippable('unknown', ix)).toBe(false);
    expect(lessonSkippable(lessons[0]?.id ?? '', null)).toBe(false);
  });

  it('R-WORLD-005 describes rewards: XP, level up, items, cards, key items and coins', () => {
    const r = rewardText(
      {
        xp: 120,
        level: 4,
        levelUp: true,
        items: [{ id: 'mystery_item', qty: 2 }],
        cards: [{ id: 'hit_and_run', qty: 1 }],
        keyItems: ['repel_charm'],
        coins: 25,
      },
      (id) => (id === 'repel_charm' ? 'Quiet Bell' : undefined),
    );
    expect(r.title).toBe('Level up!');
    expect(r.lines).toEqual([
      '+120 XP',
      'You reached level 4!',
      'Item: mystery_item ×2',
      'Ability card: Hit and Run',
      'Key item: Quiet Bell',
      '+25 coins',
    ]);
    expect(
      rewardText({ xp: 5, level: 1, levelUp: false, items: [], cards: [], keyItems: [], coins: 0 }),
    ).toEqual({ title: 'Reward', lines: ['+5 XP'] });
  });
});
