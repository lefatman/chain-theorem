/**
 * Procedural creature sprites (R-ART-001, R-ART-002, R-ART-003). Every creature is painted at
 * runtime on a 24x24 material grid, then coloured with its element palette:
 *
 * - Silhouette follows piece type in every element: pawn small, knight a leaping beast, bishop a
 *   slender caster with a staff, rook sturdy and crenellated, queen tall and regal with a beaded
 *   coronet, king round and crowned. Type is readable from the outline alone.
 * - Element changes the palette plus small motifs: flames, wave crests, leaves, sparks, rocks, ice.
 *   The Storm, Stone and Frost creatures (M7 7.3) also wear a chest emblem on their front sprites
 *   (a lightning zigzag, a stacked stone, a snow star): a shape cue that survives colour-vision
 *   deficiencies next to the palette (R-ART-002: colour is never the only signal).
 * - Each creature has a front sprite, a back sprite, a 2-frame idle and a faint frame.
 *
 * All shapes are original: no Pokémon names, designs or capture-ball shapes (R-ART-003).
 * Region x <= 4, y <= 4 of every sprite stays clear for the glyph badge drawn over it on the board.
 */
import type { ElementId, PieceType } from '@chain-theorem/rules';
import { blit, M, PixelGrid, writeRgba, type Ctx2D } from './pixel.ts';
import { creaturePalette } from './palette.ts';

export const SPRITE = 24;
export type CreatureFacing = 'front' | 'back';
export type CreatureFrame = 'idle0' | 'idle1' | 'faint';
export const CREATURE_FRAMES: readonly CreatureFrame[] = ['idle0', 'idle1', 'faint'];
export const PIECE_TYPES: readonly PieceType[] = [
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];
export const ELEMENTS: readonly ElementId[] = ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'];

interface Pose {
  el: ElementId;
  front: boolean;
  /** Idle variant (motif flicker). */
  v: 0 | 1;
  faint: boolean;
}

type Stamp = readonly string[];
const KEY: Record<string, number> = {
  o: M.OUT,
  b: M.BASE,
  a: M.ACC,
  d: M.ACC_SH,
  m: M.MOTIF,
  n: M.MOTIF2,
  w: M.WHITE,
  g: M.GOLD,
  e: M.EYE,
  y: M.BELLY,
};

// ---------------------------------------------------------------------------------------------
// Element motifs. A crest sits on top of a head (bottom row at the anchor), a tail tip at the
// end of a tail, a pattern marks the body. Two variants give the idle flicker.
// ---------------------------------------------------------------------------------------------

interface Motif {
  crest: [Stamp, Stamp];
  small: [Stamp, Stamp];
  tail: [Stamp, Stamp];
  /** Body pattern: relative points (0..1) inside a box, painted onto BASE pixels. */
  pattern: { at: readonly (readonly [number, number])[]; m: number };
  /** Chest emblem on front sprites (M7 7.3 elements), painted only onto body pixels. */
  emblem?: Stamp;
}

const MOTIFS: Record<ElementId, Motif> = {
  ember: {
    crest: [
      ['..a..', '.aa..', '.ama.', 'amnma', 'amnma'],
      ['...a.', '..aa.', '.ama.', 'amnma', 'amnma'],
    ],
    small: [
      ['.a.', 'aa.', 'ama', 'ama'],
      ['..a', '.aa', 'ama', 'ama'],
    ],
    tail: [
      ['.a.', 'aaa', 'ama', '.a.'],
      ['a..', 'aaa', 'ama', '.a.'],
    ],
    pattern: { at: [], m: M.MOTIF },
  },
  tide: {
    crest: [
      ['.aa..', 'a.naa', '..naa', '.aaa.'],
      ['..aa.', '.a.na', '..naa', '.aaa.'],
    ],
    small: [
      ['aa.', '.na', 'aaa'],
      ['.aa', '.na', 'aaa'],
    ],
    tail: [
      ['a...a', 'aa.aa', '.aaa.'],
      ['.a..a', 'aa.aa', '.aaa.'],
    ],
    pattern: {
      at: [
        [0.2, 0.55],
        [0.35, 0.45],
        [0.5, 0.55],
        [0.65, 0.45],
        [0.8, 0.55],
      ],
      m: M.ACC,
    },
  },
  grove: {
    crest: [
      ['aa.mm', 'aamma', '.aam.', '..a..'],
      ['mm.aa', 'amaa.', '.maa.', '..a..'],
    ],
    small: [
      ['a.m', 'ama', '.a.'],
      ['m.a', 'ama', '.a.'],
    ],
    tail: [
      ['.mm', 'maa', 'aa.'],
      ['mm.', 'maa', 'aa.'],
    ],
    pattern: {
      at: [
        [0.25, 0.35],
        [0.7, 0.3],
        [0.5, 0.7],
      ],
      m: M.ACC,
    },
  },
  storm: {
    crest: [
      ['...mm', '..mm.', '.mmmm', '..mm.', '.mm..'],
      ['..mm.', '.mm..', 'mmmm.', '.mm.n', 'mm...'],
    ],
    small: [
      ['.mm', 'mm.', '.m.'],
      ['mm.', '.mm', '.m.'],
    ],
    tail: [
      ['..m', '.mm', 'mm.', 'm..'],
      ['.mm', 'mm.', '.m.', 'm..'],
    ],
    pattern: {
      at: [
        [0.2, 0.4],
        [0.35, 0.55],
        [0.5, 0.4],
        [0.65, 0.55],
        [0.8, 0.4],
      ],
      m: M.ACC,
    },
    // A lightning zigzag.
    emblem: ['..dd', '.dd.', 'dddd', '.dd.', 'dd..'],
  },
  stone: {
    crest: [
      ['.dd..', 'daad.', 'daaam', '.aaaa'],
      ['.dd..', 'daad.', 'daaam', '.aaaa'],
    ],
    small: [
      ['.d.', 'dam', 'aaa'],
      ['.d.', 'dam', 'aaa'],
    ],
    tail: [
      ['.dd.', 'daad', 'daaa', '.aa.'],
      ['.dd.', 'daad', 'daaa', '.aa.'],
    ],
    pattern: {
      at: [
        [0.25, 0.3],
        [0.3, 0.4],
        [0.7, 0.55],
        [0.75, 0.65],
        [0.5, 0.2],
      ],
      m: M.ACC_SH,
    },
    // Two stacked stones (a small cairn).
    emblem: ['.dd.', 'd..d', '.dd.', 'dddd', 'd..d', 'dddd'],
  },
  frost: {
    crest: [
      ['..m..', 'm.m.m', 'mmnmm', '.mmm.'],
      ['..n..', 'm.m.m', 'mmmmm', '.mnm.'],
    ],
    small: [
      ['.m.', 'mmm', 'mnm'],
      ['.n.', 'mmm', 'mmm'],
    ],
    tail: [
      ['m.m', '.m.', 'mmm'],
      ['n.m', '.m.', 'mmm'],
    ],
    pattern: {
      at: [
        [0.25, 0.3],
        [0.7, 0.45],
        [0.4, 0.7],
      ],
      m: M.MOTIF,
    },
    // A six-pointed snow star.
    emblem: ['d.d.d', '.ddd.', 'dd.dd', '.ddd.', 'd.d.d'],
  },
  neutral: {
    crest: [
      ['.a.', 'aaa'],
      ['.a.', 'aaa'],
    ],
    small: [['a'], ['a']],
    tail: [
      ['aa', 'aa'],
      ['aa', 'aa'],
    ],
    pattern: { at: [], m: M.ACC },
  },
};

/** Stamp a motif so its bottom row sits on row `by`, centred on column `cx`. */
function motif(g: PixelGrid, s: Stamp, cx: number, by: number, flip = false): void {
  const w = s[0]?.length ?? 0;
  g.stamp(Math.round(cx - (w - 1) / 2), by - s.length + 1, s, KEY, flip);
}

/**
 * The element's chest emblem, centred on (cx, cy), on front sprites only. It is painted onto body,
 * belly and accent pixels, so the silhouette (piece type, R-ART-002) never changes.
 */
function emblem(g: PixelGrid, p: Pose, cx: number, cy: number): void {
  const s = MOTIFS[p.el].emblem;
  if (!s || !p.front) return;
  const w = s[0]?.length ?? 0;
  const x0 = Math.round(cx - (w - 1) / 2);
  const y0 = Math.round(cy - (s.length - 1) / 2);
  s.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const m = KEY[ch];
      if (m !== undefined) g.paintOnto(x0 + i, y0 + j, m, [M.BASE, M.BELLY, M.ACC]);
    });
  });
}

function pattern(g: PixelGrid, el: ElementId, x: number, y: number, w: number, h: number): void {
  const p = MOTIFS[el].pattern;
  for (const [u, v] of p.at) {
    g.paintOnto(Math.round(x + u * (w - 1)), Math.round(y + v * (h - 1)), p.m, [M.BASE]);
  }
}

// ---------------------------------------------------------------------------------------------
// Faces.
// ---------------------------------------------------------------------------------------------

/** One eye with its top-left at (x, y): open (glint top-left) or closed ('>' / '<'). */
function eye(g: PixelGrid, x: number, y: number, h: 2 | 3, faint: boolean, right: boolean): void {
  if (faint) {
    if (right) {
      g.set(x + 1, y, M.EYE);
      g.set(x, y + 1, M.EYE);
      g.set(x + 1, y + 2, M.EYE);
    } else {
      g.set(x, y, M.EYE);
      g.set(x + 1, y + 1, M.EYE);
      g.set(x, y + 2, M.EYE);
    }
    return;
  }
  g.rect(x, y, 2, h, M.EYE);
  g.set(x, y, M.WHITE);
}

function face(
  g: PixelGrid,
  p: Pose,
  lx: number,
  rx: number,
  y: number,
  h: 2 | 3,
  mouthY: number,
  blush = true,
): void {
  eye(g, lx, y, h, p.faint, false);
  eye(g, rx, y, h, p.faint, true);
  const mid = (lx + rx + 2) / 2;
  if (p.faint) {
    g.rect(Math.floor(mid) - 1, mouthY, 2, 1, M.EYE);
  } else {
    g.set(Math.floor(mid) - 1, mouthY, M.EYE);
    g.set(Math.floor(mid), mouthY, M.EYE);
  }
  if (blush) {
    g.paintOnto(lx - 1, y + h, M.BLUSH, [M.BASE]);
    g.paintOnto(rx + 2, y + h, M.BLUSH, [M.BASE]);
  }
}

// ---------------------------------------------------------------------------------------------
// Bodies (front layout; back sprites hide the face and show backs, tails and capes).
// ---------------------------------------------------------------------------------------------

function pawn(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  // Tail nub behind the body (right side).
  motif(g, mo.tail[p.v], 18, 19, !p.front);
  g.ellipse(12, 16.5, 5.6, 5, M.BASE);
  g.rect(8, 21, 3, 2, M.BASE);
  g.rect(13, 21, 3, 2, M.BASE);
  g.set(6, 17, M.BASE);
  g.set(17, 17, M.BASE);
  if (p.front) {
    g.ellipse(12, 19.2, 3.2, 2.2, M.BELLY);
    face(g, p, 9, 13, 14, 2, 17);
    emblem(g, p, 12, 19.5);
  } else {
    pattern(g, p.el, 8, 13, 8, 7);
  }
  motif(g, mo.small[p.v], 12, 11);
}

function knight(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  // Tail sweeping up behind, with the element tip.
  g.line(18, 13, 20, 9, M.BASE, 2);
  motif(g, mo.tail[p.v], 21, 9);
  // Hind legs pushing off, forelegs tucked: mid-leap.
  g.line(16, 15, 20, 21, M.BASE, 2);
  g.line(14, 16, 15, 21, M.BASE, 2);
  g.ellipse(13.5, 13.5, 6.5, 4, M.BASE, -0.45);
  g.line(9, 15, 6, 18, M.BASE, 2);
  g.line(11, 16, 9, 19, M.BASE, 2);
  // Neck, head and long snout, raised to the upper left.
  g.ellipse(9, 10, 2.8, 4, M.BASE, 0.35);
  g.ellipse(7.5, 8, 3.6, 3, M.BASE);
  g.ellipse(4.6, 9.6, 2.4, 1.8, M.BASE);
  // Ears.
  g.poly(
    [
      [6, 6],
      [7, 1.5],
      [9, 5.5],
    ],
    M.BASE,
  );
  g.poly(
    [
      [9, 5.5],
      [11.5, 2.5],
      [11, 7],
    ],
    M.BASE,
  );
  // Mane along the neck.
  g.line(10, 6, 13, 10, M.ACC, 1);
  g.line(11, 6, 14, 10, M.ACC, 1);
  if (p.front) {
    g.ellipse(12.5, 15.6, 4, 1.3, M.BELLY, -0.45);
    eye(g, 6, 7, 2, p.faint, false);
    g.set(3, 9, M.EYE);
    g.paintOnto(8, 10, M.BLUSH, [M.BASE]);
    emblem(g, p, 15, 13);
  } else {
    g.line(12, 10, 17, 12, M.ACC, 1);
    pattern(g, p.el, 10, 11, 8, 4);
  }
  motif(g, mo.small[p.v], 10, 5);
}

function bishop(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  // Staff with an element orb.
  g.line(18, 7, 18, 22, M.GOLD_SH, 1);
  g.ellipse(18.5, 5.5, 2.1, 2.1, M.MOTIF);
  motif(g, mo.small[p.v], 18, 3);
  // Robe (slender), head, tall pointed hat with a slit.
  g.poly(
    [
      [9, 12],
      [15, 12],
      [16.5, 23],
      [7.5, 23],
    ],
    M.ACC,
  );
  g.ellipse(12, 10.5, 3.4, 3, p.front ? M.BASE : M.ACC);
  g.poly(
    [
      [12, 1],
      [15.8, 8.6],
      [8.2, 8.6],
    ],
    M.ACC,
  );
  g.rect(8, 8, 8, 1, M.GOLD);
  if (p.front) {
    // The hat slit (left empty so the outline draws it).
    g.set(13, 4, M.EMPTY);
    g.set(12, 5, M.EMPTY);
    g.set(11, 6, M.EMPTY);
    face(g, p, 10, 13, 10, 2, 12, false);
    g.rect(11, 13, 2, 10, M.BELLY);
    g.rect(16, 13, 2, 2, M.BASE);
    emblem(g, p, 12, 18);
  } else {
    g.rect(11, 13, 2, 10, M.ACC_SH);
    g.rect(17, 14, 1, 2, M.BASE);
  }
}

function rook(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  g.rect(5, 9, 14, 12, M.BASE);
  g.rect(4, 10, 16, 10, M.BASE);
  // Three merlons: the crenellated top reads as a rook from its outline alone.
  g.rect(5, 5, 4, 4, M.BASE);
  g.rect(10, 5, 4, 4, M.BASE);
  g.rect(15, 5, 4, 4, M.BASE);
  // Stubby arms and thick legs.
  g.rect(2, 13, 2, 4, M.BASE);
  g.rect(20, 13, 2, 4, M.BASE);
  g.rect(6, 21, 4, 2, M.BASE);
  g.rect(14, 21, 4, 2, M.BASE);
  motif(g, mo.small[p.v], 12, 4);
  motif(g, mo.small[p.v === 0 ? 1 : 0], 7, 4);
  motif(g, mo.small[p.v === 0 ? 1 : 0], 17, 4);
  if (p.front) {
    g.rect(8, 16, 8, 4, M.BELLY);
    face(g, p, 8, 14, 11, 3, 15);
    emblem(g, p, 12, 18.5);
  } else {
    // A little arched door on its back.
    g.rect(10, 15, 4, 6, M.ACC_SH);
    g.rect(11, 14, 2, 1, M.ACC_SH);
    pattern(g, p.el, 5, 10, 14, 5);
  }
}

function queen(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  // Flowing hair behind.
  g.poly(
    [
      [7.5, 6],
      [4.5, 16],
      [9, 13],
    ],
    M.ACC,
  );
  g.poly(
    [
      [16.5, 6],
      [19.5, 16],
      [15, 13],
    ],
    M.ACC,
  );
  // Bell-shaped gown: large and regal.
  g.poly(
    [
      [9, 12],
      [15, 12],
      [17.5, 17],
      [21, 23],
      [3, 23],
      [6.5, 17],
    ],
    M.BASE,
  );
  g.ellipse(12, 8.8, 4.3, 3.8, p.front ? M.BASE : M.ACC);
  // Beaded coronet.
  g.rect(8, 5, 8, 1, M.GOLD);
  for (const [x, y] of [
    [8, 3],
    [10, 2],
    [13, 2],
    [15, 3],
  ] as const) {
    g.set(x, y, M.GOLD);
    g.set(x, y + 1, M.GOLD);
  }
  g.rect(11, 1, 2, 2, M.MOTIF);
  g.rect(11, 3, 2, 2, M.GOLD);
  // Hem motif.
  for (const x of [5, 9, 14, 18]) motif(g, mo.small[p.v], x, 22);
  if (p.front) {
    g.poly(
      [
        [12, 13],
        [15.5, 23],
        [8.5, 23],
      ],
      M.BELLY,
    );
    g.rect(10, 12, 4, 1, M.BELLY);
    face(g, p, 9, 13, 8, 2, 11);
    emblem(g, p, 12, 18);
  } else {
    g.rect(10, 12, 4, 2, M.ACC);
    g.set(9, 14, M.ACC);
    g.set(14, 14, M.ACC);
    pattern(g, p.el, 7, 14, 10, 7);
  }
}

function king(g: PixelGrid, p: Pose): void {
  const mo = MOTIFS[p.el];
  // Cape behind a round body.
  g.poly(
    [
      [6, 11],
      [18, 11],
      [19.5, 22],
      [4.5, 22],
    ],
    M.ACC,
  );
  g.ellipse(12, 15.2, 7.6, 6.8, p.front ? M.BASE : M.ACC);
  g.rect(7, 21, 3, 2, M.BASE);
  g.rect(14, 21, 3, 2, M.BASE);
  // A big crown with three points and a cross on top: the king is always crowned.
  g.rect(7, 6, 10, 3, M.GOLD);
  g.poly(
    [
      [7, 6.5],
      [7, 3],
      [9.5, 6.5],
    ],
    M.GOLD,
  );
  g.poly(
    [
      [14.5, 6.5],
      [17, 3],
      [17, 6.5],
    ],
    M.GOLD,
  );
  g.poly(
    [
      [9.5, 6.5],
      [12, 3],
      [14.5, 6.5],
    ],
    M.GOLD,
  );
  g.rect(11, 1, 2, 3, M.GOLD);
  g.rect(10, 2, 4, 1, M.GOLD);
  g.rect(11, 7, 2, 1, M.MOTIF);
  if (p.front) {
    g.ellipse(12, 17.6, 4.4, 3.4, M.BELLY);
    face(g, p, 8, 14, 11, 3, 15);
    emblem(g, p, 12, 18.5);
    motif(g, mo.tail[p.v], 20, 20);
  } else {
    g.rect(8, 9, 8, 1, M.BELLY);
    g.line(12, 10, 12, 21, M.ACC_SH, 1);
    motif(g, mo.tail[p.v], 20, 20, true);
  }
}

const BODIES: Record<PieceType, (g: PixelGrid, p: Pose) => void> = {
  pawn,
  knight,
  bishop,
  rook,
  queen,
  king,
};

/** Lowest row that bobs in the idle; rows below it (feet) stay planted. */
const BOB_BOTTOM: Record<PieceType, number> = {
  pawn: 20,
  knight: 17,
  bishop: 20,
  rook: 20,
  queen: 20,
  king: 20,
};

function dizzy(g: PixelGrid, top: number): void {
  // Two small twinkles above the slumped head.
  const y = Math.max(1, top - 3);
  for (const x of [7, 16]) {
    g.set(x, y, M.MOTIF2);
    g.set(x - 1, y, M.WHITE);
    g.set(x + 1, y, M.WHITE);
    g.set(x, y - 1, M.WHITE);
    g.set(x, y + 1, M.WHITE);
  }
}

function topRow(g: PixelGrid): number {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.get(x, y) !== M.EMPTY) return y;
  return 0;
}

const grids = new Map<string, PixelGrid>();

/**
 * The creature's material grid (24x24, outline and shading applied). Pure and cached: usable in
 * Node (tests, exporters) as well as in the browser.
 */
export function creatureGrid(
  type: PieceType,
  element: ElementId,
  facing: CreatureFacing,
  frame: CreatureFrame,
): PixelGrid {
  const key = `${type}:${element}:${facing}:${frame}`;
  const hit = grids.get(key);
  if (hit) return hit;
  const g = new PixelGrid(SPRITE, SPRITE);
  const pose: Pose = {
    el: element,
    front: facing === 'front',
    v: frame === 'idle1' ? 1 : 0,
    faint: frame === 'faint',
  };
  BODIES[type](g, pose);
  // The knight turns away on its back sprite; symmetric bodies keep their layout.
  if (facing === 'back' && type === 'knight') g.mirrorX();
  if (frame === 'idle1') g.shiftRows(0, BOB_BOTTOM[type], 1);
  if (frame === 'faint') {
    g.shiftRows(0, 20, 2);
    dizzy(g, topRow(g));
  }
  g.shade();
  g.outline();
  grids.set(key, g);
  return g;
}

/**
 * Draw one creature frame onto any 2D context (Phaser canvas textures, the Scenario Lab, a sprite
 * sheet exporter). `scale` is an integer nearest-neighbour factor; (x, y) is the top-left corner.
 */
export function drawCreature(
  ctx: Ctx2D,
  type: PieceType,
  element: ElementId,
  facing: CreatureFacing,
  frame: CreatureFrame,
  scale = 1,
  x = 0,
  y = 0,
): void {
  blit(
    ctx,
    creatureGrid(type, element, facing, frame),
    creaturePalette(element, frame === 'faint'),
    scale,
    x,
    y,
  );
}

/** Frame order inside a creature sheet: front idle0, idle1, faint, then back idle0, idle1, faint. */
export const SHEET_FRAMES: readonly { facing: CreatureFacing; frame: CreatureFrame }[] = (
  ['front', 'back'] as const
).flatMap((facing) => CREATURE_FRAMES.map((frame) => ({ facing, frame })));

/** Draw a whole 6-frame sheet (144x24 at scale 1) for one type and element. */
export function drawCreatureSheet(
  ctx: Ctx2D,
  type: PieceType,
  element: ElementId,
  scale = 1,
): void {
  SHEET_FRAMES.forEach((f, i) =>
    drawCreature(ctx, type, element, f.facing, f.frame, scale, i * SPRITE * scale, 0),
  );
}

/** RGBA pixels of a whole sheet (144x24): the fast path used for board textures. */
export function creatureSheetPixels(
  type: PieceType,
  element: ElementId,
): Uint8ClampedArray<ArrayBuffer> {
  const w = SPRITE * SHEET_FRAMES.length;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * SPRITE * 4));
  SHEET_FRAMES.forEach((f, i) => {
    const grid = creatureGrid(type, element, f.facing, f.frame);
    writeRgba(data, w, grid, creaturePalette(element, f.frame === 'faint'), i * SPRITE, 0);
  });
  return data;
}
