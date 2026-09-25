/**
 * Test helpers for the zone core: a small hand-written world (Tiled maps built from ASCII), a
 * cloneable seeded RNG, client frames, a harness that checks every outgoing message against its
 * protocol schema, and outbox queries. Test-only (imported by *.unit.test.ts files).
 */
import { ServerZone } from '@chain-theorem/protocol';
import type { Loadout } from '@chain-theorem/rules';
import { ZoneCore, type ZoneOptions } from './core.ts';
import type { Effect, Outbox, PlayerInit, ServerMsg } from './types.ts';
import type {
  Dir,
  LessonDef,
  NpcDef,
  QuestDef,
  TiledMap,
  TiledObject,
  TiledProperty,
  WorldRegistry,
  ZoneDef,
} from './world.ts';

export const T0 = 1_760_000_000_000;

/** mulberry32 with visible state, so a test can clone the sequence across snapshot/restore. */
export class SeqRng {
  calls = 0;
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next = (): number => {
    this.calls++;
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  clone(): SeqRng {
    const r = new SeqRng(this.state);
    r.calls = this.calls;
    return r;
  }
}

// ---- Tiled maps from ASCII -----------------------------------------------------------------------

/** '#' wall, '.' path, 'w' wild grass. */
const GID: Record<string, number> = { '.': 1, '#': 2, w: 3 };

type Props = Record<string, string | number | boolean>;

export interface ObjSpec {
  type: 'spawn' | 'warp' | 'npc' | 'area' | 'challenge' | 'sign';
  name?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  props?: Props;
}

function props(p: Props | undefined): TiledProperty[] | undefined {
  if (!p) return undefined;
  return Object.entries(p).map(([name, value]) => ({
    name,
    type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'string',
    value,
  }));
}

export function asciiMap(rows: string[], objects: ObjSpec[]): TiledMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data: number[] = [];
  for (const row of rows) {
    if (row.length !== width) throw new Error('ragged ascii map');
    for (const ch of row) data.push(GID[ch] ?? 1);
  }
  const objs: TiledObject[] = objects.map((o, i) => {
    const obj: TiledObject = {
      id: i + 1,
      name: o.name ?? '',
      type: o.type,
      x: o.x * 16,
      y: o.y * 16,
      width: (o.w ?? 0) * 16,
      height: (o.h ?? 0) * 16,
    };
    const p = props(o.props);
    if (p) obj.properties = p;
    return obj;
  });
  return {
    type: 'map',
    orientation: 'orthogonal',
    width,
    height,
    tilewidth: 16,
    tileheight: 16,
    infinite: false,
    tilesets: [
      {
        firstgid: 1,
        name: 'test',
        tilewidth: 16,
        tileheight: 16,
        tilecount: 3,
        columns: 3,
        tiles: [
          { id: 0, properties: [{ name: 'kind', type: 'string', value: 'path' }] },
          {
            id: 1,
            properties: [
              { name: 'kind', type: 'string', value: 'wall' },
              { name: 'solid', type: 'bool', value: true },
            ],
          },
          {
            id: 2,
            properties: [
              { name: 'kind', type: 'string', value: 'grass' },
              { name: 'wild', type: 'bool', value: true },
            ],
          },
        ],
      },
    ],
    layers: [
      { type: 'tilelayer', name: 'ground', width, height, data },
      { type: 'objectgroup', name: 'objects', objects: objs },
    ],
  };
}

// ---- The fixture world ---------------------------------------------------------------------------

/**
 * town (14x10): spawn (1,1) facing s; NPCs prof (3,3) teacher, kid (5,3) talk, elder (7,3) quest
 * giver, rival (9,3) once-only trainer, coach (11,3) practice trainer; challenge zone x 2..7,
 * y 6..7; area "gate" x 10..11, y 6..7; warp (12,8) to route (1,1).
 */
export const TOWN_ROWS = [
  '##############',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '##############',
];

/** route (12x7): path rows y=1 and y=5, wild grass rows y=2..4; warp (10,5) back to town (12,7). */
export const ROUTE_ROWS = [
  '############',
  '#..........#',
  '#wwwwwwwwww#',
  '#wwwwwwwwww#',
  '#wwwwwwwwww#',
  '#..........#',
  '############',
];

const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };

export interface FixtureOptions {
  routeRate?: number;
  routeGrace?: number;
}

export function fixtureWorld(o: FixtureOptions = {}): WorldRegistry {
  const town: ZoneDef = {
    id: 'town',
    name: 'Academy Town',
    kind: 'town',
    encounterRate: 0,
    encounterGrace: 0,
    encounters: [],
    format: 'first_blood',
    map: asciiMap(TOWN_ROWS, [
      { type: 'spawn', x: 1, y: 1, props: { dir: 's' } },
      { type: 'npc', x: 3, y: 3, props: { npc: 'prof', dir: 's' } },
      { type: 'npc', x: 5, y: 3, props: { npc: 'kid', dir: 's' } },
      { type: 'npc', x: 7, y: 3, props: { npc: 'elder', dir: 's' } },
      { type: 'npc', x: 9, y: 3, props: { npc: 'rival', dir: 's' } },
      { type: 'npc', x: 11, y: 3, props: { npc: 'coach', dir: 's' } },
      { type: 'challenge', x: 2, y: 6, w: 6, h: 2 },
      { type: 'area', name: 'gate', x: 10, y: 6, w: 2, h: 2 },
      { type: 'warp', x: 12, y: 8, props: { to: 'route', toX: 1, toY: 1, dir: 's' } },
    ]),
  };
  const route: ZoneDef = {
    id: 'route',
    name: 'Route One',
    kind: 'route',
    encounterRate: o.routeRate ?? 0.1,
    encounterGrace: o.routeGrace ?? 0,
    encounters: [
      { weight: 3, levels: [2, 4], element: 'ember', name: 'Wild Cindermoth' },
      { weight: 1, levels: [8, 10], element: 'tide', name: 'Wild Brookhound' },
    ],
    format: 'first_blood',
    map: asciiMap(ROUTE_ROWS, [
      { type: 'spawn', x: 1, y: 1, props: { dir: 's' } },
      { type: 'warp', x: 10, y: 5, props: { to: 'town', toX: 12, toY: 7, dir: 'n' } },
      { type: 'area', name: 'field', x: 1, y: 2, w: 10, h: 3 },
    ]),
  };
  const npcs: NpcDef[] = [
    {
      id: 'prof',
      name: 'Professor Vell',
      look: { variant: 1, element: 'neutral' },
      lines: ['Welcome, {name}.'],
      role: { kind: 'teacher', lessons: ['moves', 'mates', 'ember-basics'] },
    },
    {
      id: 'kid',
      name: 'Pip',
      look: { variant: 2, element: 'grove' },
      lines: ['Have you met the Professor?'],
      role: { kind: 'talk' },
    },
    {
      id: 'elder',
      name: 'Elder Moss',
      look: { variant: 3, element: 'stone' },
      lines: ['I have a task for you, {name}.'],
      role: { kind: 'quest', quest: 'first-steps' },
    },
    {
      id: 'rival',
      name: 'Rival Kess',
      look: { variant: 4, element: 'ember' },
      lines: ['Battle me!'],
      role: {
        kind: 'trainer',
        tier: 'trainer',
        format: 'first_blood',
        level: 3,
        loadout: PLAIN,
        reward: { xp: 50 },
        once: true,
      },
    },
    {
      id: 'coach',
      name: 'Coach Aldo',
      look: { variant: 5, element: 'tide' },
      lines: ['Practice any time.'],
      role: {
        kind: 'trainer',
        tier: 'wild',
        format: 'first_blood',
        level: 2,
        loadout: { buildSeed: 7 },
        reward: { xp: 5 },
        once: false,
      },
    },
  ];
  const lessons: LessonDef[] = [
    {
      id: 'moves',
      title: 'How pieces move',
      kind: 'puzzles',
      topic: 'movement',
      skippable: true,
      intro: ['Knights jump.'],
      puzzles: [
        {
          // b1d2 is legal but not listed; b1c3 and b1a3 are accepted.
          fen: '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1',
          prompt: 'Jump the knight forward two ranks.',
          accept: ['b1c3', 'b1a3'],
          hint: 'Knights move in an L.',
        },
        {
          // a1h8 is listed but illegal for a rook: it must be refused.
          fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
          prompt: 'Checkmate in one.',
          accept: ['a1a8', 'a1h8'],
          hint: 'The back rank is weak.',
        },
      ],
      reward: { xp: 20 },
    },
    {
      id: 'mates',
      title: 'Checkmate',
      kind: 'puzzles',
      topic: 'checkmate',
      skippable: true,
      intro: ['Trap the king.'],
      puzzles: [
        {
          fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
          prompt: 'Checkmate in one.',
          accept: ['a1a8'],
          hint: 'Rook to the back rank.',
        },
      ],
      reward: { xp: 20 },
    },
    {
      id: 'ember-basics',
      title: 'Ember abilities',
      kind: 'battle',
      topic: 'element',
      skippable: false,
      intro: ['Fire spreads.'],
      format: 'first_blood',
      player: { level: 5, loadout: PLAIN },
      npc: { name: 'Academy Tutor', tier: 'wild', level: 5, loadout: PLAIN },
      reward: { xp: 40 },
    },
  ];
  const quests: QuestDef[] = [
    {
      id: 'first-steps',
      name: 'First Steps',
      requires: [],
      steps: [
        { kind: 'talk', npc: 'kid', text: 'Talk to Pip.' },
        { kind: 'lesson', lesson: 'moves', text: 'Finish the movement lesson.' },
        { kind: 'reach', zone: 'town', area: 'gate', text: 'Go to the town gate.' },
        { kind: 'defeat', npc: 'rival', text: 'Defeat Rival Kess.' },
        {
          kind: 'win',
          text: 'Win a wild battle using only Tide abilities.',
          constraint: { wild: true, onlyAffinity: 'tide' },
        },
      ],
      reward: { xp: 100, keyItems: ['calm-charm'], coins: 20 },
    },
    {
      id: 'second-steps',
      name: 'Second Steps',
      requires: ['first-steps'],
      steps: [{ kind: 'talk', npc: 'prof', text: 'Report to the Professor.' }],
      reward: { xp: 10 },
    },
  ];
  return {
    zones: [town, route],
    npcs,
    lessons,
    quests,
    keyItems: [
      { id: 'calm-charm', name: 'Calm Charm', text: 'Halves wild encounters.', encounterRate: 0.5 },
      { id: 'map', name: 'Map', text: 'Shows the world.' },
    ],
    start: { zone: 'town' },
  };
}

export function player(id: string, over: Partial<PlayerInit> = {}): PlayerInit {
  return {
    id,
    name: id.toUpperCase(),
    level: 5,
    adult: true,
    friends: [],
    quests: [],
    lessonsDone: [],
    defeatedNpcs: [],
    keyItems: [],
    party: null,
    filterChat: false,
    ...over,
  };
}

// ---- Frames, schema checks and outbox queries ------------------------------------------------------

/** A client frame as the browser sends it. */
export const frame = (t: string, d?: unknown): string =>
  JSON.stringify(d === undefined ? { t } : { t, d });

/** Every outgoing message must match its protocol schema after JSON serialization (R-NET-001). */
export function checkZoneMessage(msg: ServerMsg): string | null {
  const wire = JSON.parse(JSON.stringify(msg)) as { t: string; d: unknown };
  const schema = ServerZone[wire.t as keyof typeof ServerZone];
  if (!schema) return `unknown server message ${wire.t}`;
  const r = schema.safeParse(wire.d);
  return r.success ? null : `${wire.t} fails its schema: ${r.error.message}`;
}

type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

export function msgs<T extends ServerMsg['t']>(out: Outbox, to: string, t: T): MsgOf<T>[] {
  return out.send.filter((o) => o.to === to && o.msg.t === t).map((o) => o.msg as MsgOf<T>);
}

export function effects<K extends Effect['kind']>(
  out: Outbox,
  kind: K,
): Extract<Effect, { kind: K }>[] {
  return out.effects.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}

export function merge(...outs: Outbox[]): Outbox {
  return {
    send: outs.flatMap((o) => o.send),
    effects: outs.flatMap((o) => o.effects),
    save: outs.some((o) => o.save),
  };
}

/** Collects schema failures of every outgoing message. */
export function observer(problems: string[]): NonNullable<ZoneOptions['observe']> {
  return (_to, msg) => {
    const p = checkZoneMessage(msg);
    if (p) problems.push(p);
  };
}

/**
 * A zone core whose every outgoing message is schema-checked, with a clock that advances by `dt`
 * per input so rate limits never bite unless a test wants them to.
 */
export class Harness {
  readonly core: ZoneCore;
  readonly problems: string[];
  readonly dt: number;
  t = T0;

  constructor(core: ZoneCore, problems: string[], dt = 200) {
    this.core = core;
    this.problems = problems;
    this.dt = dt;
  }

  static of(world: WorldRegistry = fixtureWorld(), zone = 'town', opts: ZoneOptions = {}): Harness {
    const problems: string[] = [];
    const core = new ZoneCore(
      world,
      { zone, channel: 0 },
      { ...opts, observe: observer(problems) },
    );
    return new Harness(core, problems);
  }

  tick(): number {
    this.t += this.dt;
    return this.t;
  }

  /** Join and say hello. */
  enter(init: PlayerInit): Outbox {
    const a = this.core.join(init, this.tick());
    if (a.refused) throw new Error(`join refused: ${a.refused}`);
    return merge(a, this.send(init.id, 'hello', {}));
  }

  send(id: string, t: string, d?: unknown): Outbox {
    return this.core.message(id, frame(t, d), this.tick());
  }

  step(id: string, dir: Dir): Outbox {
    return this.send(id, 'step', { dir });
  }

  /** Walk a path such as 'sseen'; returns everything the walk produced. */
  walk(id: string, path: string): Outbox {
    return merge(...[...path].map((d) => this.step(id, d as Dir)));
  }

  /** The player's state as the snapshot has it. */
  me(id: string) {
    const p = this.core.snapshot().players.find((q) => q.id === id);
    if (!p) throw new Error(`${id} is not in the channel`);
    return p;
  }
}
