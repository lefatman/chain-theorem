/**
 * The overworld host's pure parts (M5): battle setup from zone effects, outcomes and rewards per seat
 * (R-SEC-003, R-LOAD-005, R-WORLD-002, R-WORLD-005), the fighting loadout (R-LOAD-004), stateless
 * party invites (R-WORLD-004) and the cost dashboard (R-COST-002).
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import {
  battleXp,
  lessonById,
  npcById,
  wildReward,
  world,
  type EncounterEntry,
} from '@chain-theorem/content/world';
import { GUARDRAIL_PER_SUBSCRIBER } from '@chain-theorem/protocol';
import type { BattleEvent, Loadout, Side } from '@chain-theorem/rules';
import { BattleCore } from '../battle/core.ts';
import { frame } from '../battle/testing.ts';
import type { BattleArchive, BattleInit, BattleSummary, LogRecord } from '../battle/types.ts';
import {
  HOUR_MS,
  addBattle,
  addZone,
  costDashboard,
  emptyRollup,
  hourOf,
  type ZoneReport,
} from '../metrics.ts';
import { battleSeed, zoneBattle, type BattleOrigin, type Fighter } from './battles.ts';
import { autoLoadout, fightingLoadout } from './loadout.ts';
import {
  MIN_REWARD_PLIES,
  affinitiesUsed,
  battleGrants,
  seatResults,
  totalReward,
  zoneOutcome,
} from './outcome.ts';
import { INVITE_TTL_MS, signInvite, verifyInvite } from './party.ts';
import { factsFromFlags } from './progress.ts';

const T0 = 1_760_000_000_000;
const PLAIN: Loadout = { elements: ['tide'], items: [], sets: [[]] };
const ALICE = '0192f0a0-0000-7000-8000-000000000001';
const BOB = '0192f0a0-0000-7000-8000-000000000002';

const fighter = (playerId: string, level = 3): Fighter => ({
  playerId,
  name: playerId.slice(-1),
  level,
  loadout: PLAIN,
});

/** Play a real battle: 1. e4 e5, then `loser` resigns (or both keep playing `extra` plies). */
function finished(
  init: BattleInit,
  loser: Side,
  plies = 2,
): { summary: BattleSummary; archive: BattleArchive } {
  const { core } = BattleCore.create(init, T0);
  for (const side of ['white', 'black'] as const) {
    if (!('playerId' in init[side])) continue;
    core.connect(side, T0);
    core.message(side, frame('hello', { from: 0 }), T0);
  }
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6'].slice(0, plies);
  let t = T0;
  let ended: { summary: BattleSummary; archive: BattleArchive } | null = null;
  const take = (out: ReturnType<BattleCore['message']>) => {
    for (const e of out.effects) if (e.kind === 'ended') ended = e;
  };
  for (const [i, move] of moves.entries()) {
    const side: Side = i % 2 === 0 ? 'white' : 'black';
    t += 1000;
    if ('playerId' in init[side]) take(core.message(side, frame('mv', { move }), t));
    else take(core.alarm(core.nextAlarm() ?? t));
  }
  take(core.message(loser, frame('resign', {}), t + 1000));
  if (!ended) throw new Error('battle did not end');
  return ended;
}

/** NPC seats cannot resign: the human resigns, then the test reads the result as `winner`. */
function npcBattle(init: BattleInit, winner: Side | null) {
  const human: Side = 'playerId' in init.white ? 'white' : 'black';
  const b = finished(init, human);
  return { ...b, summary: { ...b.summary, result: { winner, reason: 'objective' as const } } };
}

const triggered = (side: Side, ability: string, i: number): BattleEvent => ({
  i,
  depth: 0,
  k: 'AbilityTriggered',
  side,
  piece: 1,
  pieceType: 'knight',
  ability,
  category: 'CAPTURING',
  attuned: false,
});

describe('battles from zone effects (R-WORLD-002, R-WORLD-003, R-FMT-005)', () => {
  it('R-WORLD-002 R-LOAD-004 a wild encounter builds a legal army of the entry element at its level', () => {
    const entry: EncounterEntry = {
      weight: 1,
      levels: [2, 4],
      element: 'grove',
      name: 'Wild Test',
    };
    const { init, origin } = zoneBattle(
      'b-wild',
      'route_1',
      { kind: 'wild', players: [ALICE], format: 'first_blood', zone: 'route_1', entry, level: 3 },
      new Map([[ALICE, fighter(ALICE)]]),
      true,
    );
    expect(init.white).toMatchObject({ playerId: ALICE });
    expect(init.black).toMatchObject({ tier: 'wild', name: 'Wild Test', level: 3 });
    expect('loadout' in init.black && init.black.loadout.elements).toEqual(['grove']);
    expect(engine.validateLoadout(init.black.loadout, { level: 3 }).errors).toEqual([]);
    expect(origin).toEqual({
      kind: 'wild',
      zone: 'route_1',
      name: 'Wild Test',
      element: 'grove',
      level: 3,
    });
    // The same battle id always builds the same army (the seed is the battle id).
    const again = zoneBattle(
      'b-wild',
      'route_1',
      { kind: 'wild', players: [ALICE], format: 'first_blood', zone: 'route_1', entry, level: 3 },
      new Map([[ALICE, fighter(ALICE)]]),
      false,
    );
    expect(again.init.white.loadout).toEqual(init.black.loadout);
    expect(battleSeed('b-wild')).toBe(battleSeed('b-wild'));
    expect(battleSeed('b-wild')).not.toBe(battleSeed('b-wilc'));
  });

  it('R-FMT-005 R-LOAD-004 every world trainer seats a legal loadout at its level', () => {
    for (const npc of world.npcs) {
      if (npc.role.kind !== 'trainer') continue;
      const { init, origin } = zoneBattle(
        `b-${npc.id}`,
        'route_1',
        {
          kind: 'trainer',
          players: [ALICE],
          format: npc.role.format,
          npc: npc.id,
          tier: npc.role.tier,
          level: npc.role.level,
        },
        new Map([[ALICE, fighter(ALICE)]]),
        true,
      );
      expect(init.black).toMatchObject({ npcId: npc.id, level: npc.role.level, name: npc.name });
      expect(engine.validateLoadout(init.black.loadout, { level: npc.role.level }).errors).toEqual(
        [],
      );
      expect(origin).toMatchObject({ kind: 'trainer', npc: npc.id });
    }
  });

  it('R-WORLD-003 a battle lesson seats the lesson loadouts with the player as White', () => {
    const lesson = world.lessons.find((l) => l.kind === 'battle');
    if (lesson?.kind !== 'battle') throw new Error('no battle lesson');
    const { init, origin } = zoneBattle(
      'b-lesson',
      'academy_hall',
      { kind: 'lesson', players: [ALICE], format: lesson.format, lesson: lesson.id },
      new Map([[ALICE, fighter(ALICE, 1)]]),
      false,
    );
    expect(init.white).toMatchObject({
      playerId: ALICE,
      level: lesson.player.level,
      loadout: lesson.player.loadout,
    });
    expect(init.black).toMatchObject({ name: lesson.npc.name, loadout: lesson.npc.loadout });
    expect(origin).toEqual({ kind: 'lesson', zone: 'academy_hall', lesson: lesson.id });
    expect(() =>
      zoneBattle(
        'b-x',
        'academy_hall',
        { kind: 'lesson', players: [ALICE], format: 'first_blood', lesson: 'moves_basics' },
        new Map([[ALICE, fighter(ALICE)]]),
        true,
      ),
    ).toThrow(/not a battle lesson/);
  });

  it('R-WORLD-004 a challenge seats both players with their own loadouts', () => {
    const { init, origin } = zoneBattle(
      'b-chal',
      'route_1',
      { kind: 'challenge', players: [ALICE, BOB], format: 'first_blood', auto: true },
      new Map([
        [ALICE, fighter(ALICE)],
        [BOB, fighter(BOB)],
      ]),
      false,
    );
    expect(init.white).toMatchObject({ playerId: BOB });
    expect(init.black).toMatchObject({ playerId: ALICE });
    expect(origin).toEqual({ kind: 'challenge', zone: 'route_1', auto: true });
  });
});

describe('outcomes and rewards (R-SEC-003, R-LOAD-005, R-WORLD-005)', () => {
  const pvp = (): BattleInit => ({
    battleId: 'b-pvp',
    format: 'first_blood',
    white: { playerId: ALICE, name: 'A', level: 3, loadout: PLAIN },
    black: { playerId: BOB, name: 'B', level: 7, loadout: PLAIN },
  });

  it('R-WORLD-005 each human seat gets its result and the affinities of the abilities it used', () => {
    const { summary, archive } = finished(pvp(), 'black');
    const extra: LogRecord = {
      n: 99,
      at: T0,
      cause: 'player',
      input: null,
      from: 1000,
      events: [
        triggered('white', 'hit_and_run', 1000),
        triggered('white', 'veil', 1001),
        triggered('black', 'backdraft', 1002),
        triggered('white', 'poisoned_meat', 1003),
      ],
      seen: { white: [], black: [] },
    };
    const withAbilities = { ...archive, records: [...archive.records, extra] };
    expect(affinitiesUsed(withAbilities, 'white')).toEqual(['grove', 'tide']);
    expect(affinitiesUsed(withAbilities, 'black')).toEqual(['ember']);
    expect(seatResults(summary, archive)).toEqual([
      { playerId: ALICE, side: 'white', result: 'win', level: 3, opponentLevel: 7, affinities: [] },
      { playerId: BOB, side: 'black', result: 'loss', level: 7, opponentLevel: 3, affinities: [] },
    ]);
  });

  it('R-SEC-003 R-LOAD-005 PvP pays battle XP by format, result and opponent level under one key per battle', () => {
    const { summary, archive } = finished(pvp(), 'black');
    const [a, b] = seatResults(summary, archive);
    if (!a || !b) throw new Error('two seats');
    const origin: BattleOrigin = { kind: 'challenge', zone: 'route_1', auto: false };
    expect(battleGrants(origin, a, summary)).toEqual([
      { key: 'battle:b-pvp', reward: { xp: battleXp('first_blood', 'win', 7) }, flags: [] },
    ]);
    expect(battleGrants(origin, b, summary)[0]?.reward.xp).toBe(battleXp('first_blood', 'loss', 3));
    expect(zoneOutcome(origin, a, summary)).toEqual({
      result: 'win',
      kind: 'challenge',
      format: 'first_blood',
      affinities: [],
    });
    // Link and queue battles pay the same but are not zone events.
    expect(zoneOutcome({ kind: 'pvp' }, a, summary)).toBeNull();
    expect(battleGrants({ kind: 'pvp' }, a, summary)).toEqual(battleGrants(origin, a, summary));
  });

  it(`R-SEC-003 a battle shorter than ${MIN_REWARD_PLIES} plies pays nothing (instant resign)`, () => {
    const { summary, archive } = finished(pvp(), 'white', 0);
    expect(summary.plies).toBeLessThan(MIN_REWARD_PLIES);
    for (const seat of seatResults(summary, archive))
      expect(battleGrants({ kind: 'pvp' }, seat, summary)).toEqual([]);
  });

  it('R-WORLD-002 R-SEC-003 wild rewards are seeded by the battle id: the same battle always pays the same', () => {
    const wild: BattleInit = {
      battleId: 'b-wild-reward',
      format: 'first_blood',
      white: { playerId: ALICE, name: 'A', level: 4, loadout: PLAIN },
      black: { tier: 'wild', name: 'Wild', level: 3, loadout: PLAIN },
    };
    const { summary, archive } = npcBattle(wild, 'white');
    const [seat] = seatResults(summary, archive);
    if (!seat) throw new Error('one seat');
    const origin: BattleOrigin = {
      kind: 'wild',
      zone: 'route_1',
      name: 'Wild',
      element: 'tide',
      level: 3,
    };
    const plans = battleGrants(origin, seat, summary);
    expect(plans).toEqual([
      {
        key: 'battle:b-wild-reward',
        reward: wildReward({
          seed: battleSeed('b-wild-reward'),
          outcome: 'win',
          playerLevel: 4,
          npcLevel: 3,
          element: 'tide',
        }),
        flags: [],
      },
    ]);
    expect(battleGrants(origin, seat, summary)).toEqual(plans);
    expect(zoneOutcome(origin, seat, summary)).toMatchObject({ kind: 'wild', tier: 'wild' });
  });

  it('R-WORLD-005 R-SEC-003 a story trainer pays its bonus once per player (own key and defeated flag); practice trainers every win', () => {
    const story = world.npcs.find((n) => n.role.kind === 'trainer' && n.role.once);
    const practice = world.npcs.find((n) => n.role.kind === 'trainer' && !n.role.once);
    if (story?.role.kind !== 'trainer' || practice?.role.kind !== 'trainer')
      throw new Error('fixture trainers');
    const init: BattleInit = {
      battleId: 'b-trainer',
      format: story.role.format,
      white: { playerId: ALICE, name: 'A', level: 4, loadout: PLAIN },
      black: { tier: 'trainer', name: story.name, level: story.role.level, loadout: PLAIN },
    };
    const { summary, archive } = npcBattle(init, 'white');
    const [seat] = seatResults(summary, archive);
    if (!seat) throw new Error('one seat');
    const o = (npc: string): BattleOrigin => ({
      kind: 'trainer',
      zone: 'route_1',
      npc,
      tier: 'trainer',
      level: story.role.kind === 'trainer' ? story.role.level : 1,
    });
    expect(battleGrants(o(story.id), seat, summary)).toEqual([
      {
        key: 'battle:b-trainer',
        reward: { xp: battleXp(summary.format, 'win', story.role.level) },
        flags: [],
      },
      {
        key: `trainer:${ALICE}:${story.id}`,
        reward: story.role.reward,
        flags: [`npc:${story.id}`],
      },
    ]);
    expect(battleGrants(o(practice.id), seat, summary)[1]).toEqual({
      key: 'battle:b-trainer:bonus',
      reward: practice.role.reward,
      flags: [],
    });
    // A loss pays battle XP only.
    const lost = npcBattle({ ...init, battleId: 'b-trainer-2' }, 'black');
    const [l] = seatResults(lost.summary, lost.archive);
    if (!l) throw new Error('one seat');
    expect(battleGrants(o(story.id), l, lost.summary)).toHaveLength(1);
  });

  it('R-WORLD-003 a lesson battle pays nothing itself: the lesson reward comes when the lesson completes', () => {
    const lesson = world.lessons.find((x) => x.kind === 'battle');
    if (!lesson) throw new Error('no battle lesson');
    const { summary, archive } = finished(pvp(), 'black');
    const [seat] = seatResults(summary, archive);
    if (!seat) throw new Error('seat');
    const origin: BattleOrigin = { kind: 'lesson', zone: 'academy_hall', lesson: lesson.id };
    expect(battleGrants(origin, seat, summary)).toEqual([]);
    expect(zoneOutcome(origin, seat, summary)).toMatchObject({ kind: 'lesson', lesson: lesson.id });
    expect(lessonById.get(lesson.id)?.reward.xp).toBeGreaterThan(0);
  });

  it('R-LOAD-005 rewards add up for the player-facing total', () => {
    expect(
      totalReward([
        { xp: 10, coins: 3, cards: [{ id: 'scout', qty: 1 }] },
        { xp: 5, cards: [{ id: 'scout', qty: 1 }], keyItems: ['hush_candle'] },
      ]),
    ).toEqual({ xp: 15, coins: 3, cards: [{ id: 'scout', qty: 2 }], keyItems: ['hush_candle'] });
    expect(npcById.size).toBe(world.npcs.length);
  });

  it('R-WORLD-005 progress flags split into lessons, defeated trainers and visited zones', () => {
    expect(factsFromFlags(['lesson:a', 'npc:b', 'zone:c', 'other'])).toEqual({
      lessonsDone: ['a'],
      defeatedNpcs: ['b'],
      zonesSeen: ['c'],
    });
  });
});

describe('the fighting loadout (R-LOAD-004, DD-78)', () => {
  const starter = {
    level: 1,
    ownedItems: ['dual_adepts_glove'],
    ownedAbilities: ['hit_and_run', 'last_word', 'scout'],
  };

  it('R-LOAD-004 a new player with no saved loadout fights with a legal build from their own collection', () => {
    for (const facts of [
      starter,
      { ...starter, level: 5 },
      { level: 1, ownedItems: [], ownedAbilities: [] },
      { level: 12, ownedItems: ['dual_adepts_glove'], ownedAbilities: ['backdraft', 'scout'] },
    ]) {
      const l = autoLoadout(facts);
      expect(engine.validateLoadout(l, facts).errors).toEqual([]);
      for (const id of l.sets.flat()) expect(facts.ownedAbilities).toContain(id);
      for (const id of l.items) expect(facts.ownedItems).toContain(id);
    }
    expect(autoLoadout(starter).sets.flat().length).toBeGreaterThan(0);
  });

  it('R-LOAD-004 the newest saved loadout that is legal now wins; illegal ones are skipped', () => {
    const legal: Loadout = { elements: ['tide'], items: [], sets: [['scout']] };
    const notOwned: Loadout = { elements: ['ember'], items: [], sets: [['riposte']] };
    expect(
      fightingLoadout(
        [
          { loadout: legal, updatedAt: 1 },
          { loadout: notOwned, updatedAt: 3 },
        ],
        starter,
      ),
    ).toEqual(legal);
    expect(fightingLoadout([{ loadout: notOwned, updatedAt: 3 }], starter)).toEqual(
      autoLoadout(starter),
    );
  });
});

describe('party invitations (R-WORLD-004, DD-79)', () => {
  const SECRET = 'x'.repeat(64);

  it('R-WORLD-004 an invite id names its inviter, fits the protocol id limit, and works only for the invitee until it expires', async () => {
    const id = await signInvite(SECRET, ALICE, BOB, T0);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(await verifyInvite(SECRET, id, BOB, T0 + 1000)).toBe(ALICE);
    expect(await verifyInvite(SECRET, id, ALICE, T0)).toBeNull();
    expect(await verifyInvite(SECRET, id, BOB, T0 + INVITE_TTL_MS + 1000)).toBeNull();
    expect(await verifyInvite('y'.repeat(64), id, BOB, T0)).toBeNull();
    const [exp, who, mac] = id.split('.');
    const flipped = `${exp}.${who}.${mac?.slice(0, -1)}${mac?.endsWith('A') ? 'B' : 'A'}`;
    expect(await verifyInvite(SECRET, flipped, BOB, T0)).toBeNull();
    expect(await verifyInvite(SECRET, 'garbage', BOB, T0)).toBeNull();
    await expect(signInvite(SECRET, 'not-a-uuid', BOB, T0)).rejects.toThrow();
  });
});

describe('the cost dashboard (R-COST-002, 14.2)', () => {
  const report = (over: Partial<ZoneReport> = {}): ZoneReport => ({
    zone: 'route_1',
    channel: 0,
    from: T0,
    to: T0 + 60_000,
    players: 50,
    playerMs: 50 * 60_000,
    in: { step: 50 * 60, chat: 20 },
    out: { zstep: 50 * 60 * 49 },
    dropped: { rate: 3, invalid: 1, refused: 2 },
    encounters: 4,
    battles: 4,
    host: { rowsWritten: 6, doRequests: 3, joins: 1 },
    ...over,
  });

  it('R-COST-002 rollups count billed frames, player time, rows and requests', () => {
    const r = emptyRollup(hourOf(T0));
    addZone(r, report());
    expect(r).toMatchObject({
      playerMs: 50 * 60_000,
      zoneMs: 60_000,
      zoneIn: 50 * 60 + 20 + 4,
      zoneDropped: 6,
      encounters: 4,
      rowsWritten: 6,
      doRequests: 3,
      workerRequests: 2,
    });
    addBattle(r, { at: T0, messages: 40, records: 30, npcMoves: 15, alarms: 16, humans: 1 });
    expect(r).toMatchObject({ battles: 1, battleIn: 40, npcMoves: 15, rowsWritten: 66 });
  });

  it('R-COST-002 a 14.1-like load stays inside the $0.10 guardrail; a runaway write rate raises the alert', () => {
    const hour = hourOf(T0);
    const ok = emptyRollup(hour);
    for (let m = 0; m < 60; m++)
      addZone(ok, report({ from: hour + m * 60_000, to: hour + (m + 1) * 60_000 }));
    const d = costDashboard([ok]);
    expect(d.total.cost.perSubscriberMonth).toBeLessThan(GUARDRAIL_PER_SUBSCRIBER);
    expect(d.total.alert).toBe(false);
    expect(d.perZoneHour).toBeGreaterThan(0);
    const bad = emptyRollup(hour + HOUR_MS);
    addZone(bad, report({ host: { rowsWritten: 5_000_000, doRequests: 0, joins: 0 } }));
    const d2 = costDashboard([ok, bad]);
    expect(d2.hours.map((h) => h.alert)).toEqual([false, true]);
  });
});
