/**
 * The M5 world content (spec 10): zones and warps (R-WORLD-001), encounters and pacing
 * (R-WORLD-002), the Chess Academy lessons (R-WORLD-003), quests and rewards (R-WORLD-005), legal
 * NPC and lesson loadouts (R-LOAD-004) and original names (R-ART-003).
 */
import { describe, expect, it } from 'vitest';
import { moveToUci, type Loadout } from '@chain-theorem/rules';
import { abilityById, engine, itemById } from '../index.ts';
import { npcBuild } from '../src/npcs.ts';
import type {
  KeyItemDef,
  LessonDef,
  NpcDef,
  QuestDef,
  QuestStep,
  TiledTileLayer,
  ZoneDef,
} from './types.ts';
import {
  encounterRateFor,
  keyItemById,
  lessonById,
  npcById,
  npcLocation,
  questById,
  sessionEncounters,
  PACING,
  TILES,
  validateWorld,
  walkable,
  world,
  zoneById,
  zoneGeometry,
} from './index.ts';

interface MutableWorld {
  zones: ZoneDef[];
  npcs: NpcDef[];
  lessons: LessonDef[];
  quests: QuestDef[];
  keyItems: KeyItemDef[];
  start: { zone: string };
}
const copy = (): MutableWorld => structuredClone(world) as unknown as MutableWorld;
const find = <T extends { id: string }>(list: T[], id: string): T => {
  const x = list.find((e) => e.id === id);
  if (!x) throw new Error(`no ${id}`);
  return x;
};

describe('world registry', () => {
  it('R-WORLD-001 R-WORLD-002 R-WORLD-003 R-WORLD-005 R-LOAD-004 the shipped world passes validateWorld', () => {
    expect(validateWorld(world)).toEqual([]);
  });

  it('R-WORLD-001 the vertical slice: the Chess Academy (start), its town, one route with a challenge zone, a wild patch, and the M7 highland route', () => {
    expect(world.zones.map((z) => [z.id, z.kind])).toEqual([
      ['academy_hall', 'interior'],
      ['academy_town', 'town'],
      ['route_1', 'route'],
      ['thistle_meadow', 'wild'],
      ['highcairn_pass', 'route'],
    ]);
    expect(world.start.zone).toBe('academy_hall');
    expect(zoneGeometry('route_1').challenge).toHaveLength(1);
    expect(zoneById.get('route_1')?.format).toBe('first_blood'); // 10.4 challenge zones, DD-04
    for (const z of world.zones) {
      const g = zoneGeometry(z.id);
      expect(walkable(g, g.spawn.x, g.spawn.y), z.id).toBe(true);
    }
    // Lookups cover every entry.
    expect(npcById.size).toBe(world.npcs.length);
    expect(lessonById.size).toBe(world.lessons.length);
    expect(questById.size).toBe(world.quests.length);
    expect(keyItemById.size).toBe(world.keyItems.length);
    expect(() => zoneGeometry('nowhere')).toThrow(/unknown zone/);
  });

  it('R-WORLD-001 warps connect both ways: Academy <-> Rookhaven <-> route <-> meadow <-> Highcairn Pass', () => {
    const edges = new Set<string>();
    for (const z of world.zones) {
      for (const wp of zoneGeometry(z.id).warps) {
        edges.add(`${z.id}>${wp.to}`);
        // Stepping back onto the neighbouring warp returns next to where the player left.
        const target = zoneGeometry(wp.to);
        const back = target.warps.find(
          (b) => b.to === z.id && Math.abs(b.x - wp.toX) + Math.abs(b.y - wp.toY) === 1,
        );
        expect(back, `${z.id} ${wp.x},${wp.y}`).toBeDefined();
        expect(Math.abs((back?.toX ?? -9) - wp.x) + Math.abs((back?.toY ?? -9) - wp.y)).toBe(1);
      }
    }
    expect([...edges].sort()).toEqual(
      [
        'academy_hall>academy_town',
        'academy_town>academy_hall',
        'academy_town>route_1',
        'route_1>academy_town',
        'route_1>thistle_meadow',
        'thistle_meadow>route_1',
        'thistle_meadow>highcairn_pass',
        'highcairn_pass>thistle_meadow',
      ].sort(),
    );
  });

  it('R-WORLD-001 every NPC stands in exactly one zone, and each map NPC object is a known NPC', () => {
    for (const n of world.npcs) expect(npcLocation(n.id), n.id).not.toBeNull();
    expect(npcLocation('headmaster_orla')?.zone).toBe('academy_hall');
    expect(npcLocation('trainer_pell')?.zone).toBe('route_1');
    expect(npcLocation('nobody')).toBeNull();
    for (const z of world.zones)
      for (const n of zoneGeometry(z.id).npcs) expect(npcById.has(n.id), n.id).toBe(true);
  });

  it('R-WORLD-001 R-WORLD-002 R-WORLD-005 the validator catches broken maps and references', () => {
    // An NPC object naming nobody, and a warp with no way back.
    const w = copy();
    const town = find(w.zones, 'academy_town');
    const objects = town.map.layers.find((l) => l.type === 'objectgroup');
    if (objects?.type !== 'objectgroup') throw new Error('no objects');
    const npcObj = objects.objects.find((o) => o.type === 'npc');
    const warpObj = objects.objects.find((o) => o.type === 'warp');
    for (const p of npcObj?.properties ?? []) if (p.name === 'npc') p.value = 'ghost';
    for (const p of warpObj?.properties ?? []) if (p.name === 'toX') p.value = 1;
    const e1 = validateWorld(w);
    expect(e1).toContain('zone academy_town: NPC object ghost is not a known NPC');
    expect(e1.some((e) => /warp at 6,6: (has no way back|lands on a blocked tile)/.test(e))).toBe(
      true,
    );

    // Broken references and an illegal loadout.
    const w2 = copy();
    const pell = find(w2.npcs, 'trainer_pell');
    if (pell.role.kind !== 'trainer' || 'buildSeed' in pell.role.loadout) throw new Error('pell');
    pell.role.loadout = { elements: ['ember'], items: [], sets: [['hit_and_run', 'last_word']] };
    find(w2.quests, 'academy_first_road').reward.cards = [{ id: 'teleport', qty: 1 }];
    find(w2.quests, 'academy_tide_trial').requires = ['academy_nowhere'];
    const tutor = find(w2.npcs, 'tutor_juno');
    if (tutor.role.kind === 'teacher') tutor.role.lessons = ['ability_nowhere'];
    const e2 = validateWorld(w2);
    expect(e2.some((e) => e.startsWith('npc trainer_pell: R-LOAD-004 rule 4'))).toBe(true);
    expect(e2).toContain('quest academy_first_road: reward card teleport is not an ability');
    expect(e2).toContain('quest academy_tide_trial: requires unknown quest academy_nowhere');
    expect(e2).toContain('npc tutor_juno: teaches unknown lesson ability_nowhere');
    expect(e2).toContain('lesson ability_scout: no teacher offers it');
  });

  it('R-WORLD-003 R-WORLD-005 the validator catches wrong puzzle answers, lessons teaching two abilities and quest cycles', () => {
    const w = copy();
    const mate = find(w.lessons, 'checkmate_basics');
    if (mate.kind !== 'puzzles' || !mate.puzzles[1]) throw new Error('puzzles');
    mate.puzzles[1].accept = ['a7a8', 'a7a1', 'h1h2'];
    const scout = find(w.lessons, 'ability_scout');
    if (scout.kind !== 'battle') throw new Error('battle');
    scout.player.loadout = {
      elements: ['tide'],
      items: ['dual_adepts_glove'],
      sets: [['scout', 'hit_and_run']],
    };
    const elements = find(w.lessons, 'elements_triangle');
    if (elements.kind === 'battle') elements.npc.loadout.elements = ['tide'];
    find(w.quests, 'academy_tide_trial').requires = ['academy_tide_trial'];
    const pell = find(w.npcs, 'trainer_pell');
    if (pell.role.kind === 'trainer') pell.role.once = false;
    w.keyItems.push({ id: 'orphan_bell', name: 'Orphan Bell', text: 'Nobody hands this out.' });
    const errors = validateWorld(w);
    const where = 'lesson checkmate_basics: puzzle 1:';
    expect(errors).toContain(`${where} accepted move a7a1 does not deliver checkmate`);
    expect(errors).toContain(`${where} accepted move h1h2 is illegal`);
    expect(errors).toContain(
      `${where} moves that also deliver checkmate are not accepted: a7g7 a7h7 a7b8`,
    );
    expect(errors).toContain(
      'lesson ability_scout: an ability lesson teaches exactly one ability (the player carries 2)',
    );
    expect(errors).toContain(
      'lesson elements_triangle: an element lesson pits one element against one it beats or loses to',
    );
    expect(errors).toContain('quest academy_tide_trial: prerequisites form a cycle');
    expect(errors).toContain(
      'quest academy_first_road step 2: trainer_pell is a practice trainer; story steps need a once trainer',
    );
    expect(errors).toContain('key item orphan_bell: no quest, lesson or trainer grants it');
  });

  it('R-WORLD-002 the validator rejects a zone whose only road runs through wild grass', () => {
    const w = copy();
    const route = find(w.zones, 'route_1');
    const ground = route.map.layers.find((l) => l.type === 'tilelayer') as TiledTileLayer;
    const tall = TILES.findIndex((t) => t.kind === 'tall_grass') + 1;
    for (let x = 0; x < route.map.width; x++) ground.data[30 * route.map.width + x] = tall;
    const errors = validateWorld(w);
    expect(errors.some((e) => /without crossing wild grass|needs a path that avoids/.test(e))).toBe(
      true,
    );
  });
});

describe('encounters (R-WORLD-002)', () => {
  it('R-WORLD-002 towns and the Academy have no wild grass; the route and the meadow have grass and tables', () => {
    for (const z of world.zones) {
      const wild = zoneGeometry(z.id).wild.reduce((n, v) => n + v, 0);
      if (z.kind === 'town' || z.kind === 'interior') {
        expect(wild, z.id).toBe(0);
        expect(z.encounterRate).toBe(0);
      } else {
        expect(wild, z.id).toBeGreaterThan(50);
        expect(z.encounterRate).toBeGreaterThan(0);
        expect(z.encounters.length).toBeGreaterThan(0);
      }
    }
    // The first route stays low level; the meadow is a step up.
    const route = zoneById.get('route_1');
    expect(Math.max(...(route?.encounters ?? []).map((e) => e.levels[1]))).toBeLessThanOrEqual(3);
  });

  it('R-WORLD-002 17.2 rates fit a 30-minute session of about 4-6 First Blood encounters, with or without the Hush Candle', () => {
    const [lo, hi] = PACING.target;
    const candle = keyItemById.get('hush_candle')?.encounterRate ?? 1;
    expect(candle).toBe(0.5);
    for (const z of world.zones.filter((z) => z.encounterRate > 0)) {
      const n = sessionEncounters(z.encounterRate, z.encounterGrace);
      const quiet = sessionEncounters(z.encounterRate, z.encounterGrace, candle);
      expect(n, z.id).toBeGreaterThanOrEqual(lo);
      expect(n, z.id).toBeLessThanOrEqual(hi);
      expect(quiet, z.id).toBeGreaterThanOrEqual(lo);
      expect(quiet).toBeLessThan(n);
    }
    // A player who stays on the paths meets nothing; the Candle halves the per-step chance.
    const route = zoneById.get('route_1') as ZoneDef;
    expect(encounterRateFor(route, [])).toBe(route.encounterRate);
    expect(encounterRateFor(route, ['hush_candle', 'hush_candle'])).toBeCloseTo(
      route.encounterRate / 2,
    );
  });
});

describe('Chess Academy (R-WORLD-003)', () => {
  const enrolment = questById.get('academy_enrolment') as QuestDef;
  const lessonSteps = enrolment.steps.flatMap((s) => (s.kind === 'lesson' ? [s.lesson] : []));
  const lessons = lessonSteps.map((id) => lessonById.get(id) as LessonDef);

  it('R-WORLD-003 movement, check and checkmate puzzles (skippable), then one ability at a time, then elements (never skippable)', () => {
    expect(lessons.map((l) => l.topic)).toEqual([
      'movement',
      'check',
      'checkmate',
      'ability',
      'ability',
      'ability',
      'element',
    ]);
    expect([...lessonSteps].sort()).toEqual(world.lessons.map((l) => l.id).sort());
    const taught = new Set<string>();
    for (const l of lessons) {
      if (l.kind === 'puzzles') {
        expect(l.skippable).toBe(true);
        continue;
      }
      expect(l.skippable, l.id).toBe(false);
      expect(l.format, l.id).toBe('first_blood');
      expect(l.fen, l.id).toBeUndefined(); // full 16-piece armies (9.1)
      const own = [...new Set(l.player.loadout.sets.flat())];
      if (l.topic === 'ability') {
        expect(own, l.id).toHaveLength(1);
        expect(taught.has(own[0] ?? ''), l.id).toBe(false);
        taught.add(own[0] ?? '');
        // The same element on both sides: nothing is silenced while learning the ability.
        expect(l.npc.loadout.elements).toEqual(l.player.loadout.elements);
      }
      expect(l.player.level).toBeLessThanOrEqual(2);
    }
    expect(taught).toEqual(new Set(['hit_and_run', 'scout', 'poisoned_meat']));
  });

  it('R-WORLD-003 every accepted puzzle move is legal and reaches the goal, checked with the engine', () => {
    const sandbox: Loadout = { elements: ['neutral'], items: [], sets: [[]] };
    let checked = 0;
    for (const l of world.lessons) {
      if (l.kind !== 'puzzles') continue;
      for (const p of l.puzzles) {
        const { state } = engine.newBattle({
          format: 'full',
          white: { level: 1, loadout: sandbox },
          black: { level: 1, loadout: sandbox },
          fen: p.fen,
        });
        const side = state.turn;
        const legal = engine.legalMoves(state, side);
        for (const uci of p.accept) {
          const move = legal.find((m) => moveToUci(m) === uci);
          expect(move, `${l.id} ${uci} is legal`).toBeDefined();
          if (!move) continue;
          const r = engine.applyAction(state, { kind: 'move', side, move });
          if (l.topic === 'movement')
            expect(r.events.some((e) => e.k === 'MoveMade' && e.capture)).toBe(true);
          if (l.topic === 'check') expect(r.state.inCheck, `${l.id} ${uci}`).toBe('black');
          if (l.topic === 'checkmate')
            expect(r.state.result, `${l.id} ${uci}`).toEqual({ winner: side, reason: 'checkmate' });
          checked++;
        }
        expect(p.prompt.length).toBeLessThanOrEqual(400);
        expect(p.fen.length).toBeLessThanOrEqual(100);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  it('R-WORLD-003 R-LOAD-004 lesson loadouts are legal at their levels and every lesson battle starts strictly', () => {
    for (const l of world.lessons) {
      if (l.kind !== 'battle') continue;
      expect(engine.validateLoadout(l.player.loadout, { level: l.player.level }).errors).toEqual(
        [],
      );
      expect(engine.validateLoadout(l.npc.loadout, { level: l.npc.level }).errors).toEqual([]);
      const { state } = engine.newBattle({
        format: l.format,
        white: l.player,
        black: { level: l.npc.level, loadout: l.npc.loadout },
        strict: true,
      });
      expect(state.pieces).toHaveLength(32);
    }
  });
});

describe('NPC trainers (R-LOAD-004)', () => {
  it('R-LOAD-004 every trainer loadout is legal at its level, fixed or seeded, and its battle starts strictly', () => {
    const trainers = world.npcs.filter((n) => n.role.kind === 'trainer');
    expect(trainers.length).toBeGreaterThanOrEqual(3);
    for (const n of trainers) {
      if (n.role.kind !== 'trainer') continue;
      const loadout =
        'buildSeed' in n.role.loadout
          ? npcBuild(n.role.tier, n.role.level, n.role.loadout.buildSeed).loadout
          : n.role.loadout;
      expect(engine.validateLoadout(loadout, { level: n.role.level }).errors, n.id).toEqual([]);
      expect(loadout.sets.flat().length, n.id).toBeGreaterThan(0);
      const player: Loadout = { elements: ['tide'], items: [], sets: [['scout']] };
      expect(() =>
        engine.newBattle({
          format: n.role.kind === 'trainer' ? n.role.format : 'first_blood',
          white: { level: 1, loadout: player },
          black: { level: n.role.kind === 'trainer' ? n.role.level : 1, loadout },
          strict: true,
        }),
      ).not.toThrow();
    }
  });
});

describe('quests (R-WORLD-005)', () => {
  it('R-WORLD-005 the Academy line runs in order: Headmaster, lessons, the route gate, a route trainer, a wild win, a Tide-only win', () => {
    const line = ['academy_enrolment', 'academy_first_road', 'academy_tide_trial'].map(
      (id) => questById.get(id) as QuestDef,
    );
    expect(line.map((q) => q.requires)).toEqual([
      [],
      ['academy_enrolment'],
      ['academy_first_road'],
    ]);
    const steps: QuestStep[] = line.flatMap((q) => q.steps);
    const brief = steps.map((s) =>
      s.kind === 'talk'
        ? `talk:${s.npc}`
        : s.kind === 'lesson'
          ? 'lesson'
          : s.kind === 'reach'
            ? `reach:${s.zone}/${s.area}`
            : s.kind === 'defeat'
              ? `defeat:${s.npc}`
              : `win:${JSON.stringify(s.constraint)}`,
    );
    expect(brief).toEqual([
      'talk:headmaster_orla',
      ...Array<string>(7).fill('lesson'),
      'talk:headmaster_orla',
      'talk:gatekeeper_tomas',
      'reach:route_1/south_gate',
      'defeat:trainer_pell',
      'win:{"wild":true,"tier":"wild","format":"first_blood"}',
      'talk:gatekeeper_tomas',
      'talk:captain_wren',
      'win:{"onlyAffinity":"tide"}',
      'talk:headmaster_orla',
    ]);
    expect(npcLocation('trainer_pell')?.zone).toBe('route_1');
    // The Tide-only constraint is reachable with the level-1 cards every new account owns (DD-64).
    const tideOnly: Loadout = {
      elements: ['tide'],
      items: ['dual_adepts_glove'],
      sets: [['hit_and_run', 'scout']],
    };
    const owned = ['dual_adepts_glove', 'hit_and_run', 'last_word', 'scout'];
    expect(
      engine.validateLoadout(tideOnly, { level: 3, ownedItems: owned, ownedAbilities: owned })
        .errors,
    ).toEqual([]);
    expect(tideOnly.sets.flat().every((id) => abilityById.get(id)?.affinity === 'tide')).toBe(true);
  });

  it('R-WORLD-005 rewards are early-level items and cards, and the line ends with a key item that lowers the encounter rate', () => {
    // The M5 slice (the Academy line, its lessons and the trainers of the first four zones) rewards
    // early-level modules; Highcairn Pass (M7) has its own band, checked below.
    const m5 = new Set(['academy_hall', 'academy_town', 'route_1', 'thistle_meadow']);
    const rewards = [
      ...world.quests.filter((q) => q.id.startsWith('academy_')).map((q) => q.reward),
      ...world.lessons.map((l) => l.reward),
      ...world.npcs.flatMap((n) =>
        n.role.kind === 'trainer' && m5.has(npcLocation(n.id)?.zone ?? '') ? [n.role.reward] : [],
      ),
    ];
    expect(rewards.length).toBeGreaterThan(10);
    for (const r of rewards) {
      for (const i of r.items ?? [])
        expect(itemById.get(i.id)?.minLevel, i.id).toBeLessThanOrEqual(6);
      for (const c of r.cards ?? [])
        expect(abilityById.get(c.id)?.minLevel, c.id).toBeLessThanOrEqual(6);
    }
    const trial = questById.get('academy_tide_trial');
    expect(trial?.reward.keyItems).toEqual(['hush_candle']);
    expect(keyItemById.get('hush_candle')?.encounterRate).toBeLessThan(1);
    expect(world.quests.every((q) => q.reward.xp > 0)).toBe(true);
  });
});

describe('Highcairn Pass (M7 7.3: Storm, Stone and Frost)', () => {
  const NEW = ['storm', 'stone', 'frost'] as const;
  const zone = zoneById.get('highcairn_pass') as ZoneDef;

  it('R-WORLD-001 R-WORLD-002 a highland route west of Thistle Meadow with snow, scree, frost grass and a summit area', () => {
    expect(zone.kind).toBe('route');
    const g = zoneGeometry('highcairn_pass');
    const kinds = new Set(g.kinds.flat());
    for (const k of ['snow', 'scree', 'frost_grass', 'pine']) expect(kinds.has(k), k).toBe(true);
    expect(g.areas.map((a) => a.name)).toContain('summit');
    // Both frost grass and tall grass are wild (10.2); paths reach every NPC without them.
    const wild = g.wild.reduce((n, v) => n + v, 0);
    expect(wild).toBeGreaterThan(50);
    expect(TILES.find((t) => t.kind === 'frost_grass')).toMatchObject({ wild: true, solid: false });
    expect(TILES.find((t) => t.kind === 'pine')).toMatchObject({ solid: true, layer: 'deco' });
  });

  it('R-WORLD-002 R-ELEM-001 the wild patches hold Storm, Stone and Frost creatures, a step up from the meadow', () => {
    const elements = new Set(zone.encounters.map((e) => e.element));
    for (const el of NEW) expect(elements.has(el), el).toBe(true);
    // Every named entry is one of its element's creatures (6.5: six creatures per element).
    for (const e of zone.encounters) {
      if (e.element === undefined) continue;
      expect(NEW as readonly string[]).toContain(e.element);
    }
    const meadow = zoneById.get('thistle_meadow') as ZoneDef;
    const low = (z: ZoneDef) => Math.min(...z.encounters.map((e) => e.levels[0]));
    expect(low(zone)).toBeGreaterThan(low(meadow));
  });

  it('R-LOAD-004 R-FMT-005 four trainers: one story trainer per new element with a fixed loadout of that element, and a practice trainer', () => {
    const here = world.npcs.filter(
      (n) => n.role.kind === 'trainer' && npcLocation(n.id)?.zone === 'highcairn_pass',
    );
    expect(here).toHaveLength(4);
    const story = here.filter((n) => n.role.kind === 'trainer' && n.role.once);
    const practice = here.filter((n) => n.role.kind === 'trainer' && !n.role.once);
    expect(practice).toHaveLength(1);
    expect(
      story
        .map((n) =>
          n.role.kind === 'trainer' && !('buildSeed' in n.role.loadout)
            ? n.role.loadout.elements[0]
            : null,
        )
        .sort(),
    ).toEqual(['frost', 'stone', 'storm']);
    for (const n of story) {
      if (n.role.kind !== 'trainer' || 'buildSeed' in n.role.loadout) continue;
      const el = n.role.loadout.elements[0];
      const own = n.role.loadout.sets.flat().filter((id) => abilityById.get(id)?.affinity === el);
      expect(own.length, n.id).toBeGreaterThanOrEqual(2);
      expect(engine.validateLoadout(n.role.loadout, { level: n.role.level }).errors).toEqual([]);
      // Their rewards are their own element's cards.
      for (const c of n.role.reward.cards ?? [])
        expect(abilityById.get(c.id)?.affinity, `${n.id} ${c.id}`).toBe(el);
    }
  });

  it('R-WORLD-005 the quest line introduces the new elements: talk, defeat the three trainers, reach the summit; rewards are new cards and the M7 items', () => {
    const climb = questById.get('highcairn_climb') as QuestDef;
    const trial = questById.get('highcairn_trial') as QuestDef;
    expect(climb.requires).toEqual(['academy_first_road']);
    expect(trial.requires).toEqual(['highcairn_climb']);
    expect(
      climb.steps.map((s) =>
        s.kind === 'talk' || s.kind === 'defeat' ? `${s.kind}:${s.npc}` : s.kind,
      ),
    ).toEqual([
      'talk:pathfinder_maud',
      'defeat:stormcaller_imre',
      'defeat:mason_hedda',
      'reach',
      'defeat:rimeguard_osk',
      'talk:pathfinder_maud',
    ]);
    expect(trial.steps.find((s) => s.kind === 'win')).toMatchObject({
      constraint: { onlyAffinity: 'storm' },
    });
    const maud = npcById.get('pathfinder_maud');
    expect(maud?.lines.join(' ')).toMatch(
      /Storm beats Frost, Frost beats Stone, and Stone beats Storm/,
    );
    // Every card the pass hands out (quests and trainers) is a Storm, Stone or Frost card, and the
    // whole new catalogue is covered except Rebuild, Snowbound and Permafrost (levels 14-20).
    const cards = new Set<string>();
    const items = new Set<string>();
    for (const r of [
      climb.reward,
      trial.reward,
      ...world.npcs.flatMap((n) =>
        n.role.kind === 'trainer' && npcLocation(n.id)?.zone === 'highcairn_pass'
          ? [n.role.reward]
          : [],
      ),
    ]) {
      for (const c of r.cards ?? []) cards.add(c.id);
      for (const i of r.items ?? []) items.add(i.id);
    }
    for (const c of cards) expect(NEW as readonly string[]).toContain(abilityById.get(c)?.affinity);
    expect(cards.size).toBeGreaterThanOrEqual(9);
    expect([...items].sort()).toEqual(['mainspring', 'mooring_chain']);
    // Rewards stay within reach of the pass's level band (trainers 6-10).
    for (const c of cards) expect(abilityById.get(c)?.minLevel, c).toBeLessThanOrEqual(12);
    for (const i of items) expect(itemById.get(i)?.minLevel, i).toBeLessThanOrEqual(12);
    // The Storm-only win is reachable with the cards Stormcaller Imre hands out.
    const stormOnly: Loadout = {
      elements: ['storm'],
      items: ['dual_adepts_glove'],
      sets: [['squall', 'pawn_storm']],
    };
    expect(engine.validateLoadout(stormOnly, { level: 7 }).errors).toEqual([]);
  });

  it('R-WORLD-001 R-WORLD-003 the Chess Academy is unchanged: the first-win path still starts there and Highcairn is reached only through the meadow', () => {
    expect(world.start.zone).toBe('academy_hall');
    const into = world.zones.flatMap((z) =>
      zoneGeometry(z.id)
        .warps.filter((w) => w.to === 'highcairn_pass')
        .map(() => z.id),
    );
    expect(new Set(into)).toEqual(new Set(['thistle_meadow']));
  });
});

/**
 * R-ART-003 guard. Names were checked at authoring time against the full list of 1,025 species
 * (no species inside a name) and against franchise character names; this list keeps the nearest
 * and most famous ones (species, professors, leaders, rivals, trainer-class titles, items).
 */
const DENY_SPECIES = [
  'pikachu',
  'charmander',
  'squirtle',
  'bulbasaur',
  'eevee',
  'snorlax',
  'lanturn',
  'totodile',
  'bramblin',
  'kingambit',
  'mareep',
  'fennekin',
  'rookidee',
  'litwick',
  'lampent',
  'sandile',
  'zorua',
  'jigglypuff',
  'meowth',
];
const DENY_WORDS = [
  'pokemon',
  'pokémon',
  'poke',
  'poké',
  'pokeball',
  'pokedex',
  'repel',
  'oak',
  'elm',
  'birch',
  'rowan',
  'juniper',
  'sycamore',
  'kukui',
  'magnolia',
  'willow',
  'fennel',
  'greta',
  'ash',
  'gary',
  'brock',
  'misty',
  'erika',
  'sabrina',
  'giovanni',
  'whitney',
  'jasmine',
  'clair',
  'lance',
  'cynthia',
  'steven',
  'wallace',
  'iris',
  'leon',
  'joy',
  'jenny',
  'jessie',
  'hiker',
  'youngster',
  'lass',
  'ranger',
  'gym',
  'badge',
  'gambit',
  'bramble',
  'lantern',
];

describe('names (R-ART-003)', () => {
  it('R-ART-003 zone, NPC, lesson, quest, key item and encounter names are original', () => {
    const names = [
      ...world.zones.map((z) => z.name),
      ...world.zones.flatMap((z) => z.encounters.map((e) => e.name)),
      ...world.npcs.map((n) => n.name),
      ...world.lessons.map((l) => l.title),
      ...world.lessons.flatMap((l) => (l.kind === 'battle' ? [l.npc.name] : [])),
      ...world.quests.map((q) => q.name),
      ...world.keyItems.map((k) => k.name),
    ];
    expect(new Set(world.npcs.map((n) => n.name)).size).toBe(world.npcs.length);
    for (const name of names) {
      const low = name.toLowerCase();
      const words = low.split(/[^a-zé]+/).filter(Boolean);
      for (const d of DENY_WORDS) expect(words.includes(d), `${name} uses "${d}"`).toBe(false);
      for (const s of DENY_SPECIES)
        expect(low.replace(/[^a-z]/g, '').includes(s), `${name} contains ${s}`).toBe(false);
    }
  });

  it('R-ART-003 dialog, signs, lessons and quest texts never name the franchise', () => {
    const texts = [
      ...world.npcs.flatMap((n) => n.lines),
      ...world.lessons.flatMap((l) => [
        ...l.intro,
        ...(l.kind === 'puzzles' ? l.puzzles.flatMap((p) => [p.prompt, p.hint]) : []),
      ]),
      ...world.quests.flatMap((q) => q.steps.map((s) => s.text)),
      ...world.keyItems.map((k) => k.text),
      ...world.zones.flatMap((z) => zoneGeometry(z.id).signs.map((s) => s.text)),
    ];
    expect(texts.length).toBeGreaterThan(50);
    for (const t of texts) expect(t, t).not.toMatch(/pok[eé]|gym leader|elite four|repel/i);
  });
});
