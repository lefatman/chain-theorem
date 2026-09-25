/** Quest progression as pure functions (R-WORLD-005, 10.5). */
import { describe, expect, it } from 'vitest';
import {
  accept,
  advance,
  canAccept,
  questIndex,
  questText,
  settle,
  wantsReach,
  winMatches,
} from './quests.ts';
import { fixtureWorld } from './testing.ts';
import type { BattleOutcome, QuestProgress } from './types.ts';
import type { QuestDef } from './world.ts';

const world = fixtureWorld();
const defs = questIndex(world.quests);
const first = defs.get('first-steps') as QuestDef;
const second = defs.get('second-steps') as QuestDef;
const none = { lessonsDone: [], defeatedNpcs: [] };

const win = (over: Partial<BattleOutcome> = {}): BattleOutcome => ({
  result: 'win',
  kind: 'wild',
  format: 'first_blood',
  tier: 'wild',
  affinities: ['tide'],
  ...over,
});

describe('quests (R-WORLD-005)', () => {
  it('R-WORLD-005 a quest is accepted once, and only after the quests it requires are done', () => {
    expect(canAccept(first, [])).toBe(true);
    expect(canAccept(second, [])).toBe(false);
    expect(canAccept(second, [{ id: 'first-steps', step: 2, done: false }])).toBe(false);
    expect(canAccept(second, [{ id: 'first-steps', step: 5, done: true }])).toBe(true);
    const r = accept(first, [], none);
    expect(r?.update).toMatchObject({
      progress: { id: 'first-steps', step: 0, done: false },
      text: 'Talk to Pip.',
      completed: false,
    });
    expect(accept(first, r?.list ?? [], none)).toBeNull();
  });

  it('R-WORLD-005 talk -> lesson -> reach -> defeat -> win with a constraint, one step per event', () => {
    let list: QuestProgress[] = accept(first, [], none)?.list ?? [];
    const step = (ev: Parameters<typeof advance>[2]) => {
      const r = advance(defs, list, ev, none);
      list = r.list;
      return r.updates;
    };
    expect(step({ kind: 'talk', npc: 'elder' })).toEqual([]);
    expect(step({ kind: 'talk', npc: 'kid' })[0]?.text).toBe('Finish the movement lesson.');
    // Talking to Pip again does not skip the lesson.
    expect(step({ kind: 'talk', npc: 'kid' })).toEqual([]);
    expect(step({ kind: 'lesson', lesson: 'mates' })).toEqual([]);
    expect(step({ kind: 'lesson', lesson: 'moves' })[0]?.progress.step).toBe(2);
    expect(step({ kind: 'reach', zone: 'route', areas: ['gate'] })).toEqual([]);
    expect(step({ kind: 'reach', zone: 'town', areas: ['plaza'] })).toEqual([]);
    expect(step({ kind: 'reach', zone: 'town', areas: ['plaza', 'gate'] })[0]?.progress.step).toBe(
      3,
    );
    // Beating another trainer, or losing to the rival, is not "defeat Rival Kess".
    expect(step({ kind: 'battle', outcome: win({ kind: 'trainer', npc: 'coach' }) })).toEqual([]);
    expect(
      step({ kind: 'battle', outcome: win({ kind: 'trainer', npc: 'rival', result: 'loss' }) }),
    ).toEqual([]);
    const d = step({
      kind: 'battle',
      outcome: win({ kind: 'trainer', npc: 'rival', tier: 'trainer' }),
    });
    expect(d[0]?.progress.step).toBe(4);
    // The same event never completes two steps: the win step still waits.
    expect(list[0]?.done).toBe(false);
    const done = step({ kind: 'battle', outcome: win() });
    expect(done[0]).toMatchObject({
      progress: { id: 'first-steps', step: 5, done: true },
      completed: true,
      reward: first.reward,
      text: 'First Steps: complete',
    });
    // A finished quest never changes again.
    expect(step({ kind: 'battle', outcome: win() })).toEqual([]);
  });

  it('R-WORLD-005 win constraints: result, wild, only one affinity, format and tier', () => {
    const c = { wild: true, onlyAffinity: 'tide' as const };
    expect(winMatches(c, win())).toBe(true);
    expect(winMatches(c, win({ result: 'draw' }))).toBe(false);
    expect(winMatches(c, win({ kind: 'trainer' }))).toBe(false);
    expect(winMatches(c, win({ affinities: ['tide', 'ember'] }))).toBe(false);
    // "Using only Tide abilities" needs at least one Tide ability used.
    expect(winMatches(c, win({ affinities: [] }))).toBe(false);
    expect(winMatches({ format: 'vanguard' }, win())).toBe(false);
    expect(winMatches({ format: 'first_blood' }, win())).toBe(true);
    expect(winMatches({ tier: 'elite' }, win())).toBe(false);
    expect(winMatches({ tier: 'wild' }, win())).toBe(true);
    expect(winMatches({ wild: false }, win({ kind: 'challenge', tier: undefined }))).toBe(true);
    // A lesson battle uses the lesson's loadout, not the player's build.
    expect(winMatches({}, win({ kind: 'lesson', lesson: 'ember-basics' }))).toBe(false);
  });

  it('R-WORLD-005 steps met by lasting facts complete when they become current', () => {
    const facts = { lessonsDone: ['moves'], defeatedNpcs: ['rival'] };
    // Accepting after the lesson: the lesson step completes as soon as the talk step does.
    let list = accept(first, [], facts)?.list ?? [];
    expect(list[0]?.step).toBe(0);
    list = advance(defs, list, { kind: 'talk', npc: 'kid' }, facts).list;
    expect(list[0]?.step).toBe(2);
    // A once-only trainer beaten before the quest cannot be fought again: the step is met.
    expect(settle(first, { id: 'first-steps', step: 3, done: false }, facts)).toEqual({
      id: 'first-steps',
      step: 4,
      done: false,
    });
    // A null event only settles.
    const r = advance(defs, [{ id: 'first-steps', step: 1, done: false }], null, facts);
    expect(r.updates[0]?.progress.step).toBe(2);
  });

  it('R-WORLD-005 unknown quests are left alone; reach steps are found by zone', () => {
    const list = [
      { id: 'gone', step: 0, done: false },
      { id: 'first-steps', step: 2, done: false },
    ];
    expect(advance(defs, list, { kind: 'talk', npc: 'kid' }, none).list).toEqual(list);
    expect(wantsReach(defs, list, 'town')).toBe(true);
    expect(wantsReach(defs, list, 'route')).toBe(false);
    expect(questText(first, { id: 'first-steps', step: 2, done: false })).toBe(
      'Go to the town gate.',
    );
  });
});
