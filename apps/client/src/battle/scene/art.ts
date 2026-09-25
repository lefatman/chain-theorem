/**
 * Procedural art for the battle board (M3 step 3.1, ready for M4 step 4.5; R-ART-001..004).
 * Every texture is generated at runtime from code: no external assets, no Pokémon-derived designs
 * (R-ART-003). Pixel art is drawn at native size and shown at an integer nearest-neighbour scale
 * (ART_SCALE with `pixelArt: true`).
 *
 * Textures are lazy and cached: a creature sheet (6 frames) is painted the first time its piece
 * type and element appear, and the painted canvases live at module level, so a second battle only
 * uploads them again. `artStats` records how long painting takes (reported for 12.3 budgets).
 *
 * Drop-in pipeline for human art (4.5): `registerCreatureSheet()` replaces a procedural sheet with
 * any image or canvas that follows `SHEET_FRAMES` (six square frames in one row).
 *
 * This module has no runtime Phaser import, so the Scenario Lab or an exporter can use
 * `drawCreature` without pulling Phaser into the first load.
 */
import type Phaser from 'phaser';
import type { ElementId, PieceType, Side } from '@chain-theorem/rules';
import {
  creatureSheetPixels,
  SHEET_FRAMES,
  SPRITE,
  type CreatureFacing,
  type CreatureFrame,
} from './sprites.ts';
import {
  BADGE,
  boardGrid,
  burstGrid,
  checkBadgeGrid,
  elementIconGrid,
  elementIconPalette,
  fizzleGrid,
  FLAME_PALETTE,
  flameGrid,
  FONT_CHARS,
  fontGrid,
  glyphBadgeGrid,
  glyphBadgePalette,
  pipGrid,
  ringGrid,
  ringPalette,
  smallFlameGrid,
  UI_PALETTE,
  type PipKind,
} from './icons.ts';
import { writeRgba, type PixelGrid, type Palette } from './pixel.ts';
import { BOARD } from './palette.ts';

export {
  drawCreature,
  drawCreatureSheet,
  creatureGrid,
  SPRITE,
  SHEET_FRAMES,
  CREATURE_FRAMES,
  PIECE_TYPES,
  ELEMENTS,
  type CreatureFacing,
  type CreatureFrame,
} from './sprites.ts';
export { ELEMENT_COLORS, ELEMENT_ICON_SHAPE } from './palette.ts';

/** Board square size in game pixels. */
export const TILE = 64;
/** Integer nearest-neighbour scale for native pixel art on the board. */
export const ART_SCALE = 2;
/** Texture key of the shared UI atlas (icons, badges, pips, font, flames, VFX). */
export const UI = 'ct-ui';
export const BOARD_KEY = 'ct-board';

export const ELEMENT_IDS: readonly ElementId[] = [
  'ember',
  'tide',
  'grove',
  'storm',
  'stone',
  'frost',
  'neutral',
];
const TYPES: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const SIDES: readonly Side[] = ['white', 'black'];

export interface ArtStats {
  /** Creature sheets painted this page load (each has 6 frames). */
  creatureSheets: number;
  /** Total ms spent painting creature sheets. */
  creatureMs: number;
  /** Slowest single sheet (ms). */
  creatureMaxMs: number;
  /** ms spent painting the UI atlas and board (once per page load). */
  uiMs: number;
  /** ms spent drawing Classic View glyphs. */
  classicMs: number;
  /** Canvas-to-texture uploads (one per sheet per Phaser game). */
  uploads: number;
  uploadMs: number;
}

export const artStats: ArtStats = {
  creatureSheets: 0,
  creatureMs: 0,
  creatureMaxMs: 0,
  uiMs: 0,
  classicMs: 0,
  uploads: 0,
  uploadMs: 0,
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  // CPU-backed canvases: painting is many small fillRects, and uploads read the pixels back.
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Creatures.
// ---------------------------------------------------------------------------------------------

interface Sheet {
  canvas: HTMLCanvasElement;
  /** Frame edge in source pixels (24 for procedural sheets). */
  size: number;
}

const sheets = new Map<string, Sheet>();

export function creatureKey(type: PieceType, element: ElementId): string {
  return `ct-cr-${type}-${element}`;
}

export function creatureFrameName(facing: CreatureFacing, frame: CreatureFrame): string {
  return `${facing}-${frame}`;
}

/** Painted (or registered) sheet for one creature, cached for the page lifetime. */
export function creatureSheet(type: PieceType, element: ElementId): Sheet {
  const key = creatureKey(type, element);
  const hit = sheets.get(key);
  if (hit) return hit;
  const t0 = now();
  const canvas = makeCanvas(SPRITE * SHEET_FRAMES.length, SPRITE);
  const img = new ImageData(creatureSheetPixels(type, element), canvas.width, canvas.height);
  ctx2d(canvas).putImageData(img, 0, 0);
  const ms = now() - t0;
  artStats.creatureSheets++;
  artStats.creatureMs += ms;
  artStats.creatureMaxMs = Math.max(artStats.creatureMaxMs, ms);
  const sheet = { canvas, size: SPRITE };
  sheets.set(key, sheet);
  return sheet;
}

/**
 * Drop-in human art (M4 step 4.5): replace one creature's procedural sheet with an image or canvas
 * holding six square frames in `SHEET_FRAMES` order. Record its source in assets/LICENSES.md.
 * Call before a battle opens (textures already uploaded to a running game are not swapped).
 */
export function registerCreatureSheet(
  type: PieceType,
  element: ElementId,
  source: HTMLImageElement | HTMLCanvasElement,
): void {
  const size = source.height;
  const canvas = makeCanvas(size * SHEET_FRAMES.length, size);
  ctx2d(canvas).drawImage(source, 0, 0);
  sheets.set(creatureKey(type, element), { canvas, size });
}

/** Board display scale for a creature texture (integer; 2 for the 24 px procedural sprites). */
export function creatureScale(type: PieceType, element: ElementId): number {
  const size = sheets.get(creatureKey(type, element))?.size ?? SPRITE;
  return Math.max(1, Math.round((SPRITE * ART_SCALE) / size));
}

/**
 * Upload a painted canvas as a plain texture. `textures.create` avoids CanvasTexture's
 * getImageData read-back, which is slow on GPU-backed canvases.
 */
function upload(
  scene: Phaser.Scene,
  key: string,
  canvas: HTMLCanvasElement,
): Phaser.Textures.Texture | null {
  const t0 = now();
  const tex = scene.textures.create(key, canvas, canvas.width, canvas.height);
  tex?.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
  artStats.uploads++;
  artStats.uploadMs += now() - t0;
  return tex;
}

/** Ensure the creature sheet for (type, element) exists in this game; returns its texture key. */
export function ensureCreatureTexture(
  scene: Phaser.Scene,
  type: PieceType,
  element: ElementId,
): string {
  const key = creatureKey(type, element);
  if (scene.textures.exists(key)) return key;
  const sheet = creatureSheet(type, element);
  const tex = upload(scene, key, sheet.canvas);
  SHEET_FRAMES.forEach((f, i) => {
    tex?.add(creatureFrameName(f.facing, f.frame), 0, i * sheet.size, 0, sheet.size, sheet.size);
  });
  return key;
}

// ---------------------------------------------------------------------------------------------
// UI atlas: everything small, painted once per page load (shelf-packed).
// ---------------------------------------------------------------------------------------------

interface AtlasEntry {
  name: string;
  grid: PixelGrid;
  palette: Palette;
}

interface Atlas {
  canvas: HTMLCanvasElement;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
}

let uiAtlas: Atlas | null = null;
let boardCanvas: HTMLCanvasElement | null = null;

export type FontInk = 'light' | 'dark' | 'white';
const FONT_INK: Record<FontInk, number> = { light: BOARD.light, dark: BOARD.dark, white: 0xf8f8f8 };

export function ringFrame(side: Side, element: ElementId): string {
  return `ring-${side}-${element}`;
}
export function iconFrame(element: ElementId): string {
  return `icon-${element}`;
}
export function badgeFrame(type: PieceType, side: Side): string {
  return `badge-${type}-${side}`;
}
export function pipFrame(kind: PipKind): string {
  return `pip-${kind}`;
}
export function fontFrame(ink: FontInk, ch: string): string {
  return `font-${ink}-${ch}`;
}

function uiEntries(): AtlasEntry[] {
  const out: AtlasEntry[] = [];
  for (const el of ELEMENT_IDS) {
    out.push({ name: iconFrame(el), grid: elementIconGrid(el), palette: elementIconPalette(el) });
    for (const side of SIDES) {
      out.push({ name: ringFrame(side, el), grid: ringGrid(), palette: ringPalette(side, el) });
    }
  }
  for (const type of TYPES) {
    for (const side of SIDES) {
      out.push({
        name: badgeFrame(type, side),
        grid: glyphBadgeGrid(type),
        palette: glyphBadgePalette(side),
      });
    }
  }
  for (const kind of ['known', 'hidden', 'veiled'] as const) {
    out.push({ name: pipFrame(kind), grid: pipGrid(kind), palette: UI_PALETTE });
  }
  for (const ink of Object.keys(FONT_INK) as FontInk[]) {
    for (const ch of FONT_CHARS)
      out.push({ name: fontFrame(ink, ch), grid: fontGrid(ch), palette: [0, FONT_INK[ink]] });
  }
  out.push({ name: 'flame-0', grid: flameGrid(0), palette: FLAME_PALETTE });
  out.push({ name: 'flame-1', grid: flameGrid(1), palette: FLAME_PALETTE });
  out.push({ name: 'flame-small', grid: smallFlameGrid(false), palette: FLAME_PALETTE });
  out.push({ name: 'smoulder', grid: smallFlameGrid(true), palette: FLAME_PALETTE });
  out.push({ name: 'check', grid: checkBadgeGrid(), palette: UI_PALETTE });
  out.push({ name: 'burst', grid: burstGrid(), palette: UI_PALETTE });
  out.push({ name: 'fizzle', grid: fizzleGrid(), palette: UI_PALETTE });
  return out;
}

function buildAtlas(entries: AtlasEntry[], width = 256): Atlas {
  const frames: Atlas['frames'] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const e of entries) {
    if (x + e.grid.w > width) {
      x = 0;
      y += row + 1;
      row = 0;
    }
    frames.push({ name: e.name, x, y, w: e.grid.w, h: e.grid.h });
    x += e.grid.w + 1;
    row = Math.max(row, e.grid.h);
  }
  const canvas = makeCanvas(width, y + row);
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  entries.forEach((e, i) => {
    const f = frames[i];
    if (f) writeRgba(data, canvas.width, e.grid, e.palette, f.x, f.y);
  });
  ctx2d(canvas).putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  return { canvas, frames };
}

/** Ensure the UI atlas and board texture exist in this game. */
export function ensureUiTextures(scene: Phaser.Scene): void {
  if (!uiAtlas || !boardCanvas) {
    const t0 = now();
    uiAtlas = buildAtlas(uiEntries());
    boardCanvas = makeCanvas(256, 256);
    const data = new Uint8ClampedArray(256 * 256 * 4);
    writeRgba(data, 256, boardGrid(), [
      0,
      BOARD.light,
      BOARD.lightSpeck,
      BOARD.dark,
      BOARD.darkSpeck,
    ]);
    ctx2d(boardCanvas).putImageData(new ImageData(data, 256, 256), 0, 0);
    artStats.uiMs += now() - t0;
  }
  if (!scene.textures.exists(UI)) {
    const tex = upload(scene, UI, uiAtlas.canvas);
    for (const f of uiAtlas.frames) tex?.add(f.name, 0, f.x, f.y, f.w, f.h);
  }
  if (!scene.textures.exists(BOARD_KEY)) upload(scene, BOARD_KEY, boardCanvas);
}

/** Native size of a UI atlas frame (for layout). */
export function uiFrameSize(name: string): { w: number; h: number } {
  const f = uiAtlas?.frames.find((e) => e.name === name);
  return f ? { w: f.w, h: f.h } : { w: 0, h: 0 };
}

export const BADGE_PX = BADGE * ART_SCALE;

// ---------------------------------------------------------------------------------------------
// Classic View: standard chess glyphs, no creatures (11.2).
// ---------------------------------------------------------------------------------------------

const CLASSIC_GLYPHS: Record<PieceType, string> = {
  king: '♚',
  queen: '♛',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  pawn: '♟',
};
const CLASSIC_FONT =
  '"DejaVu Sans", "Noto Sans Symbols 2", "Segoe UI Symbol", "Apple Symbols", "Arial Unicode MS", serif';
const classicCanvases = new Map<string, HTMLCanvasElement>();

export function classicKey(type: PieceType, side: Side): string {
  return `ct-classic-${type}-${side}`;
}

/** Ensure the Classic View glyph for (type, side) exists; returns its texture key. */
export function ensureClassicTexture(scene: Phaser.Scene, type: PieceType, side: Side): string {
  const key = classicKey(type, side);
  if (scene.textures.exists(key)) return key;
  let c = classicCanvases.get(key);
  if (!c) {
    const t0 = now();
    c = makeCanvas(TILE, TILE);
    const ctx = ctx2d(c);
    ctx.font = `${Math.round(TILE * 0.78)}px ${CLASSIC_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    // U+FE0E asks for text (not emoji) presentation of the pawn on Apple platforms.
    const glyph = `${CLASSIC_GLYPHS[type]}︎`;
    ctx.strokeStyle = side === 'white' ? '#1b1b1b' : '#f4f0e6';
    ctx.fillStyle = side === 'white' ? '#fbfaf5' : '#1b1b1b';
    ctx.strokeText(glyph, TILE / 2, TILE / 2 + 3);
    ctx.fillText(glyph, TILE / 2, TILE / 2 + 3);
    classicCanvases.set(key, c);
    artStats.classicMs += now() - t0;
  }
  upload(scene, key, c);
  return key;
}
