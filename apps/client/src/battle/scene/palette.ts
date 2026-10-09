/**
 * Limited handheld-era palettes (R-ART-001): every sprite uses one 16-entry palette (15 colours
 * plus transparency) snapped to 15-bit colour.
 *
 * - Army units (sprites.ts) take `armyPalette(side, element)`: the armour is the owner's colour
 *   (white steel for White, black iron for Black) and the accents (plumes, cloaks, sashes, trim and
 *   the emblem) are the element's colour. Piece type and army style never change the palette.
 * - Element icons and rings take `elementPalette(element)`, the element's full tone set.
 */
import type { ElementId, Side } from '@chain-theorem/rules';
import { faded, gba, M, type Palette } from './pixel.ts';

interface ElementTones {
  out: number;
  shade: number;
  base: number;
  light: number;
  accSh: number;
  acc: number;
  accLt: number;
  belly: number;
  motif: number;
  motif2: number;
}

const TONES: Record<ElementId, ElementTones> = {
  ember: {
    out: 0x481818,
    shade: 0xc04828,
    base: 0xf07838,
    light: 0xf8b068,
    accSh: 0xa01818,
    acc: 0xe03828,
    accLt: 0xf87048,
    belly: 0xf8e0a8,
    motif: 0xf8c830,
    motif2: 0xf8f8a0,
  },
  tide: {
    out: 0x102050,
    shade: 0x2868b8,
    base: 0x4898e8,
    light: 0x90d0f8,
    accSh: 0x187890,
    acc: 0x28b0c8,
    accLt: 0x78e0e8,
    belly: 0xd0f0f8,
    motif: 0xf0fcff,
    motif2: 0x88e8f8,
  },
  grove: {
    out: 0x103018,
    shade: 0x388838,
    base: 0x60b850,
    light: 0xa0e070,
    accSh: 0x286020,
    acc: 0x409830,
    accLt: 0x78c850,
    belly: 0xe8f0b8,
    motif: 0xb8f070,
    motif2: 0xf8a0c8,
  },
  storm: {
    out: 0x201048,
    shade: 0x5840a8,
    base: 0x8868d8,
    light: 0xc0a8f8,
    accSh: 0x302078,
    acc: 0x4838a8,
    accLt: 0x7060d0,
    belly: 0xe0d8f8,
    motif: 0xf8e038,
    motif2: 0xfff8c8,
  },
  stone: {
    out: 0x282018,
    shade: 0x706050,
    base: 0xa09078,
    light: 0xd0c0a0,
    accSh: 0x504838,
    acc: 0x807058,
    accLt: 0xa89880,
    belly: 0xe0d8c0,
    motif: 0x88b060,
    motif2: 0xf0e8d8,
  },
  frost: {
    out: 0x183850,
    shade: 0x70a8d0,
    base: 0xa8e0f0,
    light: 0xe8fcff,
    accSh: 0x3878b8,
    acc: 0x5898d8,
    accLt: 0x90c8f0,
    belly: 0xf4fcff,
    motif: 0xffffff,
    motif2: 0xb8f0ff,
  },
  neutral: {
    out: 0x282830,
    shade: 0x888890,
    base: 0xb0b0b8,
    light: 0xe0e0e8,
    accSh: 0x606068,
    acc: 0x808088,
    accLt: 0xa8a8b0,
    belly: 0xe8e8e8,
    motif: 0xd0d0d8,
    motif2: 0xf8f8f8,
  },
};

const SHARED = {
  eye: 0x201828,
  white: 0xf8f8f8,
  blush: 0xf08898,
  gold: 0xf8c830,
  goldSh: 0xb87818,
};

/** Headline colour per element (ring rim, VFX tint, UI accents). */
export const ELEMENT_COLORS: Record<ElementId, number> = Object.fromEntries(
  (Object.keys(TONES) as ElementId[]).map((e) => [e, gba(TONES[e].base)]),
) as Record<ElementId, number>;

/** Readable names for the element icon shapes (accessibility text and tests). */
export const ELEMENT_ICON_SHAPE: Record<ElementId, string> = {
  ember: 'flame',
  tide: 'wave',
  grove: 'leaf',
  storm: 'lightning bolt',
  stone: 'faceted rock',
  frost: 'snowflake',
  neutral: 'hollow circle',
};

const cache = new Map<string, Palette>();

/** The 16-entry element palette (icons, rings, VFX), optionally the desaturated faint version. */
export function elementPalette(element: ElementId, faint = false): Palette {
  const key = `${element}:${faint ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = TONES[element];
  const p: number[] = new Array<number>(16).fill(0);
  p[M.OUT] = t.out;
  p[M.SHADE] = t.shade;
  p[M.BASE] = t.base;
  p[M.LIGHT] = t.light;
  p[M.ACC_SH] = t.accSh;
  p[M.ACC] = t.acc;
  p[M.ACC_LT] = t.accLt;
  p[M.EYE] = SHARED.eye;
  p[M.WHITE] = SHARED.white;
  p[M.BELLY] = t.belly;
  p[M.BLUSH] = SHARED.blush;
  p[M.GOLD] = SHARED.gold;
  p[M.GOLD_SH] = SHARED.goldSh;
  p[M.MOTIF] = t.motif;
  p[M.MOTIF2] = t.motif2;
  const out = p.map((c, i) => (i === 0 ? 0 : faint && i !== M.OUT ? faded(c) : gba(c)));
  cache.set(key, out);
  return out;
}

/** Army unit materials (sprites.ts): one 16-entry palette per owner and element. */
export const A = {
  EMPTY: 0,
  OUT: 1,
  /** Armour: the owner's colour (shade, base, light). */
  ARM_SH: 2,
  ARM: 3,
  ARM_LT: 4,
  /** Accents: the element's colour (shade, base, light). */
  ACC_SH: 5,
  ACC: 6,
  ACC_LT: 7,
  EYE: 8,
  WHITE: 9,
  SKIN: 10,
  SKIN_SH: 11,
  GOLD: 12,
  GOLD_SH: 13,
  /** Leather, wood and rope: weapon shafts, straps, boots. */
  CLOTH: 14,
  HAIR: 15,
} as const;

/** Armour tones per owner (R-ART-002 "Owner": white steel for White, black iron for Black). */
export const ARMOUR: Record<Side, { out: number; shade: number; base: number; light: number }> = {
  white: { out: 0x303040, shade: 0xa0a8b8, base: 0xe0e4ec, light: 0xffffff },
  black: { out: 0x100c18, shade: 0x202028, base: 0x404450, light: 0x687080 },
};

const armyCache = new Map<string, Palette>();

/**
 * The 16-entry unit palette for one owner and element. Accents are darker on white steel and
 * brighter on black iron so they keep contrast on both; skin, hair, leather and gold are shared.
 */
export function armyPalette(side: Side, element: ElementId, faint = false): Palette {
  const key = `${side}:${element}:${faint ? 1 : 0}`;
  const hit = armyCache.get(key);
  if (hit) return hit;
  const t = TONES[element];
  const arm = ARMOUR[side];
  const acc =
    side === 'white'
      ? { sh: t.accSh, base: t.shade, lt: t.base }
      : { sh: t.shade, base: t.base, lt: t.light };
  const p: number[] = new Array<number>(16).fill(0);
  p[A.OUT] = arm.out;
  p[A.ARM_SH] = arm.shade;
  p[A.ARM] = arm.base;
  p[A.ARM_LT] = arm.light;
  p[A.ACC_SH] = acc.sh;
  p[A.ACC] = acc.base;
  p[A.ACC_LT] = acc.lt;
  p[A.EYE] = SHARED.eye;
  p[A.WHITE] = SHARED.white;
  p[A.SKIN] = 0xf0c8a0;
  p[A.SKIN_SH] = 0xc89068;
  p[A.GOLD] = SHARED.gold;
  p[A.GOLD_SH] = SHARED.goldSh;
  p[A.CLOTH] = 0x9a6838;
  p[A.HAIR] = 0x3a2820;
  const out = p.map((c, i) => (i === 0 ? 0 : faint && i !== A.OUT ? faded(c) : gba(c)));
  armyCache.set(key, out);
  return out;
}

/** Owner colours for base rings and glyph badges (R-ART-002 "Owner"). */
export const OWNER: Record<Side, { fill: number; rim: number; ink: number; out: number }> = {
  white: { fill: gba(0xf8f0d8), rim: gba(0xc8b890), ink: gba(0x302838), out: gba(0x302838) },
  black: { fill: gba(0x383050), rim: gba(0x686088), ink: gba(0xf8f0d8), out: gba(0x100818) },
};

/** Board and overlay colours. */
export const BOARD = {
  light: gba(0xe8dcb8),
  lightSpeck: gba(0xd8c8a0),
  dark: gba(0x88a068),
  darkSpeck: gba(0x789058),
  frame: 0x1d2340,
  selected: 0x48b8e0,
  lastMove: 0xf0d060,
  attacked: 0xd84848,
  check: 0xff3030,
  target: 0x1d2340,
  hover: 0xffffff,
};

export function elementTone(element: ElementId): ElementTones {
  return TONES[element];
}
