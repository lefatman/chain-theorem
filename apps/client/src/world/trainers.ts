/**
 * Procedural overworld trainers (M5, spec 10.1 and 11.1, R-ART-001, R-ART-003): original chibi
 * characters for players and NPCs, 16x20 pixels, four directions with a 2-frame walk. The four
 * directions have distinct outlines (front: hands at the sides; back: a satchel covering the arms;
 * sides: a profile with the satchel behind), so facing reads without colour. Looks vary by head style
 * (knit cap, spiky hair, tail, headband), hair, skin and clothes; NPCs wear their element's colour.
 *
 * Also the small world marks: the battling marker (a speech bubble holding a chessboard), the
 * selection brackets, a ground shadow and the challenge-zone hatch. Pure: no DOM, no Phaser.
 */
import type { ElementId } from '@chain-theorem/rules';
import type { Dir } from '@chain-theorem/protocol';
import { elementTone } from '../battle/scene/palette.ts';
import { gba, mix, PixelGrid, type Palette } from '../battle/scene/pixel.ts';

export const TRAINER_W = 16;
export const TRAINER_H = 20;

/** Frame order in a trainer sheet: direction x (stand, stride). */
export const TRAINER_FRAMES: readonly { dir: Dir; frame: 0 | 1 }[] = [
  { dir: 's', frame: 0 },
  { dir: 's', frame: 1 },
  { dir: 'n', frame: 0 },
  { dir: 'n', frame: 1 },
  { dir: 'e', frame: 0 },
  { dir: 'e', frame: 1 },
  { dir: 'w', frame: 0 },
  { dir: 'w', frame: 1 },
];

export function trainerFrameIndex(dir: Dir, frame: 0 | 1): number {
  return TRAINER_FRAMES.findIndex((f) => f.dir === dir && f.frame === frame);
}

/** Materials (palette indices). */
const T = {
  EMPTY: 0,
  OUT: 1,
  SKIN: 2,
  SKIN_SH: 3,
  HAIR: 4,
  HAIR_SH: 5,
  TOP: 6,
  TOP_SH: 7,
  TOP_LT: 8,
  PANTS: 9,
  SHOE: 10,
  EYE: 11,
  WHITE: 12,
  HAT: 13,
  HAT_SH: 14,
  BAG: 15,
} as const;

export type HeadStyle = 0 | 1 | 2 | 3;
export const HEAD_STYLES = ['knit cap', 'spiky hair', 'tail', 'headband'] as const;

export interface TrainerLook {
  /** 0 knit cap, 1 spiky hair, 2 tail, 3 headband. */
  style: HeadStyle;
  hair: number;
  skin: number;
  top: number;
  hat: number;
}

const HAIRS: readonly number[] = [0x5a3820, 0x283050, 0xb85830, 0xe8c060];
const SKINS: readonly number[] = [0xf8d0a8, 0xe0a878, 0xa87048];
const TOPS: readonly number[] = [
  0x38a8a0, 0xe07040, 0x5870d0, 0x70b040, 0xc05890, 0xe0b030, 0x8060c0, 0x40a0e0,
];
const HATS: readonly number[] = [
  0xf0e0c0, 0xd84848, 0x3060a8, 0xf0c030, 0x48a058, 0xe8e8f0, 0x904890, 0xf08830,
];

/** FNV-1a of a string (stable per player id). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A player's look, stable across sessions (derived from the player id). */
export function playerLook(id: string): TrainerLook {
  const h = hashString(id);
  return {
    style: (h & 3) as HeadStyle,
    hair: (h >>> 2) & 3,
    skin: (h >>> 4) % 3,
    top: TOPS[(h >>> 6) & 7] ?? 0x38a8a0,
    hat: HATS[(h >>> 9) & 7] ?? 0xf0e0c0,
  };
}

/** An NPC's look from its content data (`look.variant` 0..15, element colours). */
export function npcLook(look: { variant: number; element: ElementId | 'neutral' }): TrainerLook {
  const v = Math.abs(Math.trunc(look.variant)) & 15;
  const tone = elementTone(look.element);
  return {
    style: (v & 3) as HeadStyle,
    hair: (v >>> 2) & 3,
    skin: v % 3,
    top: tone.base,
    hat: tone.motif,
  };
}

/** A fallback NPC look when the content has no entry for it. */
export function unknownNpcLook(id: string): TrainerLook {
  return npcLook({ variant: hashString(id) & 15, element: 'neutral' });
}

export function lookKey(l: TrainerLook): string {
  return `${l.style}-${l.hair}-${l.skin}-${l.top.toString(16)}-${l.hat.toString(16)}`;
}

export function trainerPalette(l: TrainerLook): Palette {
  const skin = SKINS[l.skin % SKINS.length] ?? 0xf8d0a8;
  const hair = HAIRS[l.hair % HAIRS.length] ?? 0x5a3820;
  const p = new Array<number>(16).fill(0);
  p[T.OUT] = 0x202028;
  p[T.SKIN] = skin;
  p[T.SKIN_SH] = mix(skin, 0x803020, 0.25);
  p[T.HAIR] = hair;
  p[T.HAIR_SH] = mix(hair, 0x101018, 0.4);
  p[T.TOP] = l.top;
  p[T.TOP_SH] = mix(l.top, 0x101028, 0.35);
  p[T.TOP_LT] = mix(l.top, 0xffffff, 0.35);
  p[T.PANTS] = 0x404868;
  p[T.SHOE] = 0x302828;
  p[T.EYE] = 0x201828;
  p[T.WHITE] = 0xf8f8f8;
  p[T.HAT] = l.hat;
  p[T.HAT_SH] = mix(l.hat, 0x101018, 0.3);
  p[T.BAG] = 0xb07838;
  return p.map((c, i) => (i === 0 ? 0 : gba(c)));
}

// ---- drawing -------------------------------------------------------------------------------------

type Rows = readonly (readonly [number, number, number])[];

/** Head outline rows [y, x0, x1] for the front/back view and for the east-facing profile. */
const HEAD_FRONT: Rows = [
  [2, 5, 10],
  [3, 4, 11],
  [4, 3, 12],
  [5, 3, 12],
  [6, 3, 12],
  [7, 3, 12],
  [8, 3, 12],
  [9, 4, 11],
  [10, 5, 10],
];
const HEAD_SIDE: Rows = [
  [2, 6, 10],
  [3, 5, 11],
  [4, 4, 12],
  [5, 4, 12],
  [6, 4, 12],
  [7, 4, 12],
  [8, 4, 12],
  [9, 5, 11],
  [10, 6, 10],
];

function rows(g: PixelGrid, r: Rows, m: number, pred?: (x: number, y: number) => boolean): void {
  for (const [y, x0, x1] of r)
    for (let x = x0; x <= x1; x++) if (!pred || pred(x, y)) g.set(x, y, m);
}

/** Set single pixels: pts are [x, y] pairs. */
function dots(g: PixelGrid, m: number, ...pts: (readonly [number, number])[]): void {
  for (const [x, y] of pts) g.set(x, y, m);
}

function headStyle(g: PixelGrid, style: HeadStyle, view: 'front' | 'back' | 'side'): void {
  const head = view === 'side' ? HEAD_SIDE : HEAD_FRONT;
  switch (style) {
    case 0: // knit cap with a pom
      rows(g, head, T.HAT, (_x, y) => y <= 4);
      rows(g, head, T.HAT_SH, (_x, y) => y === 4);
      dots(g, T.HAT, [7, 1], [8, 1]);
      break;
    case 1: // spiky hair
      if (view === 'side') dots(g, T.HAIR, [6, 1], [8, 1], [10, 1]);
      else dots(g, T.HAIR, [5, 1], [8, 1], [10, 1]);
      break;
    case 2: // a tail at the back
      if (view === 'back') g.rect(7, 10, 2, 3, T.HAIR).set(7, 12, T.HAIR_SH);
      if (view === 'side') g.rect(2, 5, 2, 4, T.HAIR).set(2, 8, T.HAIR_SH);
      break;
    case 3: // headband
      rows(g, head, T.HAT, (_x, y) => y === 4);
      dots(g, T.HAIR, [7, 1], [8, 1]);
      break;
  }
}

function legs(g: PixelGrid, view: 'front' | 'back' | 'side', frame: 0 | 1): void {
  if (view === 'side') {
    if (frame === 0) {
      g.rect(6, 16, 4, 2, T.PANTS).rect(6, 18, 5, 1, T.SHOE);
    } else {
      g.rect(5, 16, 2, 2, T.PANTS).rect(4, 18, 3, 1, T.SHOE);
      g.rect(9, 16, 2, 2, T.PANTS).rect(9, 18, 3, 1, T.SHOE);
    }
    return;
  }
  // Front and back: the stride lifts one leg (left seen from the front, right from behind).
  const lifted = frame === 1 ? (view === 'front' ? 5 : 9) : -1;
  for (const x of [5, 9]) {
    if (x === lifted) g.rect(x, 16, 2, 1, T.PANTS).rect(x, 17, 2, 1, T.SHOE);
    else g.rect(x, 16, 2, 2, T.PANTS).rect(x, 18, 2, 1, T.SHOE);
  }
}

function front(g: PixelGrid, style: HeadStyle, frame: 0 | 1): void {
  rows(g, HEAD_FRONT, T.SKIN);
  rows(g, HEAD_FRONT, T.HAIR, (x, y) => y <= 4 || ((y === 5 || y === 6) && (x <= 4 || x >= 11)));
  dots(g, T.HAIR, [9, 5], [10, 5], [5, 5]);
  g.rect(5, 6, 1, 2, T.EYE).rect(10, 6, 1, 2, T.EYE);
  dots(g, T.SKIN_SH, [4, 8], [11, 8]);
  g.rect(6, 10, 4, 1, T.SKIN_SH);
  // Body, scarf and arms with hands at the sides.
  g.rect(4, 11, 8, 5, T.TOP).rect(4, 11, 1, 4, T.TOP_LT).rect(11, 11, 1, 5, T.TOP_SH);
  g.rect(4, 15, 8, 1, T.TOP_SH).rect(7, 12, 2, 3, T.TOP_SH);
  g.rect(5, 11, 6, 1, T.HAT);
  g.rect(3, 11, 1, 4, T.TOP).rect(12, 11, 1, 4, T.TOP_SH);
  g.set(3, 15, T.SKIN);
  g.set(12, 15, T.SKIN_SH);
  legs(g, 'front', frame);
  headStyle(g, style, 'front');
}

function back(g: PixelGrid, style: HeadStyle, frame: 0 | 1): void {
  rows(g, HEAD_FRONT, T.HAIR);
  rows(g, HEAD_FRONT, T.HAIR_SH, (x, y) => y >= 9 || x === 12);
  g.rect(6, 10, 4, 1, T.SKIN_SH);
  // Body with a satchel that covers the arms (no hands from behind).
  g.rect(4, 11, 8, 5, T.TOP).rect(4, 15, 8, 1, T.TOP_SH);
  g.rect(3, 11, 10, 4, T.BAG).rect(3, 11, 10, 1, T.TOP_SH).rect(12, 12, 1, 3, T.HAIR_SH);
  g.rect(6, 12, 4, 1, T.HAT);
  legs(g, 'back', frame);
  headStyle(g, style, 'back');
}

/** The east-facing profile (west is its mirror image). */
function side(g: PixelGrid, style: HeadStyle, frame: 0 | 1): void {
  rows(g, HEAD_SIDE, T.SKIN);
  rows(g, HEAD_SIDE, T.HAIR, (x, y) => y <= 4 || x <= 8);
  rows(g, HEAD_SIDE, T.HAIR_SH, (x, y) => y >= 8 && x <= 7);
  dots(g, T.SKIN, [8, 7], [13, 7]);
  g.set(12, 8, T.SKIN_SH);
  g.rect(11, 6, 1, 2, T.EYE);
  // Body, scarf, the near arm and the satchel behind.
  g.rect(5, 11, 6, 5, T.TOP).rect(10, 11, 1, 5, T.TOP_SH).rect(5, 15, 6, 1, T.TOP_SH);
  g.rect(6, 11, 5, 1, T.HAT);
  g.rect(7, 12, 2, 3, T.TOP_SH).set(8, 15, T.SKIN);
  g.rect(3, 11, 2, 4, T.BAG).set(3, 14, T.HAIR_SH);
  legs(g, 'side', frame);
  headStyle(g, style, 'side');
}

/** One frame (material grid) of a trainer. */
export function trainerGrid(style: HeadStyle, dir: Dir, frame: 0 | 1): PixelGrid {
  const g = new PixelGrid(TRAINER_W, TRAINER_H);
  if (dir === 's') front(g, style, frame);
  else if (dir === 'n') back(g, style, frame);
  else side(g, style, frame);
  g.outline(T.OUT);
  if (dir === 'w') g.mirrorX();
  return g;
}

/** RGBA pixels of a whole trainer sheet (8 frames in one row, TRAINER_FRAMES order). */
export function trainerSheet(look: TrainerLook): Uint8ClampedArray<ArrayBuffer> {
  const w = TRAINER_W * TRAINER_FRAMES.length;
  const out = new Uint8ClampedArray(w * TRAINER_H * 4);
  const pal = trainerPalette(look);
  TRAINER_FRAMES.forEach((f, i) => {
    const g = trainerGrid(look.style, f.dir, f.frame);
    for (let y = 0; y < TRAINER_H; y++)
      for (let x = 0; x < TRAINER_W; x++) {
        const m = g.get(x, y);
        if (m === 0) continue;
        const c = pal[m] ?? 0;
        const k = (y * w + i * TRAINER_W + x) * 4;
        out[k] = (c >> 16) & 255;
        out[k + 1] = (c >> 8) & 255;
        out[k + 2] = c & 255;
        out[k + 3] = 255;
      }
  });
  return out;
}

// ---- marks ---------------------------------------------------------------------------------------

export interface Mark {
  grid: PixelGrid;
  palette: Palette;
}

const MARK_PALETTE: Palette = [
  0,
  gba(0x202028),
  gba(0xf8f8f8),
  gba(0x283048),
  gba(0xf0c030),
  gba(0xd84848),
  gba(0x000000),
  ...new Array<number>(9).fill(0),
];

function markFrom(rows: readonly string[]): PixelGrid {
  const w = Math.max(...rows.map((r) => r.length));
  const g = new PixelGrid(w, rows.length);
  g.stamp(0, 0, rows, { o: 1, w: 2, k: 3, y: 4, r: 5, s: 6 });
  return g;
}

/** "Battling" (10.1): a speech bubble holding a little chessboard, above a player's head. */
export function battleMark(): Mark {
  return {
    grid: markFrom([
      '.ooooooooo.',
      'owwwwwwwwwo',
      'owkkwwkkwwo',
      'owkkwwkkwwo',
      'owwwkkwwkko',
      'owwwkkwwkko',
      'owwwwwwwwwo',
      '.oooowoooo.',
      '....owo....',
      '.....o.....',
    ]),
    palette: MARK_PALETTE,
  };
}

/** Selection brackets drawn around the selected player's feet. */
export function selectMark(): Mark {
  return {
    grid: markFrom([
      'yyy..........yyy',
      'y..............y',
      '................',
      '................',
      'y..............y',
      'yyy..........yyy',
    ]),
    palette: MARK_PALETTE,
  };
}

/** A soft ground shadow (drawn at partial alpha). */
export function shadowMark(): Mark {
  const g = new PixelGrid(12, 4);
  g.ellipse(6, 2, 6, 2, 6);
  return { grid: g, palette: MARK_PALETTE };
}

/** The challenge-zone hatch (10.4): diagonal stripes, a pattern partner for its colour. */
export function hatchMark(): Mark {
  const g = new PixelGrid(8, 8);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) if ((x + y) % 8 === 0 || (x + y) % 8 === 1) g.set(x, y, 5);
  return { grid: g, palette: MARK_PALETTE };
}
