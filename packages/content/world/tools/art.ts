/**
 * Overworld tile art (R-ART-001, R-ART-003): original 16x16 pixel art painted in code with a small,
 * limited palette, one painter per tile kind in `tiles.ts`. `gen-maps.ts` writes the result to
 * `assets/world/tiles.png` (8 columns). Deco tiles keep a transparent background so the ground
 * layer shows through. Pure and deterministic: texture noise is a hash of the pixel position.
 */
import { TILES, TILESET_COLUMNS } from '../tiles.ts';

type RGBA = readonly [number, number, number, number];

const hex = (h: string): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];
const CLEAR: RGBA = [0, 0, 0, 0];

const C = {
  grass: hex('#6fbf5a'),
  grassDark: hex('#57a64a'),
  grassLight: hex('#90d672'),
  path: hex('#dbc08a'),
  pathDark: hex('#c2a268'),
  pathLight: hex('#ead6a6'),
  plaza: hex('#cdc6b6'),
  plazaLine: hex('#a79f8f'),
  plazaLight: hex('#e0dacd'),
  tallBase: hex('#4c9c4a'),
  tall: hex('#3f8f44'),
  tallDark: hex('#2f7236'),
  tallTip: hex('#86cf68'),
  sand: hex('#e8d39a'),
  sandDark: hex('#d3ba7c'),
  sandLight: hex('#f4e5b8'),
  plank: hex('#b9854f'),
  plankDark: hex('#87602f'),
  plankEdge: hex('#6c4a26'),
  plankLight: hex('#d0a06a'),
  leaf: hex('#3f8f4a'),
  leafDark: hex('#2d6b3a'),
  leafLight: hex('#68b65e'),
  bush: hex('#4a9a50'),
  bushDark: hex('#357a40'),
  bushLight: hex('#72c068'),
  trunk: hex('#7a4f2e'),
  trunkDark: hex('#5a3920'),
  rock: hex('#8d929c'),
  rockDark: hex('#6a6f79'),
  rockLight: hex('#b7bcc5'),
  water: hex('#4a8ed8'),
  waterDark: hex('#3a74bd'),
  waterLight: hex('#86bdf0'),
  fence: hex('#c69c66'),
  fenceDark: hex('#8b6539'),
  wood: hex('#8a5a32'),
  woodDark: hex('#6a4424'),
  woodLight: hex('#c9a066'),
  roof: hex('#c4544a'),
  roofDark: hex('#973c36'),
  roofLight: hex('#df7c6c'),
  wall: hex('#ebe0c8'),
  wallDark: hex('#cdbd9d'),
  glass: hex('#9fd0f0'),
  glassLight: hex('#dbf1ff'),
  gold: hex('#f0c040'),
  banner: hex('#3f5eab'),
  bannerDark: hex('#2e4683'),
  white: hex('#f5f5f0'),
  lampPost: hex('#4a4a58'),
  lampLight: hex('#ffe38a'),
  floor: hex('#c99d65'),
  floorDark: hex('#a67b47'),
  checkLight: hex('#eee2c6'),
  checkLightSpeck: hex('#e2d4b4'),
  checkDark: hex('#8a6a4a'),
  checkDarkSpeck: hex('#7a5c3e'),
  innerWall: hex('#baa98d'),
  innerWallDark: hex('#8e7c62'),
  innerWallLight: hex('#d2c3a8'),
  red: hex('#d4525a'),
  blue: hex('#3f5eab'),
  green: hex('#4a9a50'),
  yellow: hex('#e0b040'),
  pink: hex('#f08aa8'),
  rug: hex('#ad4848'),
  rugTrim: hex('#d8a040'),
  mat: hex('#6a8a4a'),
  matDark: hex('#526e38'),
  stone: hex('#c9c9c4'),
  stoneDark: hex('#9c9c96'),
  stoneLight: hex('#e6e6e1'),
  board: hex('#2f4a3a'),
  chalk: hex('#e8f0e8'),
  pot: hex('#b0643a'),
  potDark: hex('#8a4a2a'),
  meadow: hex('#86c96a'),
  meadowDark: hex('#6db257'),
  meadowLight: hex('#a6dc86'),
  reed: hex('#5a8a3a'),
  reedDark: hex('#40682a'),
  snow: hex('#e4ecf4'),
  snowShade: hex('#c4d4e4'),
  snowGlint: hex('#fbfdff'),
  scree: hex('#a6988a'),
  screeDark: hex('#827464'),
  screeLight: hex('#c8bcac'),
  frostBase: hex('#4e8c84'),
  frost: hex('#3f7c76'),
  frostDark: hex('#2c5c5a'),
  frostTip: hex('#dcf2f8'),
  pine: hex('#2e6a52'),
  pineDark: hex('#1e4a3a'),
  pineLight: hex('#4e8c6c'),
} as const;

class Tile {
  readonly px: RGBA[] = new Array<RGBA>(256).fill(CLEAR);
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  set(x: number, y: number, c: RGBA): void {
    if (x >= 0 && y >= 0 && x < 16 && y < 16) this.px[y * 16 + x] = c;
  }

  get(x: number, y: number): RGBA {
    return x >= 0 && y >= 0 && x < 16 && y < 16 ? (this.px[y * 16 + x] ?? CLEAR) : CLEAR;
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  fill(c: RGBA): void {
    this.rect(0, 0, 16, 16, c);
  }

  /** Pixels whose centre lies inside the ellipse. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }

  /** Deterministic texture noise in [0, 1). */
  noise(x: number, y: number): number {
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(this.seed, 69069);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  speckle(c: RGBA, density: number, salt = 0): void {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (this.noise(x + salt * 31, y + salt * 17) < density) this.set(x, y, c);
  }

  /** Darken the opaque pixels that touch a transparent pixel or the tile edge below/right. */
  outline(c: RGBA, match: (p: RGBA) => boolean): void {
    const edge: [number, number][] = [];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const p = this.get(x, y);
        if (p[3] === 0 || !match(p)) continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (n.some((q) => q[3] === 0)) edge.push([x, y]);
      }
    for (const [x, y] of edge) this.set(x, y, c);
  }

  /** Stamp a pixel pattern ('#' = colour, 'o' = accent, '.' = skip). */
  stamp(x: number, y: number, rows: readonly string[], c: RGBA, accent: RGBA = c): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '#') this.set(x + i, y + j, c);
        else if (row[i] === 'o') this.set(x + i, y + j, accent);
      }
    });
  }
}

const KNIGHT_SMALL = ['..##..', '.####.', '##o###', '######', '...###', '..####', '.#####'];
const KNIGHT_BIG = [
  '...##...',
  '..####..',
  '.##o###.',
  '#######.',
  '###.###.',
  '....###.',
  '...####.',
  '..#####.',
  '.######.',
  '########',
];

function grass(t: Tile): void {
  t.fill(C.grass);
  t.speckle(C.grassDark, 0.08);
  t.speckle(C.grassLight, 0.04, 1);
}

function water(t: Tile): void {
  t.fill(C.water);
  for (const [y, off] of [
    [3, 0],
    [8, 4],
    [13, 2],
  ] as const) {
    for (let x = 0; x < 16; x++) {
      if ((x + off) % 8 < 3) {
        t.set(x, y, C.waterLight);
        t.set(x, y + 1, C.waterDark);
      }
    }
  }
}

function innerWall(t: Tile): void {
  t.fill(C.innerWall);
  t.rect(0, 0, 16, 2, C.innerWallLight);
  t.rect(0, 10, 16, 6, C.innerWallDark);
  t.rect(0, 10, 16, 1, C.woodDark);
  for (let x = 0; x < 16; x += 8) t.rect(x, 11, 1, 5, C.woodDark);
}

function wall(t: Tile): void {
  t.fill(C.wall);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (y % 5 === 4) t.set(x, y, C.wallDark);
      else if ((x + (Math.floor(y / 5) % 2) * 4) % 8 === 0) t.set(x, y, C.wallDark);
    }
}

function roofPattern(t: Tile, rows: number): void {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < 16; x++) {
      const shift = (Math.floor(y / 4) % 2) * 2;
      let c: RGBA = C.roof;
      if (y % 4 === 3) c = C.roofDark;
      else if ((x + shift) % 4 === 0 && y % 4 === 2) c = C.roofDark;
      else if ((x + shift) % 4 === 2 && y % 4 === 0) c = C.roofLight;
      t.set(x, y, c);
    }
}

const PAINTERS: Record<string, (t: Tile) => void> = {
  grass,
  grass_tuft(t) {
    grass(t);
    for (const [x, y] of [
      [4, 11],
      [11, 5],
      [12, 13],
    ] as const) {
      t.set(x, y, C.grassDark);
      t.set(x - 1, y - 1, C.grassDark);
      t.set(x + 1, y - 1, C.grassDark);
      t.set(x - 2, y - 2, C.grassLight);
      t.set(x + 2, y - 2, C.grassLight);
      t.set(x, y - 2, C.grassLight);
    }
  },
  flowers(t) {
    grass(t);
    for (const [x, y, c] of [
      [4, 4, C.red],
      [11, 6, C.white],
      [6, 11, C.pink],
      [13, 13, C.red],
      [1, 14, C.white],
    ] as const) {
      t.set(x - 1, y, c);
      t.set(x + 1, y, c);
      t.set(x, y - 1, c);
      t.set(x, y + 1, c);
      t.set(x, y, C.yellow);
    }
  },
  path(t) {
    t.fill(C.path);
    t.speckle(C.pathDark, 0.1);
    t.speckle(C.pathLight, 0.06, 1);
  },
  plaza(t) {
    t.fill(C.plaza);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const shift = (Math.floor(y / 4) % 2) * 4;
        if (y % 4 === 3 || (x + shift) % 8 === 7) t.set(x, y, C.plazaLine);
        else if (y % 4 === 0 && (x + shift) % 8 < 3) t.set(x, y, C.plazaLight);
      }
  },
  tall_grass(t) {
    t.fill(C.tallBase);
    for (const [base, off] of [
      [7, 0],
      [15, 2],
    ] as const) {
      for (let x = 0; x < 16; x++) {
        const h = [5, 3, 4, 2][(x + off) % 4] ?? 3;
        for (let k = 0; k <= h; k++)
          t.set(x, base - k, k === h ? C.tallTip : k < 2 ? C.tallDark : C.tall);
      }
    }
  },
  sand(t) {
    t.fill(C.sand);
    t.speckle(C.sandDark, 0.1);
    t.speckle(C.sandLight, 0.08, 1);
  },
  bridge(t) {
    t.fill(C.plank);
    for (let y = 0; y < 16; y++) {
      if (y % 4 === 3) t.rect(0, y, 16, 1, C.plankDark);
      if (y % 4 === 0) t.rect(1, y, 14, 1, C.plankLight);
      if (y % 4 === 1) {
        t.set(2, y, C.plankEdge);
        t.set(13, y, C.plankEdge);
      }
    }
    t.rect(0, 0, 1, 16, C.plankEdge);
    t.rect(15, 0, 1, 16, C.plankEdge);
  },
  tree(t) {
    t.rect(6, 11, 4, 5, C.trunk);
    t.rect(9, 11, 1, 5, C.trunkDark);
    t.ellipse(8, 6.5, 7.5, 6.5, C.leaf);
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 16; x++) {
        if (t.get(x, y) !== C.leaf) continue;
        const s = x - 8 + (y - 6.5);
        if (s > 5) t.set(x, y, C.leafDark);
        else if (s < -6) t.set(x, y, C.leafLight);
        else if (t.noise(x, y) < 0.12) t.set(x, y, C.leafDark);
      }
    t.outline(C.leafDark, (p) => p !== C.trunk && p !== C.trunkDark);
  },
  bush(t) {
    t.ellipse(8, 9.5, 7, 6.5, C.bush);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (t.get(x, y) !== C.bush) continue;
        const s = x - 8 + (y - 9.5);
        if (s > 4) t.set(x, y, C.bushDark);
        else if (s < -5) t.set(x, y, C.bushLight);
      }
    t.outline(C.bushDark, () => true);
  },
  rock(t) {
    t.ellipse(8, 10.5, 6.5, 5, C.rock);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (t.get(x, y) !== C.rock) continue;
        if (y > 12) t.set(x, y, C.rockDark);
        else if (x + y < 14) t.set(x, y, C.rockLight);
      }
    t.outline(C.rockDark, () => true);
  },
  water,
  lily(t) {
    water(t);
    t.ellipse(8, 8, 5, 4.5, C.bush);
    for (let x = 8; x < 16; x++)
      for (let y = 0; y < 16; y++)
        if (Math.abs(y + 0.5 - 8) <= (x - 8) / 3 && t.get(x, y) === C.bush) t.set(x, y, C.water);
    t.rect(4, 5, 2, 1, C.bushLight);
    t.stamp(6, 6, ['.o.', 'ooo', '.o.'], C.pink, C.pink);
    t.set(7, 7, C.yellow);
  },
  fence(t) {
    t.rect(2, 4, 2, 11, C.fence);
    t.rect(12, 4, 2, 11, C.fence);
    t.rect(0, 6, 16, 2, C.fence);
    t.rect(0, 10, 16, 2, C.fence);
    t.rect(0, 7, 16, 1, C.fenceDark);
    t.rect(0, 11, 16, 1, C.fenceDark);
    t.rect(2, 4, 2, 1, C.fenceDark);
    t.rect(12, 4, 2, 1, C.fenceDark);
    t.rect(3, 12, 1, 3, C.fenceDark);
    t.rect(13, 12, 1, 3, C.fenceDark);
  },
  signpost(t) {
    t.rect(7, 9, 2, 7, C.wood);
    t.rect(8, 9, 1, 7, C.woodDark);
    t.rect(2, 2, 12, 7, C.woodLight);
    t.rect(2, 2, 12, 1, C.woodDark);
    t.rect(2, 8, 12, 1, C.woodDark);
    t.rect(2, 2, 1, 7, C.woodDark);
    t.rect(13, 2, 1, 7, C.woodDark);
    t.rect(4, 4, 5, 1, C.wood);
    t.rect(10, 4, 2, 1, C.wood);
    t.rect(4, 6, 3, 1, C.wood);
    t.rect(8, 6, 4, 1, C.wood);
  },
  stump(t) {
    t.rect(3, 9, 10, 5, C.wood);
    t.rect(3, 9, 1, 5, C.woodDark);
    t.rect(12, 9, 1, 5, C.woodDark);
    t.rect(2, 13, 2, 1, C.wood);
    t.rect(12, 13, 2, 1, C.wood);
    t.ellipse(8, 9, 5, 2.5, C.woodLight);
    t.ellipse(8, 9, 2.5, 1.2, C.wood);
    t.set(7, 8, C.woodDark);
  },
  roof(t) {
    roofPattern(t, 16);
  },
  eave(t) {
    roofPattern(t, 12);
    t.rect(0, 12, 16, 2, C.roofDark);
    t.rect(0, 14, 16, 2, C.wallDark);
  },
  wall,
  window(t) {
    wall(t);
    t.rect(3, 3, 10, 9, C.woodDark);
    t.rect(4, 4, 8, 7, C.glass);
    t.rect(8, 4, 1, 7, C.woodDark);
    t.rect(4, 7, 8, 1, C.woodDark);
    t.rect(5, 5, 2, 1, C.glassLight);
    t.set(5, 6, C.glassLight);
    t.rect(2, 12, 12, 1, C.woodLight);
  },
  door(t) {
    wall(t);
    t.rect(5, 2, 6, 1, C.wood);
    t.rect(4, 3, 8, 1, C.wood);
    t.rect(3, 4, 10, 12, C.wood);
    for (const x of [5, 8, 11]) t.rect(x, 4, 1, 12, C.woodDark);
    t.rect(3, 4, 1, 12, C.woodDark);
    t.rect(12, 4, 1, 12, C.woodDark);
    t.rect(4, 2, 1, 1, C.woodDark);
    t.rect(11, 2, 1, 1, C.woodDark);
    t.set(10, 9, C.gold);
  },
  emblem(t) {
    wall(t);
    t.rect(3, 1, 10, 1, C.woodDark);
    t.rect(4, 2, 8, 10, C.banner);
    t.rect(4, 12, 3, 1, C.banner);
    t.rect(9, 12, 3, 1, C.banner);
    t.rect(4, 13, 2, 1, C.banner);
    t.rect(10, 13, 2, 1, C.banner);
    t.rect(4, 2, 1, 12, C.bannerDark);
    t.rect(11, 2, 1, 12, C.bannerDark);
    t.stamp(5, 3, KNIGHT_SMALL, C.white, C.banner);
  },
  lamp(t) {
    t.rect(6, 0, 4, 1, C.lampPost);
    t.rect(5, 1, 6, 5, C.lampPost);
    t.rect(6, 2, 4, 3, C.lampLight);
    t.rect(7, 6, 2, 8, C.lampPost);
    t.rect(5, 14, 6, 2, C.lampPost);
  },
  fountain(t) {
    t.ellipse(8, 8.5, 7.5, 7, C.stone);
    t.ellipse(8, 8.5, 5.5, 5, C.water);
    t.rect(7, 3, 2, 6, C.glassLight);
    t.rect(5, 9, 2, 1, C.waterLight);
    t.rect(10, 11, 2, 1, C.waterLight);
    for (let x = 0; x < 16; x++)
      for (let y = 12; y < 16; y++) if (t.get(x, y) === C.stone) t.set(x, y, C.stoneDark);
  },
  floor(t) {
    t.fill(C.floor);
    for (let x = 0; x < 16; x++) {
      if (x % 4 === 3) t.rect(x, 0, 1, 16, C.floorDark);
      const end = ((x >> 2) * 5 + 3) % 16;
      if (x % 4 !== 3) t.set(x, end, C.floorDark);
    }
  },
  checker_light(t) {
    t.fill(C.checkLight);
    t.speckle(C.checkLightSpeck, 0.05);
  },
  checker_dark(t) {
    t.fill(C.checkDark);
    t.speckle(C.checkDarkSpeck, 0.05);
  },
  inner_wall: innerWall,
  bookshelf(t) {
    t.fill(C.woodDark);
    const colors = [C.red, C.blue, C.green, C.yellow, C.white, C.blue, C.red];
    for (const [top, bottom] of [
      [1, 4],
      [6, 9],
      [11, 14],
    ] as const) {
      t.rect(1, top, 14, bottom - top + 1, C.trunkDark);
      for (let x = 1, i = top; x < 15; x += 2, i++) {
        const h = t.noise(x, top) < 0.3 ? bottom - top : bottom - top + 1;
        t.rect(x, bottom - h + 1, 2, h, colors[i % colors.length] ?? C.red);
        t.rect(x + 1, bottom - h + 1, 1, h, C.trunkDark);
      }
      t.rect(0, bottom + 1, 16, 1, C.wood);
    }
  },
  desk(t) {
    t.rect(1, 6, 14, 4, C.wood);
    t.rect(1, 6, 14, 1, C.woodLight);
    t.rect(1, 9, 14, 1, C.woodDark);
    t.rect(2, 10, 2, 6, C.woodDark);
    t.rect(12, 10, 2, 6, C.woodDark);
    t.rect(4, 5, 4, 2, C.white);
    t.rect(9, 4, 3, 2, C.red);
    t.rect(9, 5, 3, 1, C.roofDark);
  },
  rug(t) {
    t.fill(C.rug);
    t.rect(1, 1, 14, 1, C.rugTrim);
    t.rect(1, 14, 14, 1, C.rugTrim);
    t.rect(1, 1, 1, 14, C.rugTrim);
    t.rect(14, 1, 1, 14, C.rugTrim);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.abs(x + 0.5 - 8) + Math.abs(y + 0.5 - 8);
        if (d <= 4 && d > 2) t.set(x, y, C.rugTrim);
      }
  },
  doormat(t) {
    t.fill(C.mat);
    for (let y = 1; y < 15; y += 3) t.rect(1, y, 14, 1, C.matDark);
    for (let x = 0; x < 16; x += 2) {
      t.set(x, 0, C.matDark);
      t.set(x + 1, 15, C.matDark);
    }
  },
  statue(t) {
    t.rect(3, 12, 10, 4, C.stoneDark);
    t.rect(3, 12, 10, 1, C.stone);
    t.stamp(4, 2, KNIGHT_BIG, C.stone, C.stoneDark);
    for (let y = 2; y < 12; y++)
      for (let x = 4; x < 12; x++) if (t.get(x, y) === C.stone && x >= 9) t.set(x, y, C.stoneDark);
    t.outline(C.stoneDark, (p) => p === C.stone);
    t.set(5, 5, C.stoneLight);
    t.set(4, 6, C.stoneLight);
  },
  blackboard(t) {
    innerWall(t);
    t.rect(1, 2, 14, 10, C.woodDark);
    t.rect(2, 3, 12, 8, C.board);
    t.rect(3, 5, 4, 1, C.chalk);
    t.rect(9, 5, 3, 1, C.chalk);
    t.rect(3, 8, 5, 1, C.chalk);
    t.stamp(9, 7, ['###', '#.#', '###'], C.chalk);
    t.rect(2, 12, 12, 1, C.wood);
  },
  plant(t) {
    t.ellipse(5, 6.5, 3.5, 3.5, C.green);
    t.ellipse(11, 6.5, 3.5, 3.5, C.green);
    t.ellipse(8, 4, 3.5, 3.5, C.bushLight);
    t.outline(C.bushDark, () => true);
    t.rect(3, 10, 10, 1, C.potDark);
    t.rect(4, 11, 8, 5, C.pot);
    t.rect(11, 11, 1, 5, C.potDark);
  },
  crate(t) {
    t.rect(2, 3, 12, 12, C.plank);
    t.rect(2, 3, 12, 1, C.plankLight);
    for (let i = 0; i < 10; i++) {
      t.set(3 + i, 4 + i, C.plankDark);
      t.set(12 - i, 4 + i, C.plankDark);
    }
    t.rect(2, 3, 1, 12, C.plankEdge);
    t.rect(13, 3, 1, 12, C.plankEdge);
    t.rect(2, 14, 12, 1, C.plankEdge);
  },
  mailbox(t) {
    t.rect(7, 9, 2, 7, C.woodDark);
    t.rect(4, 3, 8, 1, C.blue);
    t.rect(3, 4, 10, 5, C.blue);
    t.rect(3, 8, 10, 1, C.bannerDark);
    t.rect(5, 5, 6, 1, C.bannerDark);
    t.rect(12, 2, 1, 5, C.red);
    t.rect(13, 2, 1, 2, C.red);
  },
  meadow_grass(t) {
    t.fill(C.meadow);
    t.speckle(C.meadowDark, 0.1);
    t.speckle(C.meadowLight, 0.06, 1);
    t.speckle(C.white, 0.01, 2);
  },
  mushrooms(t) {
    grass(t);
    for (const [x, y] of [
      [4, 11],
      [11, 6],
    ] as const) {
      t.rect(x - 2, y - 2, 5, 2, C.red);
      t.rect(x - 1, y - 3, 3, 1, C.red);
      t.set(x - 1, y - 2, C.white);
      t.set(x + 1, y - 1, C.white);
      t.rect(x - 1, y, 2, 2, C.white);
    }
  },
  snow(t) {
    t.fill(C.snow);
    t.speckle(C.snowShade, 0.1);
    t.speckle(C.snowGlint, 0.05, 1);
  },
  scree(t) {
    t.fill(C.scree);
    t.speckle(C.screeDark, 0.14);
    t.speckle(C.screeLight, 0.08, 1);
    // A few loose stones, lit from the top left.
    for (const [x, y] of [
      [3, 4],
      [10, 2],
      [6, 11],
      [12, 12],
    ] as const) {
      t.rect(x, y, 2, 2, C.screeLight);
      t.set(x + 1, y + 1, C.screeDark);
    }
  },
  frost_grass(t) {
    // Tall grass (10.2: encounters roll here) with rime on the blade tips.
    t.fill(C.frostBase);
    for (const [base, off] of [
      [7, 0],
      [15, 2],
    ] as const) {
      for (let x = 0; x < 16; x++) {
        const h = [5, 3, 4, 2][(x + off) % 4] ?? 3;
        for (let k = 0; k <= h; k++)
          t.set(x, base - k, k === h ? C.frostTip : k < 2 ? C.frostDark : C.frost);
      }
    }
  },
  pine(t) {
    // A snowy evergreen: three tiers over a short trunk, snow along each tier's top edge.
    t.rect(7, 13, 2, 3, C.trunk);
    t.rect(8, 13, 1, 3, C.trunkDark);
    for (const [top, half] of [
      [1, 3],
      [5, 5],
      [9, 7],
    ] as const) {
      for (let j = 0; j < 4; j++) {
        const w = Math.min(half, 1 + j * 2);
        for (let x = 8 - w; x < 8 + w; x++) t.set(x, top + j, x < 8 ? C.pine : C.pineDark);
      }
      for (let x = 7; x <= 8; x++) t.set(x, top, C.snowGlint);
      t.set(8 - half, top + 3, C.snow);
      t.set(7 + half, top + 3, C.snowShade);
    }
    t.outline(C.pineDark, (p) => p === C.pine || p === C.pineLight);
  },
  reeds(t) {
    water(t);
    for (const x of [2, 5, 9, 12, 14]) {
      const top = 4 + Math.floor(t.noise(x, 0) * 5);
      t.rect(x, top, 1, 16 - top, C.reed);
      t.set(x, 15, C.reedDark);
      t.rect(x, top - 3, 1, 3, C.wood);
    }
  },
};

export interface Image {
  width: number;
  height: number;
  /** RGBA, row-major. */
  rgba: Uint8Array;
}

/** Paint every tile of `TILES` into one image, 8 tiles per row. */
export function paintTileset(): Image {
  const cols = TILESET_COLUMNS;
  const rows = Math.ceil(TILES.length / cols);
  const width = cols * 16;
  const height = rows * 16;
  const rgba = new Uint8Array(width * height * 4);
  TILES.forEach((def, i) => {
    const painter = PAINTERS[def.kind];
    if (!painter) throw new Error(`no painter for tile kind ${def.kind}`);
    const t = new Tile(i + 1);
    painter(t);
    const ox = (i % cols) * 16;
    const oy = Math.floor(i / cols) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const p = t.get(x, y);
        const o = ((oy + y) * width + ox + x) * 4;
        rgba[o] = p[0];
        rgba[o + 1] = p[1];
        rgba[o + 2] = p[2];
        rgba[o + 3] = p[3];
      }
  });
  return { width, height, rgba };
}
