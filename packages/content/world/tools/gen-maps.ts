/**
 * Map generator (10.1, R-WORLD-001): writes the vertical-slice zones as Tiled JSON maps
 * (`world/maps/<zone>.json`, orthogonal, 16x16, one embedded tileset with `kind`/`solid`/`wild` tile
 * properties) and paints the tileset image `assets/world/tiles.png` (R-ART-003: original art).
 *
 *   pnpm exec tsx packages/content/world/tools/gen-maps.ts
 *
 * The maps open in the Tiled editor (the tileset image path is relative to the map file). They are
 * generated so they stay reproducible: a test checks the checked-in files match this script, so edit
 * the layouts here (or, to hand-edit in Tiled from now on, retire the generator and that test).
 *
 * Layout legend (one character per tile; ground tile, then an optional deco tile on top):
 *   .  grass           ,  grass tuft       *  flowers          =  path          P  plaza
 *   "  tall grass (wild, 10.2)            S  sand (challenge-zone arena)       H  bridge
 *   #  tree            b  bush             o  rock             t  stump         f  fence
 *   ~  water           l  lily pad         e  reeds            n  signpost (needs a sign object)
 *   R  roof            r  eave             W  wall             w  window        D  door (walkable)
 *   E  academy banner  L  lamp             F  fountain         x  crate         m  mailbox
 *   _  wooden floor    c  chessboard floor I  inner wall       B  bookshelf     T  desk
 *   u  rug             M  doormat          K  knight statue    A  blackboard    p  potted plant
 *   g  meadow grass    q  mushrooms
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Dir, TiledMap, TiledObject, TiledProperty } from '../types.ts';
import { TILES, TILESET_COLUMNS, TILESET_NAME, tileId } from '../tiles.ts';
import { paintTileset } from './art.ts';
import { encodePng } from './png.ts';

const LEGEND: Record<string, [ground: string, deco?: string]> = {
  '.': ['grass'],
  ',': ['grass_tuft'],
  '*': ['flowers'],
  '=': ['path'],
  P: ['plaza'],
  '"': ['tall_grass'],
  S: ['sand'],
  H: ['bridge'],
  '#': ['grass', 'tree'],
  b: ['grass', 'bush'],
  o: ['grass', 'rock'],
  t: ['grass', 'stump'],
  f: ['grass', 'fence'],
  '~': ['water'],
  l: ['lily'],
  e: ['reeds'],
  n: ['grass', 'signpost'],
  R: ['grass', 'roof'],
  r: ['grass', 'eave'],
  W: ['grass', 'wall'],
  w: ['grass', 'window'],
  D: ['path', 'door'],
  E: ['grass', 'emblem'],
  L: ['plaza', 'lamp'],
  F: ['plaza', 'fountain'],
  x: ['grass', 'crate'],
  m: ['grass', 'mailbox'],
  _: ['floor'],
  c: ['checker_light'], // alternates with checker_dark by square colour
  I: ['inner_wall'],
  B: ['floor', 'bookshelf'],
  T: ['floor', 'desk'],
  u: ['rug'],
  M: ['doormat'],
  K: ['floor', 'statue'],
  A: ['inner_wall', 'blackboard'],
  p: ['floor', 'plant'],
  g: ['meadow_grass'],
  q: ['mushrooms'],
};

type ObjSpec =
  | { type: 'spawn'; x: number; y: number; dir: Dir }
  | { type: 'warp'; x: number; y: number; to: string; toX: number; toY: number; dir: Dir }
  | { type: 'npc'; x: number; y: number; npc: string; dir: Dir }
  | { type: 'sign'; x: number; y: number; text: string }
  | { type: 'area'; name: string; x: number; y: number; w: number; h: number }
  | { type: 'challenge'; x: number; y: number; w: number; h: number };

export interface ZoneLayout {
  id: string;
  rows: string[];
  objects: ObjSpec[];
}

/** Warps along an edge: tile i of `xs` leads to tile i of `toXs`. */
function edgeWarps(
  xs: number[],
  y: number,
  to: string,
  toXs: number[],
  toY: number,
  dir: Dir,
): ObjSpec[] {
  return xs.map((x, i) => ({ type: 'warp', x, y, to, toX: toXs[i] ?? x, toY, dir }));
}

const F = (n: number) => '"'.repeat(n);

// ---- Chess Academy (interior; start zone) -------------------------------------------------------

const ACADEMY_HALL: ZoneLayout = {
  id: 'academy_hall',
  rows: [
    'IIIIIIIIIIIIIIII',
    'IBBBIAAAAAAIBBBI',
    'I______________I',
    'IT___cccccc___TI',
    'I____cccccc____I',
    'IK___cccccc___KI',
    'I____cccccc____I',
    'IT___cccccc___TI',
    'I______________I',
    'Ip__uuuuuuuu__pI',
    'I______________I',
    'IIIIIIIMMIIIIIII',
  ],
  objects: [
    { type: 'spawn', x: 7, y: 3, dir: 'n' },
    { type: 'npc', x: 7, y: 2, npc: 'headmaster_orla', dir: 's' },
    { type: 'npc', x: 2, y: 3, npc: 'tutor_nell', dir: 'e' },
    { type: 'npc', x: 2, y: 7, npc: 'tutor_rafe', dir: 'e' },
    { type: 'npc', x: 13, y: 3, npc: 'tutor_juno', dir: 'w' },
    { type: 'npc', x: 13, y: 7, npc: 'tutor_idris', dir: 'w' },
    { type: 'npc', x: 5, y: 9, npc: 'coach_brann', dir: 'e' },
    { type: 'npc', x: 10, y: 9, npc: 'pim', dir: 'w' },
    {
      type: 'sign',
      x: 5,
      y: 1,
      text: 'Lesson board: 1. How pieces move (Tutor Nell). 2. Check and 3. Checkmate (Tutor Rafe). 4. Abilities, one at a time (Tutor Juno). 5. Elements (Tutor Idris). Chess lessons can be skipped; ability and element lessons cannot.',
    },
    {
      type: 'sign',
      x: 10,
      y: 1,
      text: 'Chalk notes: a knight jumps in an L. Check means the king is attacked. Checkmate means it cannot escape.',
    },
    { type: 'area', name: 'lesson_floor', x: 5, y: 3, w: 6, h: 5 },
    { type: 'warp', x: 7, y: 11, to: 'academy_town', toX: 6, toY: 7, dir: 's' },
    { type: 'warp', x: 8, y: 11, to: 'academy_town', toX: 7, toY: 7, dir: 's' },
  ],
};

// ---- Rookhaven (the Chess Academy town) ---------------------------------------------------------

const ACADEMY_TOWN: ZoneLayout = {
  id: 'academy_town',
  rows: [
    '##############===#############',
    '#.....,.......===.......,....#',
    '#.RRRRRRRRRR..===...RRRRRR...#',
    '#.RRRRRRRRRR..===...RRRRRR...#',
    '#.RRRRRRRRRR.n===...rrrrrr...#',
    '#.rrrrrrrrrr..===...WwWWwW...#',
    '#.WwEWDDWEwW..===..*b....b*..#',
    '#....L==Ln....===............#',
    '#.....==......===.......,....#',
    '#.,...==...LPPPPPPPL.........#',
    '#.....=====PPPPPPPPP..*.*....#',
    '#.*.*......PPPPPPPPP.........#',
    '#..........PPPPFPPPP.........#',
    '#..,.......PPPPPPPPPn..,.....#',
    '#..........PPPPPPPPP.........#',
    '#..........LPPPPPPPL.........#',
    '#.............==.....RRRRRR..#',
    '#.~~~l~~~.....==.....RRRRRR..#',
    '#.~~~~~~~x.n..==.....rrrrrr..#',
    '#.~~~~HHH=======.....WwWWwWm.#',
    '#.~~~~~~~......,.....*.**.*..#',
    '#.e~~~~~e....................#',
    '#............................#',
    '##############################',
  ],
  objects: [
    { type: 'spawn', x: 15, y: 13, dir: 'n' },
    { type: 'warp', x: 6, y: 6, to: 'academy_hall', toX: 7, toY: 10, dir: 'n' },
    { type: 'warp', x: 7, y: 6, to: 'academy_hall', toX: 8, toY: 10, dir: 'n' },
    ...edgeWarps([14, 15, 16], 0, 'route_1', [10, 11, 12], 38, 'n'),
    { type: 'npc', x: 13, y: 1, npc: 'gatekeeper_tomas', dir: 'e' },
    { type: 'npc', x: 6, y: 19, npc: 'captain_wren', dir: 'e' },
    { type: 'npc', x: 9, y: 21, npc: 'old_hollis', dir: 'w' },
    { type: 'npc', x: 22, y: 11, npc: 'tam', dir: 's' },
    { type: 'npc', x: 23, y: 7, npc: 'hettie', dir: 's' },
    { type: 'npc', x: 17, y: 13, npc: 'dorran', dir: 'w' },
    {
      type: 'sign',
      x: 13,
      y: 4,
      text: 'North: Knight’s Way. Tall grass grows on both sides of the road; stay on the path to walk past wild creatures.',
    },
    {
      type: 'sign',
      x: 9,
      y: 7,
      text: 'The Chess Academy. Newcomers welcome: no chess experience needed!',
    },
    {
      type: 'sign',
      x: 20,
      y: 13,
      text: 'Welcome to Rookhaven, home of the Chess Academy.',
    },
    {
      type: 'sign',
      x: 11,
      y: 18,
      text: 'Rookhaven Pond. No swimming, by order of Captain Wren.',
    },
    { type: 'area', name: 'square', x: 11, y: 9, w: 9, h: 7 },
    { type: 'area', name: 'north_gate', x: 14, y: 0, w: 3, h: 3 },
  ],
};

// ---- Knight’s Way (route 1) ---------------------------------------------------------------------

const ROUTE_1: ZoneLayout = {
  id: 'route_1',
  rows: [
    '##########===###########',
    '#########.===.##########',
    '########..===..#########',
    '##.,....b.===.b......,##',
    '#.""""""..===..""""""..#',
    '#.""""""..===..""""""..#',
    '#.""""""..===..""""""*.#',
    '#..""""...===..""""""..#',
    '#,.......n===...""""..,#',
    '#b........===.........b#',
    '#.........===..........#',
    '##...,....===....,....##',
    '#bbbbbbb..===..........#',
    '#SSSSSSSb.===."""""""".#',
    '#SSSSSSSb.===."""""""""#',
    '#SSSSSSSb.===..""""""""#',
    '#SSSSSSS=====."""""""..#',
    '#SSSSSSSbn===."""""""".#',
    '#SSSSSSSb.===..""""""..#',
    '#SSSSSSSb.===...""""...#',
    '#bbbbbbbb.===..........#',
    '#.,.......===......,...#',
    '#.........===..........#',
    '~~~~~~~~~~HHH~~~~~~~~~~~',
    '#.........===..........#',
    '#.""""....===..........#',
    '#.""""""..===..........#',
    '#.""""""..===.....o....#',
    '#.""""""..===..........#',
    '#..""""...===..........#',
    '#b........===......""".#',
    '#.........===.....""""b#',
    '#..,......===....""""".#',
    '#.........===.....""""b#',
    '##........===.........##',
    '###.b.....===.....b.####',
    '####......===......#####',
    '#####.n...===...*.######',
    '#########.===.##########',
    '##########===###########',
  ],
  objects: [
    { type: 'spawn', x: 11, y: 36, dir: 'n' },
    ...edgeWarps([10, 11, 12], 39, 'academy_town', [14, 15, 16], 1, 's'),
    ...edgeWarps([10, 11, 12], 0, 'thistle_meadow', [14, 15, 16], 22, 'n'),
    { type: 'npc', x: 13, y: 29, npc: 'trainer_pell', dir: 'w' },
    { type: 'npc', x: 13, y: 10, npc: 'trainer_linnea', dir: 'w' },
    { type: 'npc', x: 9, y: 14, npc: 'dunmore', dir: 'e' },
    {
      type: 'sign',
      x: 6,
      y: 37,
      text: 'Knight’s Way. South: Rookhaven and the Chess Academy. North: Thistle Meadow.',
    },
    {
      type: 'sign',
      x: 9,
      y: 8,
      text: 'Tall grass on both sides! Wild creatures only appear in the grass: stay on the road to pass by, step in when you want a battle.',
    },
    {
      type: 'sign',
      x: 9,
      y: 17,
      text: 'Challenge Zone. Stepping onto the sand means you accept First Blood challenges from other players of your bracket. Step off the sand to stop.',
    },
    { type: 'area', name: 'south_gate', x: 9, y: 34, w: 5, h: 5 },
    { type: 'area', name: 'bridge', x: 10, y: 22, w: 3, h: 3 },
    { type: 'challenge', x: 1, y: 13, w: 7, h: 7 },
  ],
};

// ---- Thistle Meadow (wild patch) ---------------------------------------------------------------

const MEADOW_ROWS = [
  '#'.repeat(32),
  '#...,.........*..*..........,..#',
  '#.' + '='.repeat(28) + '.#',
  '#.=.......b....==....b.......=.#',
  '#.=.' + F(10) + '.==.' + F(10) + '.=.#',
  '#.=.' + F(10) + '.==.' + F(10) + '.=.#',
  '#.=' + F(11) + '.==.' + F(10) + '.=.#',
  '#.=.' + F(10) + '.==.' + F(11) + '=.#',
  '#.=.' + F(9) + '..==.' + F(10) + '.=.#',
  '#.=..' + F(7) + '...==...' + F(7) + '..=.#',
  '#.=.....t......==.....,......=.#',
  '#.' + '='.repeat(28) + '.#',
  '#.=..,.........==.........t..=.#',
  '#.=..' + F(8) + '..==..' + F(8) + '..=.#',
  '#.=.' + F(10) + '.==.' + F(10) + '.=.#',
  '#.=' + F(11) + '.==.' + F(10) + '.=.#',
  '#.=.' + F(10) + '.==.' + F(10) + '.=.#',
  '#.=.' + F(10) + '.==.' + F(11) + '=.#',
  '#.=..' + F(9) + '.==.' + F(9) + '..=.#',
  '#.=...' + F(7) + '..==..' + F(7) + '...=.#',
  '#.=............==............=.#',
  '#.' + '='.repeat(28) + '.#',
  '#............n===..............#',
  '#'.repeat(14) + '===' + '#'.repeat(15),
].map((r) => r.replace(/\./g, 'g').replace(/,/g, 'q'));

const THISTLE_MEADOW: ZoneLayout = {
  id: 'thistle_meadow',
  rows: MEADOW_ROWS,
  objects: [
    { type: 'spawn', x: 15, y: 20, dir: 'n' },
    ...edgeWarps([14, 15, 16], 23, 'route_1', [10, 11, 12], 1, 's'),
    { type: 'npc', x: 15, y: 1, npc: 'meadowkeeper_sef', dir: 's' },
    { type: 'npc', x: 30, y: 12, npc: 'botanist_ilse', dir: 'w' },
    {
      type: 'sign',
      x: 13,
      y: 22,
      text: 'Thistle Meadow. The grass here is thick with wild creatures. Paths ring every field, so you choose when to battle.',
    },
    { type: 'area', name: 'meadow_heart', x: 14, y: 10, w: 4, h: 3 },
  ],
};

export const LAYOUTS: readonly ZoneLayout[] = [ACADEMY_HALL, ACADEMY_TOWN, ROUTE_1, THISTLE_MEADOW];

// ---- Tiled JSON --------------------------------------------------------------------------------

/** The tileset image, relative to a map file in `world/maps/`. */
export const TILESET_IMAGE = '../../../../assets/world/tiles.png';

const props = (list: [string, string | number][]): TiledProperty[] =>
  list.map(([name, value]) => ({
    name,
    type: typeof value === 'number' ? 'int' : 'string',
    value,
  }));

function tiledObject(o: ObjSpec, id: number): TiledObject {
  // Single-tile objects are 16x16 rectangles on their tile; keys in Tiled's (alphabetical) order.
  const rect = (
    name: string,
    x: number,
    y: number,
    w = 1,
    h = 1,
    properties?: TiledProperty[],
  ) => ({
    height: h * 16,
    id,
    name,
    ...(properties ? { properties } : {}),
    rotation: 0,
    type: o.type,
    visible: true,
    width: w * 16,
    x: x * 16,
    y: y * 16,
  });
  switch (o.type) {
    case 'spawn':
      return rect('spawn', o.x, o.y, 1, 1, props([['dir', o.dir]]));
    case 'warp':
      return rect(
        `to ${o.to}`,
        o.x,
        o.y,
        1,
        1,
        props([
          ['dir', o.dir],
          ['to', o.to],
          ['toX', o.toX],
          ['toY', o.toY],
        ]),
      );
    case 'npc':
      return rect(
        o.npc,
        o.x,
        o.y,
        1,
        1,
        props([
          ['dir', o.dir],
          ['npc', o.npc],
        ]),
      );
    case 'sign':
      return rect('sign', o.x, o.y, 1, 1, props([['text', o.text]]));
    case 'area':
      return rect(o.name, o.x, o.y, o.w, o.h);
    case 'challenge':
      return rect('challenge zone', o.x, o.y, o.w, o.h);
  }
}

export function tilesetJson(): TiledMap['tilesets'][number] {
  const rows = Math.ceil(TILES.length / TILESET_COLUMNS);
  return {
    columns: TILESET_COLUMNS,
    firstgid: 1,
    image: TILESET_IMAGE,
    imageheight: rows * 16,
    imagewidth: TILESET_COLUMNS * 16,
    margin: 0,
    name: TILESET_NAME,
    spacing: 0,
    tilecount: TILES.length,
    tileheight: 16,
    tiles: TILES.map((t, id) => ({
      id,
      properties: [
        { name: 'kind', type: 'string', value: t.kind },
        { name: 'solid', type: 'bool', value: t.solid },
        { name: 'wild', type: 'bool', value: t.wild },
      ],
    })),
    tilewidth: 16,
  };
}

export function buildMap(z: ZoneLayout): TiledMap {
  const height = z.rows.length;
  const width = z.rows[0]?.length ?? 0;
  const ground: number[] = [];
  const deco: number[] = [];
  const gid = (kind: string) => {
    const id = tileId.get(kind);
    if (id === undefined) throw new Error(`unknown tile kind ${kind}`);
    return id + 1;
  };
  z.rows.forEach((row, y) => {
    if (row.length !== width)
      throw new Error(`${z.id}: row ${y} has ${row.length} tiles, not ${width}`);
    [...row].forEach((ch, x) => {
      const entry = LEGEND[ch];
      if (!entry) throw new Error(`${z.id}: unknown legend character "${ch}" at ${x},${y}`);
      const [g, d] = entry;
      ground.push(gid(ch === 'c' && (x + y) % 2 === 1 ? 'checker_dark' : g));
      deco.push(d ? gid(d) : 0);
    });
  });
  // Every signpost tile carries a sign object and every outdoor sign stands on a signpost.
  const posts = new Set<string>();
  z.rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'n' && posts.add(`${x},${y}`)));
  for (const o of z.objects) if (o.type === 'sign') posts.delete(`${o.x},${o.y}`);
  if (posts.size > 0)
    throw new Error(`${z.id}: signposts without a sign object: ${[...posts].join(' ')}`);
  const layer = (id: number, name: string, data: number[]) => ({
    data,
    height,
    id,
    name,
    opacity: 1,
    type: 'tilelayer' as const,
    visible: true,
    width,
    x: 0,
    y: 0,
  });
  const objects = z.objects.map((o, i) => tiledObject(o, i + 1));
  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [
      layer(1, 'ground', ground),
      layer(2, 'deco', deco),
      {
        draworder: 'topdown',
        id: 3,
        name: 'objects',
        objects,
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 4,
    nextobjectid: objects.length + 1,
    orientation: 'orthogonal',
    properties: [{ name: 'zone', type: 'string', value: z.id }],
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    tileheight: 16,
    tilesets: [tilesetJson()],
    tilewidth: 16,
    type: 'map',
    version: '1.10',
    width,
  };
}

/** JSON in Tiled's key order, short values inline, and one map row per line in tile layers. */
export function serializeMap(map: TiledMap): string {
  const MAX = 100;
  const inline = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    if (v !== null && typeof v === 'object')
      return `{ ${Object.entries(v)
        .map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
        .join(', ')} }`;
    return JSON.stringify(v);
  };
  const fmt = (v: unknown, pad: string, rowWidth: number | null): string => {
    if (Array.isArray(v) && rowWidth !== null) {
      const rows: string[] = [];
      for (let i = 0; i < v.length; i += rowWidth)
        rows.push(`${pad}  ${v.slice(i, i + rowWidth).join(', ')}`);
      return `[\n${rows.join(',\n')}\n${pad}]`;
    }
    const one = inline(v);
    if (pad.length + one.length <= MAX || v === null || typeof v !== 'object') return one;
    if (Array.isArray(v))
      return `[\n${v.map((x) => `${pad}  ${fmt(x, `${pad}  `, null)}`).join(',\n')}\n${pad}]`;
    const o = v as Record<string, unknown>;
    const width = typeof o.width === 'number' && o.type === 'tilelayer' ? o.width : null;
    const body = Object.entries(o).map(
      ([k, x]) =>
        `${pad}  ${JSON.stringify(k)}: ${fmt(x, `${pad}  `, k === 'data' ? width : null)}`,
    );
    return `{\n${body.join(',\n')}\n${pad}}`;
  };
  return `${fmt(map, '', null)}\n`;
}

/** Every generated file, relative to the repository root. */
export function generatedFiles(): Map<string, string | Buffer> {
  const out = new Map<string, string | Buffer>();
  for (const z of LAYOUTS)
    out.set(`packages/content/world/maps/${z.id}.json`, serializeMap(buildMap(z)));
  out.set('assets/world/tiles.png', encodePng(paintTileset()));
  return out;
}

if (process.argv[1]?.endsWith('gen-maps.ts')) {
  const root = new URL('../../../../', import.meta.url).pathname;
  for (const [rel, content] of generatedFiles()) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${rel}`);
  }
}
