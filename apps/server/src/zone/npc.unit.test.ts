/**
 * NPCs, the Chess Academy and quests through the zone core (R-WORLD-003, R-WORLD-005, R-SEC-003):
 * facing and adjacency, dialog options by role, puzzle answers checked by the rules engine, skips,
 * battle lessons, once-only trainers, and a quest carried across two zones.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Harness, effects, fixtureWorld, merge, msgs, player } from './testing.ts';
import type { BattleOutcome, Outbox, QuestProgress } from './types.ts';

let h: Harness;
afterEach(() => {
  expect(h.problems).toEqual([]);
});

const outcome = (over: Partial<BattleOutcome>): BattleOutcome => ({
  result: 'win',
  kind: 'trainer',
  format: 'first_blood',
  affinities: [],
  ...over,
});

const options = (out: Outbox, who = 'a') => msgs(out, who, 'dialog')[0]?.d.options.map((o) => o.id);
const code = (out: Outbox, who = 'a') => msgs(out, who, 'err')[0]?.d.code;

describe('talking to NPCs (R-WORLD-003)', () => {
  it('R-WORLD-003 the player must stand next to the NPC and face it', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 'e' }));
    expect(code(h.send('a', 'interact', { npc: 'prof' }))).toBe('too_far');
    h.step('a', 's'); // into the professor: turns to face him
    const out = h.send('a', 'interact', { npc: 'prof' });
    expect(msgs(out, 'a', 'dialog')[0]?.d).toMatchObject({
      npc: 'prof',
      name: 'Professor Vell',
      lines: ['Welcome, A.'],
    });
    // Two tiles away, or diagonal, is too far; an NPC that is not here is unknown.
    h.enter(player('b', { x: 3, y: 1, dir: 's' }));
    expect(code(h.send('b', 'interact', { npc: 'prof' }), 'b')).toBe('too_far');
    h.enter(player('c', { x: 4, y: 2, dir: 's' }));
    expect(code(h.send('c', 'interact', { npc: 'prof' }), 'c')).toBe('too_far');
    expect(code(h.send('c', 'interact', { npc: 'ghost' }), 'c')).toBe('no_npc');
    // From the side works too.
    h.enter(player('d', { x: 4, y: 3, dir: 'w' }));
    expect(options(h.send('d', 'interact', { npc: 'prof' }), 'd')).toBeDefined();
  });

  it('R-WORLD-003 options by role: teacher, trainer, quest giver, talk', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    expect(options(h.send('a', 'interact', { npc: 'prof' }))).toEqual([
      'lesson:moves',
      'skip:moves',
      'lesson:mates',
      'skip:mates',
      // Ability and element lessons cannot be skipped (10.3).
      'lesson:ember-basics',
    ]);
    h.enter(player('b', { x: 5, y: 2, dir: 's' }));
    expect(options(h.send('b', 'interact', { npc: 'kid' }), 'b')).toEqual([]);
    h.enter(player('c', { x: 7, y: 2, dir: 's' }));
    expect(options(h.send('c', 'interact', { npc: 'elder' }), 'c')).toEqual(['quest:first-steps']);
    h.enter(player('d', { x: 9, y: 2, dir: 's' }));
    expect(options(h.send('d', 'interact', { npc: 'rival' }), 'd')).toEqual(['battle']);
  });

  it('R-WORLD-003 a choice must be one of the open dialog options', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    expect(code(h.send('a', 'choose', { npc: 'prof', option: 'lesson:moves' }))).toBe('no_option');
    h.send('a', 'interact', { npc: 'prof' });
    expect(code(h.send('a', 'choose', { npc: 'prof', option: 'skip:ember-basics' }))).toBe(
      'no_option',
    );
    expect(code(h.send('a', 'choose', { npc: 'kid', option: 'lesson:moves' }))).toBe('no_option');
    // Walking away closes the dialog.
    h.send('a', 'interact', { npc: 'prof' });
    h.walk('a', 'ns');
    expect(code(h.send('a', 'choose', { npc: 'prof', option: 'lesson:moves' }))).toBe('no_option');
  });

  it('R-WORLD-003 R-SEC-003 a puzzle answer counts only when listed AND legal in the position', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'prof' });
    const start = h.send('a', 'choose', { npc: 'prof', option: 'lesson:moves' });
    expect(msgs(start, 'a', 'puzzle')[0]?.d).toEqual({
      lesson: 'moves',
      index: 0,
      count: 2,
      fen: '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1',
      prompt: 'Jump the knight forward two ranks.',
    });
    const answer = (puzzle: number, move: string) =>
      h.send('a', 'answer', { lesson: 'moves', puzzle, move });
    // Legal but not listed.
    expect(msgs(answer(0, 'b1d2'), 'a', 'lessonResult')[0]?.d).toEqual({
      lesson: 'moves',
      puzzle: 0,
      ok: false,
      hint: 'Knights move in an L.',
      done: false,
    });
    // Neither listed nor legal.
    expect(msgs(answer(0, 'b1b3'), 'a', 'lessonResult')[0]?.d.ok).toBe(false);
    // Answering a later puzzle first is refused.
    expect(code(answer(1, 'a1a8'))).toBe('no_puzzle');
    const right = answer(0, 'b1c3');
    expect(msgs(right, 'a', 'lessonResult')[0]?.d).toEqual({
      lesson: 'moves',
      puzzle: 0,
      ok: true,
      done: false,
    });
    expect(msgs(right, 'a', 'puzzle')[0]?.d.index).toBe(1);
    // Listed but illegal (a rook cannot move diagonally): refused.
    expect(msgs(answer(1, 'a1h8'), 'a', 'lessonResult')[0]?.d.ok).toBe(false);
    const last = answer(1, 'a1a8');
    expect(msgs(last, 'a', 'lessonResult')[0]?.d).toMatchObject({ ok: true, done: true });
    expect(effects(last, 'lessonDone')).toEqual([
      { kind: 'lessonDone', id: 'a', lesson: 'moves', reward: { xp: 20 }, skipped: false },
    ]);
    expect(last.save).toBe(true);
    // Done: no more answers, and the teacher no longer offers it.
    expect(code(answer(1, 'a1a8'))).toBe('no_puzzle');
    expect(options(h.send('a', 'interact', { npc: 'prof' }))).not.toContain('lesson:moves');
  });

  it('R-WORLD-003 a reconnect resends the open puzzle', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'prof' });
    h.send('a', 'choose', { npc: 'prof', option: 'lesson:moves' });
    h.send('a', 'answer', { lesson: 'moves', puzzle: 0, move: 'b1a3' });
    const again = h.enter(player('a'));
    expect(msgs(again, 'a', 'puzzle')[0]?.d).toMatchObject({ lesson: 'moves', index: 1 });
  });

  it('R-WORLD-003 veterans skip chess lessons (completing them), never ability lessons', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'prof' });
    const skip = h.send('a', 'choose', { npc: 'prof', option: 'skip:mates' });
    expect(effects(skip, 'lessonDone')).toEqual([
      { kind: 'lessonDone', id: 'a', lesson: 'mates', reward: { xp: 20 }, skipped: true },
    ]);
    expect(h.me('a').lessonsDone).toEqual(['mates']);
    const opts = options(h.send('a', 'interact', { npc: 'prof' }));
    expect(opts).toEqual(['lesson:moves', 'skip:moves', 'lesson:ember-basics']);
  });

  it('R-WORLD-003 a battle lesson starts a lesson battle; only a win completes it', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'prof' });
    const start = h.send('a', 'choose', { npc: 'prof', option: 'lesson:ember-basics' });
    expect(effects(start, 'battle')[0]?.battle).toEqual({
      kind: 'lesson',
      players: ['a'],
      format: 'first_blood',
      lesson: 'ember-basics',
    });
    const lost = h.core.battleEnded(
      'a',
      outcome({ kind: 'lesson', lesson: 'ember-basics', result: 'loss' }),
      h.tick(),
    );
    expect(effects(lost, 'lessonDone')).toEqual([]);
    h.send('a', 'interact', { npc: 'prof' });
    h.send('a', 'choose', { npc: 'prof', option: 'lesson:ember-basics' });
    const won = h.core.battleEnded(
      'a',
      outcome({ kind: 'lesson', lesson: 'ember-basics' }),
      h.tick(),
    );
    expect(effects(won, 'lessonDone')[0]).toMatchObject({ lesson: 'ember-basics', skipped: false });
  });

  it('R-WORLD-003 a once-only trainer battles until beaten; a practice trainer always', () => {
    h = Harness.of();
    h.enter(player('a', { x: 9, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'rival' });
    const start = h.send('a', 'choose', { npc: 'rival', option: 'battle' });
    expect(effects(start, 'battle')[0]?.battle).toEqual({
      kind: 'trainer',
      players: ['a'],
      format: 'first_blood',
      npc: 'rival',
      tier: 'trainer',
      level: 3,
    });
    // Talking while battling is refused.
    expect(code(h.send('a', 'interact', { npc: 'rival' }))).toBe('battling');
    const lost = h.core.battleEnded('a', outcome({ npc: 'rival', result: 'loss' }), h.tick());
    expect(effects(lost, 'defeated')).toEqual([]);
    expect(options(h.send('a', 'interact', { npc: 'rival' }))).toEqual(['battle']);
    h.send('a', 'choose', { npc: 'rival', option: 'battle' });
    const won = h.core.battleEnded('a', outcome({ npc: 'rival' }), h.tick());
    expect(effects(won, 'defeated')).toEqual([{ kind: 'defeated', id: 'a', npc: 'rival' }]);
    expect(options(h.send('a', 'interact', { npc: 'rival' }))).toEqual([]);
    // The practice coach at (11,3): stand at (11,2) facing south.
    h.walk('a', 'ee');
    h.step('a', 's');
    h.send('a', 'interact', { npc: 'coach' });
    h.send('a', 'choose', { npc: 'coach', option: 'battle' });
    h.core.battleEnded('a', outcome({ npc: 'coach' }), h.tick());
    expect(options(h.send('a', 'interact', { npc: 'coach' }))).toEqual(['battle']);
  });
});

describe('quests through the zone (R-WORLD-005)', () => {
  it('R-WORLD-005 talk -> lesson -> reach -> defeat -> win with a constraint, across two zones', () => {
    const world = fixtureWorld({ routeRate: 1 });
    h = Harness.of(world);
    /** What the host stores from `quest` effects. */
    const stored = new Map<string, QuestProgress>();
    const texts: string[] = [];
    const record = (out: Outbox) => {
      for (const e of effects(out, 'quest')) stored.set(e.quest.id, e.quest);
      texts.push(...msgs(out, 'a', 'quest').map((m) => m.d.text));
      return out;
    };
    record(h.enter(player('a', { x: 7, y: 2, dir: 's' })));
    h.send('a', 'interact', { npc: 'elder' });
    const accepted = record(h.send('a', 'choose', { npc: 'elder', option: 'quest:first-steps' }));
    expect(msgs(accepted, 'a', 'quest')[0]?.d).toEqual({
      id: 'first-steps',
      step: 0,
      done: false,
      text: 'Talk to Pip.',
    });
    expect(options(h.send('a', 'interact', { npc: 'elder' }))).toEqual([]);
    // Talking to the professor first does nothing for the quest.
    h.walk('a', 'wwwws');
    record(h.send('a', 'interact', { npc: 'prof' }));
    expect(stored.get('first-steps')?.step).toBe(0);
    // Talk to Pip at (5,3).
    h.walk('a', 'ees');
    record(h.send('a', 'interact', { npc: 'kid' }));
    expect(stored.get('first-steps')?.step).toBe(1);
    // The movement lesson.
    h.walk('a', 'wws');
    h.send('a', 'interact', { npc: 'prof' });
    h.send('a', 'choose', { npc: 'prof', option: 'lesson:moves' });
    h.send('a', 'answer', { lesson: 'moves', puzzle: 0, move: 'b1c3' });
    record(h.send('a', 'answer', { lesson: 'moves', puzzle: 1, move: 'a1a8' }));
    expect(stored.get('first-steps')?.step).toBe(2);
    // Reach the gate (x 10-11, y 6-7).
    const walk = record(h.walk('a', 'eeeeeeessss'));
    expect(h.me('a')).toMatchObject({ x: 10, y: 6 });
    expect(effects(walk, 'quest')).toHaveLength(1);
    expect(stored.get('first-steps')?.step).toBe(3);
    // Defeat the rival at (9,3) from (10,3).
    h.walk('a', 'nnnw');
    h.send('a', 'interact', { npc: 'rival' });
    h.send('a', 'choose', { npc: 'rival', option: 'battle' });
    record(h.core.battleEnded('a', outcome({ npc: 'rival', tier: 'trainer' }), h.tick()));
    expect(stored.get('first-steps')?.step).toBe(4);
    // To the route through the warp at (12,8).
    const warp = h.walk('a', 'sssssee');
    expect(effects(warp, 'warp')[0]).toMatchObject({ zone: 'route', x: 1, y: 1 });
    expect(effects(h.core.leave('a', h.tick()), 'persist')).toEqual([]);
    // The route channel gets the stored quest state from the host.
    const route = Harness.of(world, 'route');
    route.enter(
      player('a', {
        x: 1,
        y: 1,
        quests: [...stored.values()],
        lessonsDone: ['moves'],
        defeatedNpcs: ['rival'],
      }),
    );
    const wild = (affinities: BattleOutcome['affinities'], dir: 'n' | 's' | 'e' | 'w') => {
      const out = route.step('a', dir);
      expect(effects(out, 'battle')).toHaveLength(1);
      return record(
        route.core.battleEnded(
          'a',
          outcome({ kind: 'wild', tier: 'wild', affinities }),
          route.tick(),
        ),
      );
    };
    // A wild win with an Ember ability does not meet "only Tide abilities".
    expect(effects(wild(['ember'], 's'), 'quest')).toEqual([]);
    const done = wild(['tide'], 'e');
    expect(effects(done, 'questDone')).toEqual([
      {
        kind: 'questDone',
        id: 'a',
        quest: 'first-steps',
        reward: { xp: 100, keyItems: ['calm-charm'], coins: 20 },
      },
    ]);
    expect(stored.get('first-steps')).toEqual({ id: 'first-steps', step: 5, done: true });
    // The host grants the reward, then tells the zone.
    const granted = route.core.grant(
      'a',
      { xp: 100, keyItems: ['calm-charm'], coins: 20 },
      6,
      route.tick(),
    );
    expect(msgs(granted, 'a', 'reward')[0]?.d).toEqual({
      xp: 100,
      level: 6,
      levelUp: true,
      items: [],
      cards: [],
      keyItems: ['calm-charm'],
      coins: 20,
    });
    expect(texts).toEqual([
      'Talk to Pip.',
      'Finish the movement lesson.',
      'Go to the town gate.',
      'Defeat Rival Kess.',
      'Win a wild battle using only Tide abilities.',
      'First Steps: complete',
    ]);
    expect(route.problems).toEqual([]);
  });

  it('R-WORLD-005 accepting a quest completes a leading talk step to its giver', () => {
    const base = fixtureWorld();
    const world = {
      ...base,
      quests: base.quests.map((q) =>
        q.id === 'first-steps'
          ? {
              ...q,
              steps: [
                { kind: 'talk' as const, npc: 'elder', text: 'Hear the Elder out.' },
                ...q.steps,
              ],
            }
          : q,
      ),
    };
    h = Harness.of(world);
    h.enter(player('a', { x: 7, y: 2, dir: 's' }));
    h.send('a', 'interact', { npc: 'elder' });
    const out = h.send('a', 'choose', { npc: 'elder', option: 'quest:first-steps' });
    expect(effects(out, 'quest').at(-1)?.quest).toEqual({
      id: 'first-steps',
      step: 1,
      done: false,
    });
    expect(msgs(out, 'a', 'quest').at(-1)?.d.text).toBe('Talk to Pip.');
  });

  it('R-WORLD-005 a reach step completes on arrival in the area; a finished quest is not offered', () => {
    h = Harness.of();
    const out = h.enter(
      player('a', { x: 10, y: 7, quests: [{ id: 'first-steps', step: 2, done: false }] }),
    );
    expect(effects(out, 'quest')[0]?.quest).toEqual({ id: 'first-steps', step: 3, done: false });
    // The zsnap after hello carries the advanced state.
    expect(msgs(out, 'a', 'zsnap')[0]?.d.quests).toEqual([
      { id: 'first-steps', step: 3, done: false },
    ]);
    // A finished quest is never offered again.
    h.enter(
      player('c', { x: 7, y: 2, dir: 's', quests: [{ id: 'first-steps', step: 5, done: true }] }),
    );
    expect(options(h.send('c', 'interact', { npc: 'elder' }), 'c')).toEqual([]);
  });

  it('R-WORLD-005 a quest step already met by a lasting fact completes when it becomes current', () => {
    h = Harness.of();
    h.enter(player('a', { x: 5, y: 2, dir: 's', lessonsDone: ['moves'] }));
    h.core.join(player('a', { quests: [{ id: 'first-steps', step: 0, done: false }] }), h.tick());
    const out = merge(h.send('a', 'hello', {}), h.send('a', 'interact', { npc: 'kid' }));
    // Talk done; the lesson step is met at once (the movement lesson is already done).
    expect(effects(out, 'quest').map((e) => e.quest.step)).toEqual([2]);
  });
});
