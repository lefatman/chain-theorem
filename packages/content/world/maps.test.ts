/**
 * Tiled maps and the tileset image (R-WORLD-001, R-ART-001, R-ART-003, R-ART-004): the checked-in
 * files are exactly what `tools/gen-maps.ts` produces, every map embeds the one overworld tileset
 * with `kind`/`solid`/`wild` properties, and the tileset art is recorded in assets/LICENSES.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paintTileset } from './tools/art.ts';
import { generatedFiles, LAYOUTS, TILESET_IMAGE } from './tools/gen-maps.ts';
import { decodePng, encodePng } from './tools/png.ts';
import { asTiledMap, TILES, world } from './index.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('Tiled maps (R-WORLD-001)', () => {
  it('R-WORLD-001 the checked-in maps and tileset image match the generator (run tools/gen-maps.ts)', () => {
    const files = generatedFiles();
    expect([...files.keys()].filter((f) => f.endsWith('.json'))).toHaveLength(world.zones.length);
    for (const [rel, content] of files) {
      const onDisk = readFileSync(join(ROOT, rel));
      if (typeof content === 'string') expect(onDisk.toString('utf8'), rel).toBe(content);
      // Compare decoded pixels: zlib output may differ between Node versions.
      else expect(decodePng(onDisk), rel).toEqual(decodePng(content));
    }
  });

  it('R-WORLD-001 every map embeds the overworld tileset with kind, solid and wild tile properties', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(world.zones.map((z) => z.id));
    for (const z of world.zones) {
      const [ts, ...others] = z.map.tilesets;
      expect(others, z.id).toEqual([]);
      expect(ts?.image).toBe(TILESET_IMAGE);
      expect(ts?.tilecount).toBe(TILES.length);
      expect(
        ts?.tiles?.map((t) =>
          Object.fromEntries((t.properties ?? []).map((p) => [p.name, p.value])),
        ),
      ).toEqual(TILES.map((t) => ({ kind: t.kind, solid: t.solid, wild: t.wild })));
      expect(z.map.layers.map((l) => `${l.type}:${l.name}`)).toEqual([
        'tilelayer:ground',
        'tilelayer:deco',
        'objectgroup:objects',
      ]);
      // Every ground cell is painted; deco cells only hold deco tiles.
      const [ground, deco] = z.map.layers;
      if (ground?.type !== 'tilelayer' || deco?.type !== 'tilelayer') throw new Error('layers');
      expect(
        ground.data.every((gid) => TILES[gid - 1]?.layer === 'ground'),
        z.id,
      ).toBe(true);
      expect(
        deco.data.every((gid) => gid === 0 || TILES[gid - 1]?.layer === 'deco'),
        z.id,
      ).toBe(true);
    }
  });

  it('R-WORLD-001 imported maps pass the Tiled boundary check, and malformed JSON is refused', () => {
    for (const z of world.zones) expect(asTiledMap(z.map, z.id)).toBe(z.map);
    expect(() => asTiledMap({ type: 'map', orientation: 'isometric' }, 'x')).toThrow(/orthogonal/);
    const base = structuredClone(world.zones[0]?.map);
    expect(() => asTiledMap({ ...base, tilewidth: 32 }, 'x')).toThrow(/16x16/);
    expect(() =>
      asTiledMap({ ...base, layers: [{ type: 'tilelayer', name: 'g', data: 'eJz' }] }, 'x'),
    ).toThrow(/uncompressed/);
  });
});

describe('tileset art (R-ART-001, R-ART-003, R-ART-004)', () => {
  it('R-ART-001 16x16 tiles in 8 columns; ground tiles are opaque, deco tiles keep a transparent background', () => {
    const img = decodePng(readFileSync(join(ROOT, 'assets/world/tiles.png')));
    expect(img.width).toBe(8 * 16);
    expect(img.height).toBe(Math.ceil(TILES.length / 8) * 16);
    expect(decodePng(encodePng(paintTileset()))).toEqual(img);
    TILES.forEach((t, i) => {
      let clear = 0;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const px = Math.floor(i / 8) * 16 + y;
          const o = (px * img.width + (i % 8) * 16 + x) * 4;
          if (img.rgba[o + 3] === 0) clear++;
        }
      if (t.layer === 'ground') expect(clear, t.kind).toBe(0);
    });
    // Free-standing deco (trees, rocks, lamps) must let the ground show through.
    for (const kind of ['tree', 'bush', 'rock', 'lamp', 'signpost', 'statue', 'plant']) {
      const i = TILES.findIndex((t) => t.kind === kind);
      const o = (Math.floor(i / 8) * 16 * img.width + (i % 8) * 16) * 4;
      expect(img.rgba[o + 3], kind).toBe(0);
    }
  });

  it('R-ART-004 R-ART-003 the tileset and maps are tiny, and their source and licence are recorded', () => {
    const png = readFileSync(join(ROOT, 'assets/world/tiles.png'));
    expect(png.length).toBeLessThan(20_000);
    for (const z of world.zones) {
      const size = readFileSync(join(ROOT, `packages/content/world/maps/${z.id}.json`)).length;
      expect(size, z.id).toBeLessThan(500_000); // 11.4: 500 KB per additional zone
    }
    const licences = readFileSync(join(ROOT, 'assets/LICENSES.md'), 'utf8');
    expect(licences).toContain('assets/world/tiles.png');
    expect(licences).toContain('packages/content/world/tools/art.ts');
  });
});
