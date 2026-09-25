/**
 * Procedural 16x16 overworld tiles (M5, spec 10.1 and 11.1, R-ART-001, R-ART-003). Every tile is
 * original pixel art painted in code from the map's drawing `kind` (Tiled tile property), in a
 * limited GBA-style palette (15-bit colours). Unknown kinds match by keyword (a "pine_tree" draws
 * as a tree) or fall back to a neutral paving tile, so any map draws.
 *
 * Pure and deterministic: no DOM, no Phaser, no randomness (per-tile variation comes from a hash of
 * the tile position). `paintChunk` composes the map's tile layers into an RGBA buffer that the
 * world scene uploads as one texture per chunk.
 */
import { gba, mix } from '../battle/scene/pixel.ts';

export const TILE = 16;

/** A 16x16 tile: 0 = transparent, otherwise 0x1RRGGBB (bit 24 marks an opaque pixel). */
export class Tile16 {
  readonly px = new Uint32Array(TILE * TILE);

  set(x: number, y: number, rgb: number): this {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= TILE || yi >= TILE) return this;
    this.px[yi * TILE + xi] = (rgb & 0xffffff) | 0x1000000;
    return this;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return 0;
    return this.px[y * TILE + x] ?? 0;
  }

  filled(x: number, y: number): boolean {
    return this.get(x, y) !== 0;
  }

  clear(x: number, y: number): this {
    if (x >= 0 && y >= 0 && x < TILE && y < TILE) this.px[y * TILE + x] = 0;
    return this;
  }

  fill(rgb: number): this {
    return this.rect(0, 0, TILE, TILE, rgb);
  }

  rect(x: number, y: number, w: number, h: number, rgb: number): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, rgb);
    return this;
  }

  hline(x0: number, x1: number, y: number, rgb: number): this {
    for (let x = x0; x <= x1; x++) this.set(x, y, rgb);
    return this;
  }

  vline(x: number, y0: number, y1: number, rgb: number): this {
    for (let y = y0; y <= y1; y++) this.set(x, y, rgb);
    return this;
  }

  /** Filled ellipse (pixel centres inside). */
  ellipse(cx: number, cy: number, rx: number, ry: number, rgb: number): this {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, rgb);
      }
    return this;
  }

  /** Stamp a character map; '.' and ' ' are skipped. */
  stamp(x: number, y: number, rows: readonly string[], key: Record<string, number>): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = key[row[i] ?? '.'];
        if (c !== undefined) this.set(x + i, y + j, c);
      }
    });
    return this;
  }

  /** 1-px outline in `rgb` around every filled pixel (on transparent pixels only). */
  outline(rgb: number): this {
    const src = this.px.slice();
    const on = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < TILE && y < TILE && (src[y * TILE + x] ?? 0) !== 0;
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        if (on(x, y)) continue;
        if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) this.set(x, y, rgb);
      }
    return this;
  }

  /** Paint `rgb` over pixels that already hold `onto`. */
  recolor(onto: number, rgb: number): this {
    const want = (onto & 0xffffff) | 0x1000000;
    for (let i = 0; i < this.px.length; i++)
      if (this.px[i] === want) this.px[i] = (rgb & 0xffffff) | 0x1000000;
    return this;
  }

  /** Number of distinct colours (tests: patterns are visible). */
  colours(): number {
    return new Set([...this.px].filter((v) => v !== 0)).size;
  }
}

/** Deterministic 32-bit hash of a tile position (per-tile variation without randomness). */
export function hash2(x: number, y: number, salt = 0): number {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- palette (GBA 15-bit) -------------------------------------------------------------------------

const C = {
  ink: gba(0x283038),
  grass: gba(0x70c058),
  grassDk: gba(0x58a048),
  grassLt: gba(0x98d870),
  meadow: gba(0x98d068),
  meadowDk: gba(0x80b850),
  meadowLt: gba(0xc0e888),
  tallBase: gba(0x3c9040),
  tallDk: gba(0x206828),
  tall: gba(0x58b048),
  tallLt: gba(0x90d860),
  path: gba(0xd8b878),
  pathDk: gba(0xb89858),
  pathLt: gba(0xe8d098),
  plaza: gba(0xd8d0c0),
  plazaDk: gba(0xa8a090),
  plazaLt: gba(0xf0e8d8),
  sand: gba(0xf0d898),
  sandDk: gba(0xd8b870),
  sandLt: gba(0xf8f0c8),
  water: gba(0x4890e0),
  waterDk: gba(0x3068c0),
  waterLt: gba(0x88c0f0),
  foam: gba(0xd0f0f8),
  wood: gba(0xb87840),
  woodDk: gba(0x805028),
  woodLt: gba(0xd8a060),
  leaf: gba(0x389040),
  leafDk: gba(0x206030),
  leafLt: gba(0x68c058),
  leafOut: gba(0x103818),
  bark: gba(0x805030),
  barkDk: gba(0x503018),
  rock: gba(0xa0a0a8),
  rockDk: gba(0x686878),
  rockLt: gba(0xd0d0d8),
  rockOut: gba(0x383840),
  wall: gba(0xe8e0d0),
  wallDk: gba(0xc0b098),
  wallLt: gba(0xf8f8f0),
  glass: gba(0x78b8e8),
  glassLt: gba(0xc8e8f8),
  frame: gba(0x604028),
  door: gba(0x985830),
  doorDk: gba(0x683818),
  gold: gba(0xf0c030),
  goldDk: gba(0xb08018),
  red: gba(0xd84848),
  redDk: gba(0x983030),
  pink: gba(0xf088a8),
  white: gba(0xf8f8f8),
  yellow: gba(0xf8e058),
  floor: gba(0xc89860),
  floorDk: gba(0xa07840),
  floorLt: gba(0xd8b078),
  chessLight: gba(0xe8dcb8),
  chessLightDk: gba(0xd8c8a0),
  chessDark: gba(0x88a068),
  chessDarkDk: gba(0x789058),
  innerWall: gba(0xe0d0b0),
  innerWallDk: gba(0xa08060),
  board: gba(0x2f6848),
  boardDk: gba(0x1f4830),
  lamp: gba(0xfff0a0),
  neutral: gba(0x9098a8),
  neutralDk: gba(0x707888),
  neutralLt: gba(0xb8c0d0),
  // Highcairn Pass (M7 7.3): snow, scree, frosted grass and snowy pines.
  snow: gba(0xe4ecf4),
  snowDk: gba(0xc4d4e4),
  snowLt: gba(0xfbfdff),
  scree: gba(0xa6988a),
  screeDk: gba(0x827464),
  screeLt: gba(0xc8bcac),
  frostBase: gba(0x3c7c74),
  frost: gba(0x4e8c84),
  frostDk: gba(0x2c5c5a),
  frostLt: gba(0xdcf2f8),
  pine: gba(0x2e6a52),
  pineDk: gba(0x1e4a3a),
  pineOut: gba(0x103020),
};

/** Roof colour schemes (one per building, picked from its position). */
const ROOFS: readonly { base: number; dk: number; lt: number }[] = [
  { base: gba(0xd05840), dk: gba(0x983828), lt: gba(0xe88868) },
  { base: gba(0x4870c8), dk: gba(0x304c98), lt: gba(0x78a0e8) },
  { base: gba(0x589850), dk: gba(0x3c6c38), lt: gba(0x88c078) },
  { base: gba(0x8860b8), dk: gba(0x604088), lt: gba(0xb090d8) },
];

// ---- kinds ---------------------------------------------------------------------------------------

/** Neighbours of the tile being painted: true where the same family continues. */
export interface Around {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

const ALL: Around = { n: true, s: true, e: true, w: true };

interface Style {
  id: string;
  /** 'ground' paints every pixel; 'deco' leaves the background transparent. */
  layer: 'ground' | 'deco';
  /** Ground painted under a deco tile that has nothing beneath it. */
  base?: string;
  /** Kinds this one joins up with (edges, rails). Default: itself. */
  family?: readonly string[];
  /** Wild grass that already draws its own blades (no blade overlay on wild tiles, 10.2). */
  tall?: true;
  paint(t: Tile16, v: number, a: Around, roof: number): void;
}

function specks(t: Tile16, v: number, n: number, colours: readonly number[], margin = 1): void {
  for (let i = 0; i < n; i++) {
    const h = hash2(v, i, 7);
    const x = margin + (h % (TILE - 2 * margin));
    const y = margin + ((h >>> 8) % (TILE - 2 * margin));
    t.set(x, y, colours[(h >>> 16) % colours.length] ?? C.ink);
  }
}

function tuft(t: Tile16, x: number, y: number, dk: number, lt: number): void {
  t.set(x, y, dk)
    .set(x + 2, y, dk)
    .set(x + 1, y + 1, dk)
    .set(x, y - 1, lt)
    .set(x + 2, y - 1, lt);
}

function grass(t: Tile16, v: number): void {
  t.fill(C.grass);
  for (let i = 0; i < 3; i++) {
    const h = hash2(v, i, 3);
    tuft(t, 1 + (h % 12), 3 + ((h >>> 8) % 11), C.grassDk, C.grassLt);
  }
}

/** The wild-grass blade pattern (10.2): clearly visible so players see where encounters happen. */
function blades(
  t: Tile16,
  ink: { l: number; g: number; G: number; d: number } = {
    l: C.tallLt,
    g: C.tall,
    G: C.tallBase,
    d: C.tallDk,
  },
): void {
  for (const [x, y] of [
    [1, 1],
    [9, 1],
    [5, 9],
    [13, 9],
  ] as [number, number][]) {
    // A clump of pointed blades over a dark root line.
    t.stamp(x - 1, y, ['.l.l.', 'lglgl', 'gGgGg', 'gGgGg', 'GdGdG', 'ddddd'], ink);
  }
}

/** A snowy evergreen: three tiers over a short trunk, snow on each tier's top (Highcairn Pass). */
function pine(t: Tile16, v: number): void {
  t.rect(7, 13, 2, 3, C.bark).vline(8, 13, 15, C.barkDk);
  for (const [top, half] of [
    [1, 3],
    [5, 5],
    [9, 7],
  ] as [number, number][]) {
    for (let j = 0; j < 4; j++) {
      const w = Math.min(half, 1 + j * 2);
      t.hline(8 - w, 7, top + j, C.pine).hline(8, 7 + w, top + j, C.pineDk);
    }
    t.hline(7, 8, top, C.snowLt);
  }
  // One or two snow clumps on the branches, varied per tree.
  const h = hash2(v, 1, 19);
  t.set(5 + (h % 3), 11, C.snow).set(9 + ((h >>> 4) % 3), 7, C.snow);
  t.outline(C.pineOut);
}

function edgeLine(t: Tile16, a: Around, rgb: number, inset = 0): void {
  if (!a.n) t.hline(0, 15, inset, rgb);
  if (!a.s) t.hline(0, 15, 15 - inset, rgb);
  if (!a.w) t.vline(inset, 0, 15, rgb);
  if (!a.e) t.vline(15 - inset, 0, 15, rgb);
}

function water(t: Tile16, v: number, a: Around): void {
  t.fill(C.water);
  for (let i = 0; i < 2; i++) {
    const h = hash2(v, i, 11);
    const x = 1 + (h % 10);
    const y = 2 + ((h >>> 8) % 11);
    t.set(x, y + 1, C.waterLt)
      .hline(x + 1, x + 2, y, C.waterLt)
      .set(x + 3, y + 1, C.waterLt);
  }
  // Shore: foam where the water meets land, a darker band under it.
  if (!a.n) t.hline(0, 15, 0, C.foam).hline(0, 15, 1, C.waterDk);
  if (!a.s) t.hline(0, 15, 15, C.foam).hline(0, 15, 14, C.waterDk);
  if (!a.w) t.vline(0, 0, 15, C.foam).vline(1, 0, 15, C.waterDk);
  if (!a.e) t.vline(15, 0, 15, C.foam).vline(14, 0, 15, C.waterDk);
}

function tree(t: Tile16, v: number): void {
  t.rect(6, 11, 4, 5, C.bark).vline(9, 11, 15, C.barkDk).set(6, 15, C.barkDk);
  t.ellipse(8, 6.5, 7.2, 6.2, C.leaf);
  t.ellipse(6.5, 5, 3.6, 2.8, C.leafLt);
  t.ellipse(10.5, 9.5, 3.4, 2.2, C.leafDk);
  // Leaf clusters (varied per tree).
  for (let i = 0; i < 4; i++) {
    const h = hash2(v, i, 5);
    const x = 3 + (h % 10);
    const y = 2 + ((h >>> 8) % 8);
    if (t.get(x, y) !== 0) t.set(x, y, i % 2 ? C.leafDk : C.leafLt);
  }
  t.outline(C.leafOut);
}

function roofPaint(t: Tile16, a: Around, roof: number): void {
  const r = ROOFS[roof % ROOFS.length] ?? ROOFS[0];
  if (!r) return;
  t.fill(r.base);
  // Shingles: a dark line every 4 rows with staggered joints.
  for (let y = 3; y < 16; y += 4) {
    t.hline(0, 15, y, r.dk);
    const off = (y >> 2) % 2 ? 2 : 6;
    for (let x = off; x < 16; x += 8) t.vline(x, y - 3, y - 1, r.dk);
  }
  if (!a.n) t.hline(0, 15, 0, r.lt).hline(0, 15, 1, r.lt);
  if (!a.w) t.vline(0, 0, 15, r.dk);
  if (!a.e) t.vline(15, 0, 15, r.dk);
}

function wallPaint(t: Tile16): void {
  t.fill(C.wall);
  for (let y = 4; y < 16; y += 5) t.hline(0, 15, y, C.wallDk);
  t.hline(0, 15, 0, C.wallLt).hline(0, 15, 15, C.wallDk);
}

const STYLES: Record<string, Style> = {
  grass: { id: 'grass', layer: 'ground', paint: (t, v) => grass(t, v) },
  grass_tuft: {
    id: 'grass_tuft',
    layer: 'ground',
    paint: (t, v) => {
      grass(t, v);
      tuft(t, 4, 8, C.grassDk, C.grassLt);
      tuft(t, 8, 10, C.grassDk, C.grassLt);
      tuft(t, 6, 13, C.grassDk, C.grassLt);
    },
  },
  meadow_grass: {
    id: 'meadow_grass',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.meadow);
      specks(t, v, 6, [C.meadowDk, C.meadowLt]);
    },
  },
  flowers: {
    id: 'flowers',
    layer: 'ground',
    paint: (t, v) => {
      grass(t, v);
      const petals = [C.white, C.pink, C.yellow];
      for (let i = 0; i < 3; i++) {
        const h = hash2(v, i, 13);
        const x = 2 + (h % 11);
        const y = 2 + ((h >>> 8) % 11);
        const p = petals[(h >>> 16) % petals.length] ?? C.white;
        t.set(x, y - 1, p)
          .set(x - 1, y, p)
          .set(x + 1, y, p)
          .set(x, y + 1, p)
          .set(x, y, C.gold);
      }
    },
  },
  mushrooms: {
    id: 'mushrooms',
    layer: 'ground',
    paint: (t, v) => {
      grass(t, v);
      for (const [x, y] of [
        [4, 9],
        [10, 12],
      ] as [number, number][]) {
        t.rect(x, y, 2, 2, C.wallLt);
        t.hline(x - 1, x + 2, y - 1, C.red)
          .hline(x, x + 1, y - 2, C.red)
          .set(x, y - 1, C.white);
      }
    },
  },
  tall_grass: {
    id: 'tall_grass',
    layer: 'ground',
    paint: (t) => {
      t.fill(C.tallBase);
      blades(t);
    },
  },
  frost_grass: {
    id: 'frost_grass',
    layer: 'ground',
    tall: true,
    paint: (t) => {
      t.fill(C.frostBase);
      blades(t, { l: C.frostLt, g: C.frost, G: C.frostBase, d: C.frostDk });
    },
  },
  snow: {
    id: 'snow',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.snow);
      specks(t, v, 7, [C.snowDk, C.snowLt]);
    },
  },
  scree: {
    id: 'scree',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.scree);
      specks(t, v, 8, [C.screeDk, C.screeLt]);
      // Loose stones, lit from the top left.
      for (let i = 0; i < 3; i++) {
        const h = hash2(v, i, 23);
        const x = 1 + (h % 12);
        const y = 1 + ((h >>> 8) % 12);
        t.rect(x, y, 2, 2, C.screeLt).set(x + 1, y + 1, C.screeDk);
      }
    },
  },
  pine: { id: 'pine', layer: 'deco', base: 'snow', paint: (t, v) => pine(t, v) },
  path: {
    id: 'path',
    layer: 'ground',
    family: ['path', 'plaza', 'bridge', 'doormat', 'sand'],
    paint: (t, v, a) => {
      t.fill(C.path);
      specks(t, v, 5, [C.pathDk, C.pathLt], 2);
      edgeLine(t, a, C.pathDk);
    },
  },
  plaza: {
    id: 'plaza',
    layer: 'ground',
    paint: (t) => {
      t.fill(C.plaza);
      t.hline(0, 15, 7, C.plazaDk).hline(0, 15, 15, C.plazaDk);
      t.vline(3, 0, 6, C.plazaDk).vline(11, 8, 14, C.plazaDk);
      t.hline(0, 15, 0, C.plazaLt).hline(0, 15, 8, C.plazaLt);
    },
  },
  sand: {
    id: 'sand',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.sand);
      specks(t, v, 7, [C.sandDk, C.sandLt]);
    },
  },
  bridge: {
    id: 'bridge',
    layer: 'ground',
    // Neighbour flags mark water: planks run across the way over it, rails line the water sides.
    family: ['water', 'lily', 'reeds'],
    paint: (t, _v, a) => {
      t.fill(C.wood);
      const eastWest = a.n || a.s;
      for (let i = 3; i < 16; i += 4) {
        if (eastWest) t.vline(i, 0, 15, C.woodDk);
        else t.hline(0, 15, i, C.woodDk);
      }
      if (eastWest)
        t.hline(0, 15, 0, C.woodDk).hline(0, 15, 15, C.woodDk).hline(0, 15, 1, C.woodLt);
      else t.vline(0, 0, 15, C.woodDk).vline(15, 0, 15, C.woodDk).vline(1, 0, 15, C.woodLt);
    },
  },
  water: {
    id: 'water',
    layer: 'ground',
    family: ['water', 'lily', 'reeds'],
    paint: (t, v, a) => water(t, v, a),
  },
  lily: {
    id: 'lily',
    layer: 'ground',
    family: ['water', 'lily', 'reeds'],
    paint: (t, v, a) => {
      water(t, v, a);
      t.ellipse(8, 8, 4.5, 3.5, C.leafLt).set(8, 8, C.water).set(9, 7, C.water).set(10, 6, C.water);
      if (v % 2) t.set(6, 7, C.pink).set(5, 7, C.white);
    },
  },
  reeds: {
    id: 'reeds',
    layer: 'ground',
    family: ['water', 'lily', 'reeds'],
    paint: (t, v) => {
      t.fill(C.tallBase);
      for (let i = 0; i < 5; i++) {
        const x = 1 + ((hash2(v, i, 17) % 4) + i * 3);
        t.vline(x, 5, 15, C.leafLt).set(x, 4, C.bark).set(x, 3, C.bark);
      }
    },
  },
  floor: {
    id: 'floor',
    layer: 'ground',
    paint: (t) => {
      t.fill(C.floor);
      for (let y = 3; y < 16; y += 4) t.hline(0, 15, y, C.floorDk);
      for (let y = 0; y < 16; y += 4)
        t.set((y * 5) % 16, y + 1, C.floorDk).set((y * 5 + 8) % 16, y + 2, C.floorLt);
    },
  },
  checker_light: {
    id: 'checker_light',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.chessLight);
      specks(t, v, 4, [C.chessLightDk]);
    },
  },
  checker_dark: {
    id: 'checker_dark',
    layer: 'ground',
    paint: (t, v) => {
      t.fill(C.chessDark);
      specks(t, v, 4, [C.chessDarkDk]);
    },
  },
  inner_wall: {
    id: 'inner_wall',
    layer: 'ground',
    paint: (t) => {
      t.fill(C.innerWall);
      t.rect(0, 10, 16, 6, C.innerWallDk).hline(0, 15, 10, C.frame).hline(0, 15, 0, C.frame);
      for (let x = 2; x < 16; x += 5) t.vline(x, 11, 15, C.frame);
    },
  },
  rug: {
    id: 'rug',
    layer: 'ground',
    paint: (t, _v, a) => {
      t.fill(C.red);
      for (let i = 0; i < 16; i += 4) t.set(i + 1, 7, C.gold).set(i + 3, 9, C.gold);
      edgeLine(t, a, C.gold, 1);
      edgeLine(t, a, C.redDk);
    },
  },
  doormat: {
    id: 'doormat',
    layer: 'ground',
    paint: (t) => {
      t.fill(C.path).rect(2, 3, 12, 10, C.bark);
      for (let y = 4; y < 13; y += 2) t.hline(3, 12, y, C.woodDk);
    },
  },
  // ---- deco (transparent background) ----
  tree: { id: 'tree', layer: 'deco', base: 'grass', paint: (t, v) => tree(t, v) },
  bush: {
    id: 'bush',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      t.ellipse(8, 10, 6.6, 5.2, C.leaf)
        .ellipse(6.5, 8.5, 3, 2, C.leafLt)
        .ellipse(10.5, 12, 3, 1.6, C.leafDk);
      t.set(5, 11, C.leafDk).set(11, 9, C.leafLt);
      t.outline(C.leafOut);
    },
  },
  rock: {
    id: 'rock',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      t.ellipse(8, 10, 6.4, 5, C.rock)
        .ellipse(6.5, 8.5, 3, 2, C.rockLt)
        .ellipse(10, 12.5, 4, 1.5, C.rockDk);
      t.set(9, 8, C.rockDk).set(10, 9, C.rockDk);
      t.outline(C.rockOut);
    },
  },
  stump: {
    id: 'stump',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      t.rect(4, 9, 8, 5, C.bark).ellipse(8, 9, 4, 2, C.woodLt).set(8, 9, C.wood).set(7, 9, C.wood);
      t.vline(11, 9, 13, C.barkDk);
      t.outline(C.barkDk);
    },
  },
  fence: {
    id: 'fence',
    layer: 'deco',
    base: 'grass',
    paint: (t, _v, a) => {
      if (a.e || a.w || !(a.n || a.s)) {
        // Horizontal run: two rails reaching the neighbours, one post.
        const x0 = a.w ? 0 : 6;
        const x1 = a.e ? 15 : 9;
        t.rect(x0, 6, x1 - x0 + 1, 2, C.woodLt).rect(x0, 10, x1 - x0 + 1, 2, C.wood);
      } else {
        // Vertical run: one rail reaching the neighbours above and below.
        t.rect(7, a.n ? 0 : 4, 2, (a.s ? 16 : 15) - (a.n ? 0 : 4), C.wood);
      }
      t.rect(6, 4, 3, 11, C.wood).vline(8, 4, 14, C.woodDk).set(6, 4, C.woodLt);
      t.outline(C.barkDk);
    },
  },
  signpost: {
    id: 'signpost',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      t.rect(7, 9, 2, 6, C.bark);
      t.rect(2, 2, 12, 8, C.woodLt).rect(3, 3, 10, 6, C.wood);
      t.hline(4, 11, 5, C.woodDk).hline(4, 9, 7, C.woodDk);
      t.outline(C.barkDk);
    },
  },
  lamp: {
    id: 'lamp',
    layer: 'deco',
    base: 'plaza',
    paint: (t) => {
      t.rect(7, 5, 2, 10, C.rockDk).rect(5, 14, 6, 1, C.rockDk);
      t.rect(5, 1, 6, 4, C.lamp).hline(5, 10, 0, C.rockDk).hline(5, 10, 5, C.rockDk);
      t.outline(C.ink);
    },
  },
  fountain: {
    id: 'fountain',
    layer: 'deco',
    base: 'plaza',
    paint: (t) => {
      t.ellipse(8, 9, 7.4, 6, C.rock)
        .ellipse(8, 9, 5.4, 4.2, C.water)
        .ellipse(8, 8, 2, 1.5, C.waterLt);
      t.rect(7, 2, 2, 6, C.rockLt).set(6, 2, C.foam).set(9, 2, C.foam).set(8, 1, C.foam);
      t.outline(C.rockOut);
    },
  },
  mailbox: {
    id: 'mailbox',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      t.rect(7, 9, 2, 6, C.bark);
      t.rect(3, 3, 10, 6, C.red)
        .hline(3, 12, 3, C.pink)
        .vline(12, 3, 8, C.redDk)
        .rect(10, 1, 1, 3, C.gold);
      t.outline(C.ink);
    },
  },
  crate: {
    id: 'crate',
    layer: 'deco',
    base: 'floor',
    paint: (t) => {
      t.rect(2, 3, 12, 12, C.woodLt).rect(3, 4, 10, 10, C.wood);
      for (let i = 0; i < 10; i++) t.set(3 + i, 4 + i, C.woodLt).set(12 - i, 4 + i, C.woodLt);
      t.outline(C.barkDk);
    },
  },
  plant: {
    id: 'plant',
    layer: 'deco',
    base: 'floor',
    paint: (t) => {
      t.rect(5, 10, 6, 5, C.red).hline(4, 11, 10, C.redDk);
      t.ellipse(8, 6, 4.5, 4.2, C.leaf).set(6, 4, C.leafLt).set(9, 5, C.leafLt).set(8, 8, C.leafDk);
      t.outline(C.leafOut);
    },
  },
  bookshelf: {
    id: 'bookshelf',
    layer: 'deco',
    base: 'floor',
    paint: (t) => {
      t.rect(1, 0, 14, 16, C.frame);
      const spines = [C.red, C.glass, C.leafLt, C.gold, C.pink, C.rockLt];
      for (const y of [1, 6, 11]) {
        for (let x = 2; x < 14; x++) {
          const c = spines[(x * 7 + y) % spines.length] ?? C.red;
          t.vline(x, y, y + 3, c);
        }
        t.hline(2, 13, y + 4, C.woodDk);
      }
    },
  },
  desk: {
    id: 'desk',
    layer: 'deco',
    base: 'floor',
    paint: (t) => {
      t.rect(1, 4, 14, 7, C.woodLt)
        .hline(1, 14, 10, C.woodDk)
        .rect(2, 11, 2, 4, C.wood)
        .rect(12, 11, 2, 4, C.wood);
      t.rect(4, 5, 5, 3, C.white).hline(5, 7, 6, C.rockDk).set(11, 6, C.glass);
      t.outline(C.barkDk);
    },
  },
  blackboard: {
    id: 'blackboard',
    layer: 'deco',
    base: 'inner_wall',
    paint: (t) => {
      t.rect(0, 1, 16, 10, C.frame).rect(1, 2, 14, 8, C.board);
      // Chalk: a tiny chessboard sketch and a line of text.
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) t.set(3 + i, 4 + j, C.white);
      t.hline(8, 12, 4, C.wallLt).hline(8, 11, 6, C.wallLt).hline(8, 12, 8, C.boardDk);
    },
  },
  statue: {
    id: 'statue',
    layer: 'deco',
    base: 'plaza',
    paint: (t) => {
      // A pawn-shaped statue on a pedestal (the Chess Academy's emblem piece).
      t.rect(3, 12, 10, 4, C.rockDk).hline(3, 12, 12, C.rock);
      t.rect(5, 10, 6, 2, C.rock)
        .rect(6, 6, 4, 4, C.rock)
        .ellipse(8, 4, 2.6, 2.6, C.rockLt)
        .hline(5, 10, 9, C.rockLt);
      t.outline(C.rockOut);
    },
  },
  roof: {
    id: 'roof',
    layer: 'deco',
    base: 'grass',
    family: ['roof', 'eave'],
    paint: (t, _v, a, roof) => roofPaint(t, a, roof),
  },
  eave: {
    id: 'eave',
    layer: 'deco',
    base: 'grass',
    family: ['roof', 'eave'],
    paint: (t, _v, a, roof) => {
      const r = ROOFS[roof % ROOFS.length] ?? ROOFS[0];
      if (!r) return;
      roofPaint(t, { ...a, s: true }, roof);
      t.rect(0, 11, 16, 3, r.dk)
        .hline(0, 15, 14, C.ink)
        .hline(0, 15, 15, mix(C.ink, C.wallDk, 0.5));
    },
  },
  wall: { id: 'wall', layer: 'deco', base: 'grass', paint: (t) => wallPaint(t) },
  window: {
    id: 'window',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      wallPaint(t);
      t.rect(3, 3, 10, 8, C.frame)
        .rect(4, 4, 8, 6, C.glass)
        .vline(8, 4, 9, C.frame)
        .hline(4, 11, 7, C.frame);
      t.set(5, 5, C.glassLt).set(6, 5, C.glassLt).set(5, 6, C.glassLt);
    },
  },
  door: {
    id: 'door',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      wallPaint(t);
      t.rect(3, 2, 10, 14, C.frame).rect(4, 3, 8, 13, C.door).vline(8, 3, 15, C.doorDk);
      t.set(10, 9, C.gold).set(6, 9, C.gold).hline(4, 11, 3, C.woodLt);
    },
  },
  emblem: {
    id: 'emblem',
    layer: 'deco',
    base: 'grass',
    paint: (t) => {
      wallPaint(t);
      // A shield with a 3x3 checker: the Chess Academy crest (original).
      t.rect(4, 2, 8, 8, C.goldDk)
        .rect(5, 10, 6, 1, C.goldDk)
        .rect(6, 11, 4, 1, C.goldDk)
        .rect(7, 12, 2, 1, C.goldDk);
      t.rect(5, 3, 6, 6, C.gold);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          if ((i + j) % 2 === 0) t.rect(5 + i * 2, 3 + j * 2, 2, 2, C.chessDark);
    },
  },
};

/** Painters by keyword, for kinds a map may name differently. */
const KEYWORDS: readonly [RegExp, string][] = [
  [/tall|wild|encounter/, 'tall_grass'],
  [/flower/, 'flowers'],
  [/meadow|lawn/, 'meadow_grass'],
  [/grass/, 'grass'],
  [/water|sea|lake|pond|river|ocean/, 'water'],
  [/lily/, 'lily'],
  [/reed|marsh/, 'reeds'],
  [/bridge|plank/, 'bridge'],
  [/sand|beach/, 'sand'],
  [/plaza|pave|cobble/, 'plaza'],
  [/path|road|dirt|trail/, 'path'],
  [/tree|pine|oak|palm/, 'tree'],
  [/bush|hedge|shrub/, 'bush'],
  [/rock|boulder|stone|cliff/, 'rock'],
  [/fence|rail/, 'fence'],
  [/sign/, 'signpost'],
  [/eave/, 'eave'],
  [/roof/, 'roof'],
  [/window/, 'window'],
  [/door|gate|entrance/, 'door'],
  [/inner|interior_wall/, 'inner_wall'],
  [/wall/, 'wall'],
  [/checker|chess/, 'checker_light'],
  [/floor|wood|tile/, 'floor'],
  [/rug|carpet/, 'rug'],
  [/mat/, 'doormat'],
  [/shelf|book/, 'bookshelf'],
  [/desk|table/, 'desk'],
  [/board/, 'blackboard'],
  [/statue/, 'statue'],
  [/plant|pot/, 'plant'],
  [/crate|box|barrel/, 'crate'],
  [/mail/, 'mailbox'],
  [/lamp|light/, 'lamp'],
  [/fountain/, 'fountain'],
  [/stump|log/, 'stump'],
  [/mushroom/, 'mushrooms'],
];

/** Neutral fallback for kinds nothing matches: plain paving with a diagonal mark. */
const FALLBACK: Style = {
  id: 'unknown',
  layer: 'ground',
  paint: (t) => {
    t.fill(C.neutral);
    for (let i = 0; i < 16; i += 4) t.set(i, i, C.neutralDk).set(i + 1, i + 1, C.neutralLt);
    t.hline(0, 15, 15, C.neutralDk).vline(15, 0, 15, C.neutralDk);
  },
};

const resolved = new Map<string, Style>();

/** The painter for a drawing kind (exact, then keyword, then the neutral fallback). */
export function styleOf(kind: string): Style {
  const hit = resolved.get(kind);
  if (hit) return hit;
  const k = kind.toLowerCase();
  let style = STYLES[k];
  if (!style) {
    const kw = KEYWORDS.find(([re]) => re.test(k));
    style = (kw && STYLES[kw[1]]) || FALLBACK;
  }
  resolved.set(kind, style);
  return style;
}

/** Every kind with its own painter (the content tileset's kinds, 10.1). */
export const PAINTED_KINDS: readonly string[] = Object.keys(STYLES);

/** Paint one tile of `kind` (tests and previews). `v` varies details; `around` joins edges. */
export function paintTile(kind: string, v = 0, around: Around = ALL, roof = 0): Tile16 {
  const t = new Tile16();
  styleOf(kind).paint(t, v, around, roof);
  return t;
}

// ---- chunks --------------------------------------------------------------------------------------

/** What `paintChunk` reads from a zone (ZoneGeometry has all of it). */
export interface KindMap {
  width: number;
  height: number;
  kinds: string[][];
  wild: Uint8Array;
}

const cache = new Map<string, Uint32Array>();
const CACHE_MAX = 4096;

function cached(style: Style, v: number, a: Around, roof: number): Uint32Array {
  const mask = (a.n ? 1 : 0) | (a.s ? 2 : 0) | (a.e ? 4 : 0) | (a.w ? 8 : 0);
  const key = `${style.id}|${v & 7}|${mask}|${roof}`;
  let px = cache.get(key);
  if (!px) {
    const t = new Tile16();
    style.paint(t, v & 7, a, roof);
    px = t.px;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, px);
  }
  return px;
}

const roofIds = new WeakMap<KindMap, Int32Array>();

/** Connected roof blocks get one colour each (a building reads as one building). */
function roofColours(map: KindMap): Int32Array {
  let ids = roofIds.get(map);
  if (ids) return ids;
  const { width: w, height: h } = map;
  ids = new Int32Array(w * h).fill(-1);
  const isRoof = (i: number) =>
    map.kinds.some((layer) => {
      const s = styleOf(layer[i] ?? '');
      return s.id === 'roof' || s.id === 'eave';
    });
  for (let i = 0; i < w * h; i++) {
    if (ids[i] !== -1 || !isRoof(i)) continue;
    const colour = hash2(i % w, Math.floor(i / w), 23) % ROOFS.length;
    const stack = [i];
    ids[i] = colour;
    while (stack.length > 0) {
      const j = stack.pop() ?? 0;
      const x = j % w;
      const y = Math.floor(j / w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (ids[k] === -1 && isRoof(k)) {
          ids[k] = colour;
          stack.push(k);
        }
      }
    }
  }
  roofIds.set(map, ids);
  return ids;
}

function blit(
  out: Uint8ClampedArray,
  stride: number,
  px: Uint32Array,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = px[y * TILE + x] ?? 0;
      if (v === 0) continue;
      const i = ((oy + y) * stride + ox + x) * 4;
      out[i] = (v >> 16) & 255;
      out[i + 1] = (v >> 8) & 255;
      out[i + 2] = v & 255;
      out[i + 3] = 255;
    }
}

let wildOverlay: Uint32Array | null = null;

/** Tiles cut from an image tileset: kind -> 16x16 pixels (0 = transparent), or null. */
export type TileAtlas = (kind: string) => Uint32Array | null;

/**
 * Cut an image tileset (RGBA rows of 16x16 tiles, as Tiled uses it) into tiles by kind, with `ids`
 * mapping each kind to its tile index (the content tileset's `tileId`). Pixels under half alpha
 * are transparent.
 */
export function atlasFromImage(
  rgba: ArrayLike<number>,
  width: number,
  ids: ReadonlyMap<string, number>,
): TileAtlas {
  const cols = Math.floor(width / TILE);
  const rows = Math.floor(rgba.length / 4 / Math.max(1, width) / TILE);
  const tiles = new Map<string, Uint32Array>();
  for (const [kind, id] of ids) {
    const cx = id % cols;
    const cy = Math.floor(id / cols);
    if (cols === 0 || cy >= rows) continue;
    const px = new Uint32Array(TILE * TILE);
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const i = ((cy * TILE + y) * width + cx * TILE + x) * 4;
        if ((rgba[i + 3] ?? 0) < 128) continue;
        px[y * TILE + x] =
          0x1000000 | ((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0);
      }
    tiles.set(kind, px);
  }
  return (kind) => tiles.get(kind) ?? null;
}

const seeThrough = new WeakMap<Uint32Array, boolean>();

function transparent(px: Uint32Array): boolean {
  let t = seeThrough.get(px);
  if (t === undefined) {
    t = px.includes(0);
    seeThrough.set(px, t);
  }
  return t;
}

/**
 * Paint tiles [x0, x0 + w) x [y0, y0 + h) of a zone into an RGBA buffer of (16w) x (16h) pixels.
 * Kinds found in `atlas` (the content tileset, what Tiled shows) draw from it; other kinds use the
 * procedural painters (keyword match, then the neutral fallback). Layers draw bottom first; a
 * see-through tile with nothing under it gets its base ground; wild tiles whose kinds do not
 * already draw tall grass get the blade pattern on top (10.2: players must see where encounters
 * happen). Tiles outside the map stay transparent.
 */
export function paintChunk(
  map: KindMap,
  x0: number,
  y0: number,
  w: number,
  h: number,
  atlas: TileAtlas | null = null,
): Uint8ClampedArray<ArrayBuffer> {
  const stride = w * TILE;
  const out = new Uint8ClampedArray(stride * h * TILE * 4);
  const roofs = roofColours(map);
  wildOverlay ??= (() => {
    const t = new Tile16();
    blades(t);
    return t.px;
  })();
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      const x = x0 + tx;
      const y = y0 + ty;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      const v = hash2(x, y);
      let painted = false;
      let tall = false;
      for (const layer of map.kinds) {
        const kind = layer[i] ?? '';
        if (!kind) continue;
        const style = styleOf(kind);
        const img = atlas?.(kind) ?? null;
        if (!painted && (img ? transparent(img) : style.layer === 'deco')) {
          const base = style.base ?? 'grass';
          const under = atlas?.(base) ?? cached(styleOf(base), v, ALL, 0);
          blit(out, stride, under, tx * TILE, ty * TILE);
        }
        if (img) {
          blit(out, stride, img, tx * TILE, ty * TILE);
        } else {
          const fam = style.family ?? [style.id];
          const same = (dx: number, dy: number) => {
            const nx = x + dx;
            const ny = y + dy;
            // The map edge continues the tile (no shore line along the border).
            if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return true;
            return fam.includes(styleOf(layer[ny * map.width + nx] ?? '').id);
          };
          const around = { n: same(0, -1), s: same(0, 1), e: same(1, 0), w: same(-1, 0) };
          const roof = Math.max(0, roofs[i] ?? 0);
          blit(out, stride, cached(style, v, around, roof), tx * TILE, ty * TILE);
        }
        painted = true;
        if (style.id === 'tall_grass' || style.tall) tall = true;
      }
      if (!painted) blit(out, stride, cached(FALLBACK, v, ALL, 0), tx * TILE, ty * TILE);
      if (map.wild[i] && !tall) blit(out, stride, wildOverlay, tx * TILE, ty * TILE);
    }
  return out;
}
