/**
 * Procedural overworld trainers (M5, spec 10.1 and 11.1, R-ART-001, R-ART-003): original chibi
 * characters for players and NPCs in handheld-era proportions (a large head with big highlighted
 * eyes, a short body), 17x26 pixels, four directions with a 3-frame walk (stand, left step, right
 * step, played stand-left-stand-right). The four directions have distinct outlines (front: hands
 * at the sides; back: a satchel across the shoulders; sides: a profile with the satchel behind), so
 * facing reads without colour. Looks vary by head style (knit cap, spiky hair, ponytail, headband),
 * hair, skin and clothes; NPCs wear their element's colour.
 *
 * Also the small world marks: the battling marker (a speech bubble holding a chessboard), the
 * selection brackets, a ground shadow and the challenge-zone hatch. Pure: no DOM, no Phaser.
 */
import type { ElementId } from '@chain-theorem/rules';
import type { Dir } from '@chain-theorem/protocol';
import { elementTone } from '../battle/scene/palette.ts';
import { gba, mix, PixelGrid, type Palette } from '../battle/scene/pixel.ts';

export const TRAINER_W = 17;
export const TRAINER_H = 26;

/** Walk frames: standing, the left foot forward, the right foot forward. */
export type WalkFrame = 0 | 1 | 2;
export const WALK_FRAMES: readonly WalkFrame[] = [0, 1, 2];

/** Frame order in a trainer sheet: direction x (stand, left step, right step). */
export const TRAINER_FRAMES: readonly { dir: Dir; frame: WalkFrame }[] = (
  ['s', 'n', 'e', 'w'] as const
).flatMap((dir) => WALK_FRAMES.map((frame) => ({ dir, frame })));

export function trainerFrameIndex(dir: Dir, frame: WalkFrame): number {
  return TRAINER_FRAMES.findIndex((f) => f.dir === dir && f.frame === frame);
}

/**
 * The walk frame to show `t` of the way through a step (0..1): a stride on the first part of
 * each step, alternating feet by step parity, then the standing pose.
 */
export function walkFrame(t: number, steps: number): WalkFrame {
  if (!(t >= 0 && t < 0.6)) return 0;
  return steps % 2 === 0 ? 1 : 2;
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
export const HEAD_STYLES = ['knit cap', 'spiky hair', 'ponytail', 'headband'] as const;

export interface TrainerLook {
  /** 0 knit cap, 1 spiky hair, 2 ponytail, 3 headband. */
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

type View = 'front' | 'back' | 'side';

/** The figure's axis is column 8 (pixel centre 8.5); the head spans columns 2..14. */
const CX = 8.5;
/** Rows of the shoulders, the hands, the hips and the shoe soles. */
const SHOULDER = 15;
const HAND = 21;
const HIP = 21;
const SOLE = 25;

/** Set single pixels: pts are [x, y] pairs. */
function dots(g: PixelGrid, m: number, ...pts: (readonly [number, number])[]): void {
  for (const [x, y] of pts) g.set(x, y, m);
}

/** Paint `m` onto every pixel of the head area (rows top..bottom) that already holds skin or hair. */
function capRows(g: PixelGrid, top: number, bottom: number, m: number): void {
  for (let y = top; y <= bottom; y++)
    for (let x = 0; x < g.w; x++) g.paintOnto(x, y, m, [T.SKIN, T.SKIN_SH, T.HAIR, T.HAIR_SH]);
}

/** A round head: hair over the top, skin from the brow down (none for the back view). */
function head(g: PixelGrid, view: View): void {
  const rx = view === 'side' ? 6 : 6.5;
  g.ellipse(CX, 9, rx, 5.6, view === 'back' ? T.HAIR : T.SKIN);
  if (view === 'back') {
    // The hair darkens toward the nape.
    for (let y = 12; y <= 14; y++)
      for (let x = 0; x < g.w; x++) g.paintOnto(x, y, T.HAIR_SH, [T.HAIR]);
    return;
  }
  // Hair covers the top of the head and frames the face.
  capRows(g, 3, 6, T.HAIR);
  if (view === 'side') {
    for (let y = 7; y <= 12; y++) for (let x = 2; x <= 7; x++) g.paintOnto(x, y, T.HAIR, [T.SKIN]);
    for (let y = 11; y <= 13; y++)
      for (let x = 2; x <= 6; x++) g.paintOnto(x, y, T.HAIR_SH, [T.HAIR]);
  } else {
    for (let y = 7; y <= 10; y++) {
      g.paintOnto(2, y, T.HAIR, [T.SKIN]);
      g.paintOnto(3, y, T.HAIR, [T.SKIN]);
      g.paintOnto(13, y, T.HAIR, [T.SKIN]);
      g.paintOnto(14, y, T.HAIR, [T.SKIN]);
    }
  }
  // A jaw shade.
  for (let x = 0; x < g.w; x++) g.paintOnto(x, 14, T.SKIN_SH, [T.SKIN]);
}

/** Big eyes with a highlight, and a small mouth. */
function face(g: PixelGrid, view: View): void {
  if (view === 'front') {
    g.rect(5, 8, 2, 3, T.EYE).rect(10, 8, 2, 3, T.EYE);
    dots(g, T.WHITE, [5, 8], [10, 8]);
    g.set(8, 12, T.SKIN_SH);
  } else {
    g.rect(11, 8, 2, 3, T.EYE);
    g.set(11, 8, T.WHITE);
    g.set(14, 10, T.SKIN);
    g.set(13, 12, T.SKIN_SH);
  }
}

function headStyle(g: PixelGrid, style: HeadStyle, view: View): void {
  switch (style) {
    case 0: // knit cap with a pom
      capRows(g, 3, 6, T.HAT);
      capRows(g, 6, 6, T.HAT_SH);
      g.rect(7, 1, 3, 2, T.HAT);
      break;
    case 1: // spiky hair
      if (view === 'side') dots(g, T.HAIR, [4, 2], [7, 1], [10, 1], [12, 2], [6, 1], [11, 1]);
      else dots(g, T.HAIR, [3, 2], [6, 1], [8, 1], [10, 1], [13, 2], [7, 2], [9, 2]);
      break;
    case 2: // a ponytail at the back
      if (view === 'back') g.rect(7, 13, 3, 7, T.HAIR).rect(7, 18, 3, 2, T.HAIR_SH);
      if (view === 'side') g.rect(1, 8, 2, 7, T.HAIR).rect(1, 13, 2, 2, T.HAIR_SH);
      g.rect(7, 2, 3, 1, T.HAIR);
      break;
    case 3: // headband
      capRows(g, 6, 6, T.HAT);
      dots(g, T.HAIR, [7, 2], [8, 2], [9, 2]);
      break;
  }
}

/** Legs and shoes under the hips; a stepping foot lifts by one row. */
function legs(g: PixelGrid, view: View, frame: WalkFrame): void {
  if (view === 'side') {
    if (frame === 0) {
      g.rect(6, HIP, 5, 3, T.PANTS).rect(6, SOLE - 1, 6, 2, T.SHOE);
      return;
    }
    // One foot forward and one behind; the rear foot lifts on the left step, the front foot on
    // the right step.
    if (frame === 1) {
      g.rect(9, HIP, 3, 3, T.PANTS).rect(9, SOLE - 1, 4, 2, T.SHOE);
      g.rect(5, HIP, 3, 2, T.PANTS).rect(4, SOLE - 2, 4, 2, T.SHOE);
    } else {
      g.rect(5, HIP, 3, 3, T.PANTS).rect(4, SOLE - 1, 4, 2, T.SHOE);
      g.rect(9, HIP, 3, 2, T.PANTS).rect(10, SOLE - 2, 4, 2, T.SHOE);
    }
    return;
  }
  // Front and back: the stepping leg (left seen from the front, right from behind) lifts.
  const lifted = frame === 0 ? -1 : (frame === 1) === (view === 'front') ? 5 : 9;
  for (const x of [5, 9]) {
    if (x === lifted) g.rect(x, HIP, 3, 2, T.PANTS).rect(x - 1, SOLE - 2, 4, 2, T.SHOE);
    else g.rect(x, HIP, 3, 3, T.PANTS).rect(x - 1, SOLE - 1, 4, 2, T.SHOE);
  }
}

/** Torso, collar and arms; arms swing with the stride. */
function body(g: PixelGrid, view: View, frame: WalkFrame): void {
  if (view === 'side') {
    g.rect(5, SHOULDER, 7, 6, T.TOP).rect(11, SHOULDER, 1, 6, T.TOP_SH);
    g.rect(5, HAND - 1, 7, 1, T.TOP_SH);
    g.rect(6, SHOULDER, 5, 1, T.HAT);
    // The satchel behind, then the near arm swinging forward or back.
    g.rect(3, SHOULDER + 1, 2, 4, T.BAG).set(3, SHOULDER + 4, T.HAIR_SH);
    const swing = frame === 0 ? 0 : frame === 1 ? 2 : -2;
    g.rect(7 + swing, SHOULDER + 1, 2, 4, T.TOP_SH).rect(7 + swing, HAND - 1, 2, 1, T.SKIN);
    return;
  }
  g.rect(4, SHOULDER, 9, 6, T.TOP).rect(3, SHOULDER, 11, 2, T.TOP);
  g.rect(4, SHOULDER + 1, 1, 4, T.TOP_LT).rect(12, SHOULDER + 1, 1, 5, T.TOP_SH);
  g.rect(4, HAND - 1, 9, 1, T.TOP_SH);
  if (view === 'front') {
    g.rect(5, SHOULDER, 7, 1, T.HAT);
    g.rect(7, SHOULDER + 1, 3, 3, T.TOP_SH);
  } else {
    // A satchel slung across the back, wider than the shoulders.
    g.rect(1, SHOULDER + 1, 15, 3, T.BAG).rect(2, SHOULDER + 1, 13, 1, T.TOP_SH);
    g.set(14, SHOULDER + 2, T.HAIR_SH);
  }
  // Arms: the arm on the stepping side swings back (shorter), the other forward (longer).
  const left = frame === 0 ? 0 : (frame === 1) === (view === 'front') ? -1 : 1;
  g.rect(2, SHOULDER + 1, 2, 4 + left, T.TOP).rect(2, HAND + left, 2, 1, T.SKIN);
  g.rect(13, SHOULDER + 1, 2, 4 - left, T.TOP_SH).rect(13, HAND - left, 2, 1, T.SKIN_SH);
}

function front(g: PixelGrid, style: HeadStyle, frame: WalkFrame): void {
  legs(g, 'front', frame);
  body(g, 'front', frame);
  head(g, 'front');
  face(g, 'front');
  headStyle(g, style, 'front');
}

function back(g: PixelGrid, style: HeadStyle, frame: WalkFrame): void {
  legs(g, 'back', frame);
  body(g, 'back', frame);
  head(g, 'back');
  headStyle(g, style, 'back');
}

/** The east-facing profile (west is its mirror image). */
function side(g: PixelGrid, style: HeadStyle, frame: WalkFrame): void {
  legs(g, 'side', frame);
  body(g, 'side', frame);
  head(g, 'side');
  face(g, 'side');
  headStyle(g, style, 'side');
}

/** One frame (material grid) of a trainer. */
export function trainerGrid(style: HeadStyle, dir: Dir, frame: WalkFrame): PixelGrid {
  const g = new PixelGrid(TRAINER_W, TRAINER_H);
  if (dir === 's') front(g, style, frame);
  else if (dir === 'n') back(g, style, frame);
  else side(g, style, frame);
  g.outline(T.OUT);
  if (dir === 'w') g.mirrorX();
  return g;
}

/** RGBA pixels of a whole trainer sheet (12 frames in one row, TRAINER_FRAMES order). */
export function trainerSheet(look: TrainerLook): Uint8ClampedArray<ArrayBuffer> {
  const w = TRAINER_W * TRAINER_FRAMES.length;
  const out = new Uint8ClampedArray(new ArrayBuffer(w * TRAINER_H * 4));
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
