/** Tiled map parsing (R-WORLD-001). */
import { describe, expect, it } from 'vitest';
import { parseZone, stepFrom, walkable } from './geometry.ts';
import type { TiledMap, TiledObject } from './types.ts';

function map(objects: Partial<TiledObject>[], data?: number[]): TiledMap {
  const w = 4;
  const h = 3;
  return {
    type: 'map',
    orientation: 'orthogonal',
    width: w,
    height: h,
    tilewidth: 16,
    tileheight: 16,
    infinite: false,
    tilesets: [
      {
        firstgid: 1,
        name: 'world',
        tilewidth: 16,
        tileheight: 16,
        tilecount: 3,
        columns: 3,
        tiles: [
          { id: 0, properties: [{ name: 'kind', type: 'string', value: 'grass' }] },
          {
            id: 1,
            properties: [
              { name: 'kind', type: 'string', value: 'tree' },
              { name: 'solid', type: 'bool', value: true },
            ],
          },
          {
            id: 2,
            properties: [
              { name: 'kind', type: 'string', value: 'tall' },
              { name: 'wild', type: 'bool', value: true },
            ],
          },
        ],
      },
    ],
    layers: [
      {
        type: 'tilelayer',
        name: 'ground',
        width: w,
        height: h,
        data: data ?? [1, 1, 2, 1, 1, 3, 3, 1, 1, 1, 1, 1],
      },
      {
        type: 'objectgroup',
        name: 'objects',
        objects: objects.map((o, i) => ({
          id: i + 1,
          name: '',
          type: '',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          ...o,
        })),
      },
    ],
  };
}

const spawn = { type: 'spawn', x: 0, y: 0 };

describe('Tiled zones (R-WORLD-001)', () => {
  it('R-WORLD-001 reads solid, wild and drawing kinds from tile properties, ignoring flip flags', () => {
    const flipped = 0x80000000 + 2;
    const g = parseZone(map([spawn], [1, 1, flipped, 1, 1, 3, 3, 1, 1, 1, 1, 1]));
    expect(g.kinds[0]?.slice(0, 4)).toEqual(['grass', 'grass', 'tree', 'grass']);
    expect(walkable(g, 2, 0)).toBe(false);
    expect(walkable(g, 1, 1)).toBe(true);
    expect(g.wild[1 * 4 + 1]).toBe(1);
    expect(walkable(g, -1, 0)).toBe(false);
    expect(stepFrom(1, 1, 'n')).toEqual({ x: 1, y: 0 });
  });

  it('R-WORLD-001 reads warps, NPCs (which block their tile), areas and challenge zones', () => {
    const prop = (name: string, type: 'string' | 'int', value: string | number) => ({
      name,
      type,
      value,
    });
    const g = parseZone(
      map([
        { ...spawn, properties: [{ name: 'dir', type: 'string', value: 'e' }] },
        {
          type: 'warp',
          x: 48,
          y: 32,
          properties: [
            prop('to', 'string', 'route1'),
            prop('toX', 'int', 5),
            prop('toY', 'int', 0),
          ],
        },
        { type: 'npc', x: 16, y: 32, properties: [prop('npc', 'string', 'teacher')] },
        { type: 'area', name: 'gate', x: 0, y: 16, width: 32, height: 16 },
        { type: 'challenge', x: 0, y: 0, width: 64, height: 48 },
      ]),
    );
    expect(g.spawn).toEqual({ x: 0, y: 0, dir: 'e' });
    expect(g.warps).toEqual([{ x: 3, y: 2, to: 'route1', toX: 5, toY: 0, dir: 's' }]);
    expect(g.npcs).toEqual([{ id: 'teacher', x: 1, y: 2, dir: 's' }]);
    expect(walkable(g, 1, 2)).toBe(false);
    expect(g.areas).toEqual([{ name: 'gate', x: 0, y: 1, w: 2, h: 1 }]);
    expect(g.challenge).toEqual([{ x: 0, y: 0, w: 4, h: 3 }]);
  });

  it('R-WORLD-001 rejects malformed maps', () => {
    expect(() => parseZone(map([]))).toThrow(/exactly one spawn/);
    expect(() => parseZone(map([spawn, { type: 'teleporter' }]))).toThrow(/unknown type/);
    expect(() => parseZone(map([spawn, { type: 'warp', x: 16 }]))).toThrow(
      /needs string property "to"/,
    );
    expect(() => parseZone(map([{ type: 'spawn', x: 32, y: 0 }]))).toThrow(/spawn tile is solid/);
    expect(() => parseZone(map([spawn], [1, 1]))).toThrow(/does not match/);
  });
});
