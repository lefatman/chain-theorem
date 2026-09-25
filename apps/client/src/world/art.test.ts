/**
 * Overworld art (M5, spec 10.1, 11.1, R-ART-001, R-ART-003): procedural 16x16 tiles and 16x20
 * trainers are deterministic, the right size, cover every kind of the content tileset, show wild
 * grass with a visible pattern, fall back for unknown kinds, and give the four facing directions
 * distinct outlines.
 */
import { describe, expect, it } from 'vitest';
import { TILES } from '@chain-theorem/content/world';
import {
  atlasFromImage,
  PAINTED_KINDS,
  paintChunk,
  paintTile,
  styleOf,
  TILE,
  type Tile16,
} from './tiles.ts';
import {
  battleMark,
  hashString,
  HEAD_STYLES,
  npcLook,
  playerLook,
  trainerFrameIndex,
  trainerGrid,
  trainerSheet,
  TRAINER_FRAMES,
  TRAINER_H,
  TRAINER_W,
  type HeadStyle,
} from './trainers.ts';
import { worldZoom } from './view.ts';

const opaque = (t: Tile16) => [...t.px].filter((v) => v !== 0).length;
const differ = (a: Tile16, b: Tile16) => [...a.px].filter((v, i) => v !== b.px[i]).length;

describe('overworld tiles (R-ART-001, R-WORLD-001)', () => {
  it('R-ART-001 paints every tile kind of the content tileset with its own painter', () => {
    expect(TILES.length).toBeGreaterThan(20);
    for (const t of TILES) {
      expect(PAINTED_KINDS, `kind ${t.kind}`).toContain(t.kind);
      expect(styleOf(t.kind).id).toBe(t.kind);
      const tile = paintTile(t.kind, 3);
      expect(tile.px).toHaveLength(TILE * TILE);
      // Ground tiles cover the tile; deco tiles leave their background transparent.
      if (
        t.layer === 'ground' ||
        ['wall', 'window', 'door', 'emblem', 'roof', 'eave'].includes(t.kind)
      )
        expect(opaque(tile), `${t.kind} is opaque`).toBe(TILE * TILE);
      else expect(opaque(tile), `${t.kind} has a transparent background`).toBeLessThan(TILE * TILE);
      expect(tile.colours(), `${t.kind} has shading`).toBeGreaterThanOrEqual(2);
    }
  });

  it('R-ART-001 is deterministic and varies details by position, not by chance', () => {
    expect(paintTile('grass', 5).px).toEqual(paintTile('grass', 5).px);
    expect(paintTile('flowers', 1).px).toEqual(paintTile('flowers', 1).px);
    expect(differ(paintTile('grass', 1), paintTile('grass', 2))).toBeGreaterThan(0);
    const map = {
      width: 3,
      height: 2,
      kinds: [
        ['grass', 'path', 'water', 'grass', 'tall_grass', 'water'],
        ['', 'tree', '', '', '', ''],
      ],
      wild: new Uint8Array([0, 0, 0, 0, 1, 0]),
    };
    const a = paintChunk(map, 0, 0, 3, 2);
    expect(a).toHaveLength(3 * 16 * 2 * 16 * 4);
    expect(paintChunk(map, 0, 0, 3, 2)).toEqual(a);
    // Every pixel inside the map is painted (opaque).
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    // Outside the map stays transparent.
    const edge = paintChunk(map, 2, 1, 2, 1);
    expect(edge[(0 * 32 + 20) * 4 + 3]).toBe(0);
  });

  it('R-WORLD-002 wild grass has a visible pattern, distinct from plain grass', () => {
    const tall = paintTile('tall_grass');
    const grass = paintTile('grass');
    expect(tall.colours()).toBeGreaterThanOrEqual(4);
    expect(differ(tall, grass)).toBeGreaterThan(128);
    // A wild tile whose kind is not tall grass still gets the blade pattern.
    const plain = { width: 1, height: 1, kinds: [['grass']], wild: new Uint8Array([0]) };
    const wild = { width: 1, height: 1, kinds: [['grass']], wild: new Uint8Array([1]) };
    const p = paintChunk(plain, 0, 0, 1, 1);
    const w = paintChunk(wild, 0, 0, 1, 1);
    let changed = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== w[i] || p[i + 1] !== w[i + 1]) changed++;
    expect(changed).toBeGreaterThan(40);
  });

  it('R-WORLD-001 unknown kinds match by keyword or fall back to a neutral tile', () => {
    expect(styleOf('pine_tree').id).toBe('tree');
    expect(styleOf('deep_water').id).toBe('water');
    expect(styleOf('dirt_road').id).toBe('path');
    expect(styleOf('overworld:57').id).toBe('unknown');
    const fallback = paintTile('zzz');
    expect(opaque(fallback)).toBe(TILE * TILE);
    for (const k of PAINTED_KINDS) expect(differ(fallback, paintTile(k))).toBeGreaterThan(0);
  });

  it('R-WORLD-001 water and roofs join their neighbours (shore and building edges)', () => {
    const lake = paintTile('water', 0, { n: true, s: true, e: true, w: true });
    const shore = paintTile('water', 0, { n: false, s: true, e: true, w: true });
    expect(differ(lake, shore)).toBeGreaterThanOrEqual(16);
    const inner = paintTile('roof', 0, { n: true, s: true, e: true, w: true });
    const corner = paintTile('roof', 0, { n: false, s: true, e: true, w: false });
    expect(differ(inner, corner)).toBeGreaterThan(16);
    // One building, one colour: two roof tiles side by side share their palette.
    const map = {
      width: 2,
      height: 1,
      kinds: [
        ['grass', 'grass'],
        ['roof', 'roof'],
      ],
      wild: new Uint8Array(2),
    };
    const px = paintChunk(map, 0, 0, 2, 1);
    const at = (x: number, y: number) => {
      const i = (y * 32 + x) * 4;
      return (px[i] ?? 0) * 65536 + (px[i + 1] ?? 0) * 256 + (px[i + 2] ?? 0);
    };
    expect(at(4, 6)).toBe(at(20, 6));
  });

  it('R-WORLD-001 draws kinds from the content tileset image, procedural tiles for the rest', () => {
    // A 2x1-tile image: tile 0 solid red ("grass"), tile 1 a blue dot on transparency ("tree").
    const w = 32;
    const rgba = new Uint8ClampedArray(w * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * w + x) * 4;
        if (x < 16) rgba.set([255, 0, 0, 255], i);
        else if (x === 24 && y === 8) rgba.set([0, 0, 255, 255], i);
      }
    const atlas = atlasFromImage(
      rgba,
      w,
      new Map([
        ['grass', 0],
        ['tree', 1],
        ['far', 9],
      ]),
    );
    expect(atlas('grass')?.[0]).toBe(0x1ff0000);
    expect(atlas('tree')?.filter((v) => v !== 0)).toHaveLength(1);
    expect(atlas('far')).toBeNull(); // outside the image
    expect(atlas('water')).toBeNull();
    const map = {
      width: 3,
      height: 1,
      kinds: [
        ['grass', '', 'water'],
        ['', 'tree', ''],
      ],
      wild: new Uint8Array(3),
    };
    const px = paintChunk(map, 0, 0, 3, 1, atlas);
    const at = (x: number, y: number) => [...px.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    // A see-through tileset tile with nothing under it stands on the base ground (grass).
    expect(at(24, 8)).toEqual([0, 0, 255, 255]);
    expect(at(16, 0)).toEqual([255, 0, 0, 255]);
    // Kinds the tileset lacks use the procedural painters.
    expect(at(40, 8)).not.toEqual([255, 0, 0, 255]);
    expect(at(40, 8)[3]).toBe(255);
  });
});

describe('overworld trainers (R-ART-001, R-ART-003)', () => {
  it('R-ART-001 sheets hold 8 frames of 16x20: four directions with a 2-frame walk', () => {
    expect(TRAINER_FRAMES).toHaveLength(8);
    for (const dir of ['n', 's', 'e', 'w'] as const)
      for (const frame of [0, 1] as const)
        expect(trainerFrameIndex(dir, frame)).toBeGreaterThanOrEqual(0);
    const sheet = trainerSheet(playerLook('p1'));
    expect(sheet).toHaveLength(TRAINER_W * 8 * TRAINER_H * 4);
    expect(trainerSheet(playerLook('p1'))).toEqual(sheet);
  });

  it('R-ART-001 the four directions have distinct outlines, and the walk frame moves the legs', () => {
    for (let s = 0; s < HEAD_STYLES.length; s++) {
      const style = s as HeadStyle;
      const masks = (['n', 's', 'e', 'w'] as const).map((d) => trainerGrid(style, d, 0).mask());
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++)
          expect(masks[i], `style ${s}: directions ${i} and ${j}`).not.toEqual(masks[j]);
      for (const d of ['n', 's', 'e', 'w'] as const) {
        const stand = trainerGrid(style, d, 0);
        const walk = trainerGrid(style, d, 1);
        expect(walk.w).toBe(TRAINER_W);
        expect(walk.h).toBe(TRAINER_H);
        expect(walk.mask(), `${d} walk frame`).not.toEqual(stand.mask());
        // The head and body stay put: only the legs (rows 16+) change.
        expect(walk.px.slice(0, 15 * TRAINER_W)).toEqual(stand.px.slice(0, 15 * TRAINER_W));
      }
    }
    // West is the mirror image of east.
    const e = trainerGrid(0, 'e', 0);
    const w = trainerGrid(0, 'w', 0);
    for (let y = 0; y < TRAINER_H; y++)
      for (let x = 0; x < TRAINER_W; x++) expect(w.get(x, y)).toBe(e.get(TRAINER_W - 1 - x, y));
  });

  it('R-ART-003 looks vary by player id and NPC element, stably', () => {
    expect(playerLook('alice')).toEqual(playerLook('alice'));
    const looks = new Set(
      Array.from({ length: 40 }, (_, i) => JSON.stringify(playerLook(`player-${i}`))),
    );
    expect(looks.size).toBeGreaterThan(20);
    expect(hashString('a')).not.toBe(hashString('b'));
    const ember = npcLook({ variant: 3, element: 'ember' });
    const tide = npcLook({ variant: 3, element: 'tide' });
    expect(ember.style).toBe(tide.style);
    expect(ember.top).not.toBe(tide.top);
    expect(battleMark().grid.w).toBe(11);
  });

  it('R-ART-001 zooms by whole pixels and keeps a handheld-sized view from 360x640 up', () => {
    expect(worldZoom(360, 380)).toBe(2);
    expect(worldZoom(1280 - 384, 800 - 48)).toBe(5);
    expect(worldZoom(100, 100)).toBe(1);
    expect(worldZoom(10_000, 10_000)).toBe(6);
  });
});
