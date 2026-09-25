/**
 * Board iconography (R-ART-002: colour is never the only signal). Every cue has its own shape:
 * element icons (flame, wave, leaf, bolt, rock, snowflake, hollow circle), pixel chess glyph
 * badges, ability pips (filled = known, dotted = still hidden from the opponent, square = veiled),
 * the burning-square flames and counter, the smoulder mark for a pending burn, the check alarm,
 * and two shared VFX (burst, fizzle). Pure pixel grids plus palettes; no Phaser here.
 */
import type { ElementId, PieceType, PublicPiece, PublicState, Side } from '@chain-theorem/rules';
import { blit, gba, M, mix, PixelGrid, type Ctx2D, type Palette } from './pixel.ts';
import { creaturePalette, ELEMENT_COLORS, OWNER } from './palette.ts';

const K: Record<string, number> = {
  b: M.BASE,
  a: M.ACC,
  d: M.ACC_SH,
  m: M.MOTIF,
  n: M.MOTIF2,
  w: M.WHITE,
  g: M.GOLD,
  e: M.EYE,
  '#': M.BASE,
};

function fromRows(rows: readonly string[], pad = 1, key: Record<string, number> = K): PixelGrid {
  const w = (rows[0]?.length ?? 0) + pad * 2;
  const g = new PixelGrid(w, rows.length + pad * 2);
  g.stamp(pad, pad, rows, key);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Element icons: 7x7 fills, shaded and outlined to 9x9. Distinct shapes, not just colours.
// ---------------------------------------------------------------------------------------------

const ELEMENT_ICON_ROWS: Record<ElementId, readonly string[]> = {
  ember: ['...a...', '..aa...', '.aama..', '.amma.a', 'aamnmaa', 'amnnnma', '.ammma.'],
  tide: ['.bb....', 'b..b..b', '....bb.', '.......', '.bb....', 'b..b..b', '....bb.'],
  grove: ['....bbb', '..bbbbb', '.bbbbmb', '.bbbmbb', 'bbbmbb.', 'bbmbb..', 'm......'],
  storm: ['...mmm.', '..mmm..', '.mmm...', 'mmmmmm.', '..mmm..', '.mmm...', 'mm.....'],
  stone: ['..bbb..', '.bbbbd.', 'bbbbddd', 'bbbdddd', 'bbddddd', '.dddd..', '.......'],
  frost: ['m..m..m', '.m.m.m.', '..mmm..', 'mmmammm', '..mmm..', '.m.m.m.', 'm..m..m'],
  neutral: ['..bbb..', '.b...b.', 'b.....b', 'b.....b', 'b.....b', '.b...b.', '..bbb..'],
};

export function elementIconGrid(element: ElementId): PixelGrid {
  const g = fromRows(ELEMENT_ICON_ROWS[element]);
  if (element === 'ember' || element === 'grove' || element === 'stone') g.shade();
  return g.outline();
}

export function elementIconPalette(element: ElementId): Palette {
  const p = [...creaturePalette(element)];
  p[M.OUT] = gba(0x181420);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Chess glyph badges: 6x6 pixel glyphs in an 8x8 owner-coloured box (R-ART-002 "Role").
// ---------------------------------------------------------------------------------------------

const GLYPH_ROWS: Record<PieceType, readonly string[]> = {
  king: ['...#...', '..###..', '...#...', '.#####.', '..###..', '..###..', '.#####.'],
  queen: ['#..#..#', '.#.#.#.', '.#####.', '..###..', '..###..', '.#####.', '#######'],
  rook: ['##.#.##', '#######', '.#####.', '.#####.', '.#####.', '.#####.', '#######'],
  bishop: ['...#...', '..###..', '.##.##.', '.#.###.', '..###..', '...#...', '.#####.'],
  knight: ['...##..', '..####.', '.######', '##.####', '...####', '..#####', '.######'],
  pawn: ['.......', '..###..', '..###..', '...#...', '..###..', '.#####.', '.#####.'],
};

/** Badge size in native pixels (7x7 glyph plus a 1 px outline). */
export const BADGE = 9;

/**
 * A chess glyph "sticker": the glyph in the owner's colour with a contrasting 1 px outline, like a
 * printed chess diagram piece. Materials: 1 = outline, 2 = glyph fill.
 */
export function glyphBadgeGrid(type: PieceType): PixelGrid {
  const g = new PixelGrid(BADGE, BADGE);
  g.stamp(1, 1, GLYPH_ROWS[type], { '#': 2 });
  return g.outline(1);
}

export function glyphBadgePalette(side: Side): Palette {
  const o = OWNER[side];
  return side === 'white' ? [0, o.out, o.fill] : [0, o.ink, o.fill];
}

// ---------------------------------------------------------------------------------------------
// Ability pips (R-ART-002 "Revealed abilities").
// ---------------------------------------------------------------------------------------------

/** known = filled gold diamond, hidden = hollow diamond, veiled = square with a dot. */
export type PipKind = 'known' | 'hidden' | 'veiled';
const PIP_ROWS: Record<PipKind, readonly string[]> = {
  known: ['..o..', '.ogo.', 'ogggo', '.ogo.', '..o..'],
  hidden: ['..o..', '.owo.', 'ow.wo', '.owo.', '..o..'],
  veiled: ['ooooo', 'owwwo', 'owowo', 'owwwo', 'ooooo'],
};
const UI_KEY: Record<string, number> = { o: M.OUT, g: M.GOLD, w: M.WHITE, e: M.EYE };

/**
 * Pips under a piece (R-ART-002 "Revealed abilities"). Opponent pieces: one filled pip per
 * revealed ability of that piece type, plus a square pip when the type is known to carry Veil.
 * Own pieces: every ability of the type; filled when the opponent knows it, hollow while hidden.
 * A spectator's board (M7 7.2) carries no sets, so both armies show what their opponent knows.
 * Reads only the projection (R-INFO-005).
 */
export function pipKinds(pub: PublicState, p: PublicPiece, viewer: Side): PipKind[] {
  const army = pub.armies[p.side];
  const revealed = army.revealed.abilities[p.type] ?? [];
  if (p.side === viewer && army.sets) {
    const own = army.sets[p.type] ?? [];
    return own.map((id) => (revealed.includes(id) ? 'known' : 'hidden'));
  }
  const kinds: PipKind[] = revealed.map(() => 'known');
  if (army.revealed.veiled.includes(p.type)) kinds.push('veiled');
  return kinds;
}

export function pipGrid(kind: PipKind): PixelGrid {
  return fromRows(PIP_ROWS[kind], 0, UI_KEY);
}

/** Shared palette for UI stamps (pips, counters, check badge, VFX). */
export const UI_PALETTE: Palette = (() => {
  const p = new Array<number>(16).fill(0);
  p[M.OUT] = gba(0x181420);
  p[M.SHADE] = gba(0x908878);
  p[M.BASE] = gba(0xd8d0c0);
  p[M.LIGHT] = gba(0xf8f8f8);
  p[M.ACC_SH] = gba(0xa01818);
  p[M.ACC] = gba(0xe83820);
  p[M.ACC_LT] = gba(0xf87840);
  p[M.EYE] = gba(0x201828);
  p[M.WHITE] = gba(0xf8f8f8);
  p[M.BELLY] = gba(0x404058);
  p[M.GOLD] = gba(0xf8c830);
  p[M.GOLD_SH] = gba(0xb87818);
  p[M.MOTIF] = gba(0xf8d838);
  p[M.MOTIF2] = gba(0xf8f8b0);
  return p;
})();

// ---------------------------------------------------------------------------------------------
// 3x5 pixel font for coordinates and counters (crisp at any integer scale).
// ---------------------------------------------------------------------------------------------

const FONT: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  a: ['...', '.##', '#.#', '#.#', '.##'],
  b: ['#..', '##.', '#.#', '#.#', '##.'],
  c: ['...', '.##', '#..', '#..', '.##'],
  d: ['..#', '.##', '#.#', '#.#', '.##'],
  e: ['...', '.#.', '###', '#..', '.##'],
  f: ['.##', '#..', '##.', '#..', '#..'],
  g: ['.##', '#.#', '.##', '..#', '##.'],
  h: ['#..', '##.', '#.#', '#.#', '#.#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
};
export const FONT_CHARS = Object.keys(FONT);

/** A 3x5 glyph as a grid (material 1 = ink). */
export function fontGrid(ch: string): PixelGrid {
  const g = new PixelGrid(3, 5);
  g.stamp(0, 0, FONT[ch] ?? FONT['0'] ?? [], { '#': 1 });
  return g;
}

// ---------------------------------------------------------------------------------------------
// Burning squares (Hot Foot, R-ELEM-005 / R-ART-002 "Burning square").
// ---------------------------------------------------------------------------------------------

/** 32x32 flame field for a burning square; `v` flickers between two frames. */
export function flameGrid(v: 0 | 1): PixelGrid {
  const g = new PixelGrid(32, 32);
  for (let x = 0; x < 32; x++) {
    const h = Math.round(
      7 + 5 * Math.abs(Math.sin(x * 0.55 + v * 1.7)) + 3 * Math.abs(Math.sin(x * 1.9 + v)),
    );
    for (let y = 31; y > 31 - h; y--) {
      const depth = 31 - y;
      const core = depth < h * 0.55 && x % 8 !== 0;
      g.set(x, y, depth > h - 2 ? M.ACC_SH : core ? (depth < h * 0.3 ? M.MOTIF2 : M.MOTIF) : M.ACC);
    }
  }
  // Rising embers.
  const embers: [number, number][] = v
    ? [
        [5, 12],
        [14, 8],
        [23, 11],
        [28, 6],
      ]
    : [
        [3, 9],
        [11, 13],
        [19, 7],
        [26, 12],
      ];
  for (const [x, y] of embers) g.set(x, y, M.MOTIF);
  return g;
}

export const FLAME_PALETTE: Palette = (() => {
  const p = [...UI_PALETTE];
  p[M.ACC_SH] = gba(0xb82010);
  p[M.ACC] = gba(0xf05020);
  p[M.MOTIF] = gba(0xf8b828);
  p[M.MOTIF2] = gba(0xf8f0a0);
  return p;
})();

/** 5x7 flame used in the counter badge and (hollow) as the pending-burn smoulder mark. */
const SMALL_FLAME = ['..a..', '.aa..', '.ama.', 'amma.', 'amnma', 'amnma', '.aaa.'];
export function smallFlameGrid(hollow: boolean): PixelGrid {
  const g = fromRows(SMALL_FLAME, 1, {
    a: M.ACC,
    m: hollow ? M.ACC : M.MOTIF,
    n: hollow ? M.ACC_SH : M.MOTIF2,
  });
  if (hollow) {
    // Smoulder: only the rim glows; the centre stays open.
    g.set(3, 4, M.EMPTY);
    g.set(3, 5, M.EMPTY);
    g.set(3, 6, M.EMPTY);
  }
  return g.outline();
}

// ---------------------------------------------------------------------------------------------
// Check alarm and shared VFX.
// ---------------------------------------------------------------------------------------------

export function checkBadgeGrid(): PixelGrid {
  const g = new PixelGrid(9, 9);
  g.ellipse(4.5, 4.5, 4.5, 4.5, M.ACC);
  g.stamp(3, 2, FONT['!'] ?? [], { '#': M.WHITE });
  return g.outline();
}

/** 16x16 eight-point burst drawn in light greys so a tint can colour it per element. */
export function burstGrid(): PixelGrid {
  const g = new PixelGrid(16, 16);
  const c = 7.5;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const len = k % 2 === 0 ? 7.5 : 5.5;
    for (let r = 2; r <= len; r += 0.5) {
      const x = Math.floor(c + Math.cos(a) * r + 0.5);
      const y = Math.floor(c + Math.sin(a) * r + 0.5);
      g.set(x, y, r > len - 2 ? M.BASE : M.WHITE);
      if (k % 2 === 0)
        g.set(x + (k === 0 || k === 4 ? 0 : 1), y + (k === 0 || k === 4 ? 1 : 0), M.LIGHT);
    }
  }
  g.ellipse(8, 8, 2.6, 2.6, M.LIGHT);
  g.rect(7, 7, 2, 2, M.WHITE);
  return g.outline(M.SHADE);
}

/** 12x12 grey puff with a slash: an ability silenced, negated or fizzled. */
export function fizzleGrid(): PixelGrid {
  const g = new PixelGrid(12, 12);
  g.ellipse(4, 7, 3.2, 3, M.BASE);
  g.ellipse(8, 7, 3.2, 3, M.BASE);
  g.ellipse(6, 4.5, 3.2, 3, M.BASE);
  g.line(2, 10, 10, 2, M.BELLY, 1);
  return g.outline();
}

// ---------------------------------------------------------------------------------------------
// Base ring: owner colour with an element-tinted centre (R-ART-002 "Owner", "Element").
// ---------------------------------------------------------------------------------------------

export const RING_W = 22;
export const RING_H = 8;

export function ringGrid(): PixelGrid {
  const g = new PixelGrid(RING_W, RING_H);
  g.ellipse(11, 4, 10, 3.6, 2);
  g.ellipse(11, 4.2, 7, 2.1, 3);
  return g.outline(1);
}

export function ringPalette(side: Side, element: ElementId): Palette {
  const o = OWNER[side];
  return [0, o.out, o.fill, gba(mix(o.fill, ELEMENT_COLORS[element], 0.6))];
}

// ---------------------------------------------------------------------------------------------
// Board.
// ---------------------------------------------------------------------------------------------

/** Deterministic speckle so each square gets a little hand-made texture. */
export function boardGrid(): PixelGrid {
  const g = new PixelGrid(256, 256);
  for (let sq = 0; sq < 64; sq++) {
    const col = sq & 7;
    const row = sq >> 3;
    const light = (col + row) % 2 === 0;
    g.rect(col * 32, row * 32, 32, 32, light ? 1 : 3);
    let seed = (sq * 2654435761) >>> 0;
    for (let k = 0; k < 7; k++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const x = (seed >>> 8) % 30;
      const y = (seed >>> 18) % 30;
      g.rect(col * 32 + 1 + x, row * 32 + 1 + y, k % 3 === 0 ? 2 : 1, 1, light ? 2 : 4);
    }
  }
  return g;
}

export function drawGrid(
  ctx: Ctx2D,
  g: PixelGrid,
  palette: Palette,
  scale = 1,
  x = 0,
  y = 0,
): void {
  blit(ctx, g, palette, scale, x, y);
}
