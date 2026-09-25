/**
 * Parse a Tiled JSON map into what the server (collision, wild grass, warps, areas) and the client
 * (drawing) need (10.1). Tile meaning comes from tileset tile properties: `kind` (drawing key),
 * `solid` and `wild`. Objects in the `objects` layer: `spawn`, `warp` (to, toX, toY, dir), `npc`
 * (npc, dir), `area` (named rectangle for quest steps), `challenge` (challenge-zone rectangle, 10.4)
 * and `sign` (text). Pure; throws on a malformed map (content:validate runs it on every zone).
 */
import type {
  Dir,
  TiledMap,
  TiledObject,
  TiledProperty,
  TiledTileset,
  TileRect,
  ZoneGeometry,
} from './types.ts';

const FLIP_MASK = 0x1fffffff; // Tiled stores flip flags in the top three bits of a gid.
const DIRS: readonly Dir[] = ['n', 's', 'e', 'w'];

function prop(
  props: TiledProperty[] | undefined,
  name: string,
): TiledProperty['value'] | undefined {
  return props?.find((p) => p.name === name)?.value;
}

function str(o: TiledObject, name: string): string {
  const v = prop(o.properties, name);
  if (typeof v !== 'string' || v === '')
    throw new Error(`object ${o.id} (${o.name}) needs string property "${name}"`);
  return v;
}

function int(o: TiledObject, name: string): number {
  const v = prop(o.properties, name);
  if (typeof v !== 'number' || !Number.isInteger(v))
    throw new Error(`object ${o.id} (${o.name}) needs int property "${name}"`);
  return v;
}

function dir(o: TiledObject, fallback: Dir = 's'): Dir {
  const v = prop(o.properties, 'dir');
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !(DIRS as readonly string[]).includes(v))
    throw new Error(`object ${o.id}: bad dir ${String(v)}`);
  return v as Dir;
}

interface TileInfo {
  kind: string;
  solid: boolean;
  wild: boolean;
}

function tileTable(tilesets: TiledTileset[]): Map<number, TileInfo> {
  const out = new Map<number, TileInfo>();
  for (const ts of tilesets) {
    for (let i = 0; i < ts.tilecount; i++)
      out.set(ts.firstgid + i, { kind: `${ts.name}:${i}`, solid: false, wild: false });
    for (const t of ts.tiles ?? []) {
      const gid = ts.firstgid + t.id;
      const kind = prop(t.properties, 'kind');
      out.set(gid, {
        kind: typeof kind === 'string' ? kind : `${ts.name}:${t.id}`,
        solid: prop(t.properties, 'solid') === true,
        wild: prop(t.properties, 'wild') === true,
      });
    }
  }
  return out;
}

export function parseZone(map: TiledMap): ZoneGeometry {
  if (map.type !== 'map' || map.orientation !== 'orthogonal')
    throw new Error('only orthogonal Tiled maps');
  if (map.tilewidth !== 16 || map.tileheight !== 16) throw new Error('tiles must be 16x16 (10.1)');
  const { width, height } = map;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4096 * 64
  )
    throw new Error(`bad map size ${width}x${height}`);
  const n = width * height;
  const tiles = tileTable(map.tilesets);
  const solid = new Uint8Array(n);
  const wild = new Uint8Array(n);
  const kinds: string[][] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer') continue;
    if (layer.data.length !== n || layer.width !== width || layer.height !== height)
      throw new Error(`layer ${layer.name} does not match the map size`);
    const k = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const gid = (layer.data[i] ?? 0) & FLIP_MASK;
      if (gid === 0) {
        k[i] = '';
        continue;
      }
      const t = tiles.get(gid);
      if (!t) throw new Error(`layer ${layer.name}: unknown tile gid ${gid}`);
      k[i] = t.kind;
      if (t.solid) solid[i] = 1;
      if (t.wild) wild[i] = 1;
    }
    kinds.push(k);
  }
  const objects = map.layers.flatMap((l) => (l.type === 'objectgroup' ? l.objects : []));
  const tx = (px: number) => Math.floor(px / 16);
  const rect = (o: TiledObject): TileRect => ({
    x: tx(o.x),
    y: tx(o.y),
    w: Math.max(1, Math.round(o.width / 16)),
    h: Math.max(1, Math.round(o.height / 16)),
  });
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const geo: ZoneGeometry = {
    width,
    height,
    solid,
    wild,
    kinds,
    spawn: { x: 0, y: 0, dir: 's' },
    warps: [],
    npcs: [],
    areas: [],
    challenge: [],
    signs: [],
  };
  let spawns = 0;
  for (const o of objects) {
    const type = String(o.type ?? (o as { class?: string }).class ?? '');
    const x = tx(o.x);
    const y = tx(o.y);
    if ((type === 'spawn' || type === 'warp' || type === 'npc' || type === 'sign') && !inside(x, y))
      throw new Error(`object ${o.id} (${type}) is outside the map`);
    switch (type) {
      case 'spawn':
        geo.spawn = { x, y, dir: dir(o) };
        spawns++;
        break;
      case 'warp':
        geo.warps.push({
          x,
          y,
          to: str(o, 'to'),
          toX: int(o, 'toX'),
          toY: int(o, 'toY'),
          dir: dir(o),
        });
        break;
      case 'npc':
        geo.npcs.push({ id: str(o, 'npc'), x, y, dir: dir(o) });
        break;
      case 'area':
        geo.areas.push({ name: o.name, ...rect(o) });
        break;
      case 'challenge':
        geo.challenge.push(rect(o));
        break;
      case 'sign':
        geo.signs.push({ x, y, text: str(o, 'text') });
        break;
      default:
        throw new Error(`object ${o.id}: unknown type "${type}"`);
    }
  }
  if (spawns !== 1) throw new Error(`a zone needs exactly one spawn (found ${spawns})`);
  if (solid[geo.spawn.y * width + geo.spawn.x]) throw new Error('the spawn tile is solid');
  // NPCs and signs stand on their tile: it blocks movement.
  for (const npc of geo.npcs) solid[npc.y * width + npc.x] = 1;
  for (const s of geo.signs) solid[s.y * width + s.x] = 1;
  return geo;
}

export const tileIndex = (g: Pick<ZoneGeometry, 'width'>, x: number, y: number): number =>
  y * g.width + x;

/** Can a player stand on (x, y)? */
export function walkable(g: ZoneGeometry, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height && g.solid[tileIndex(g, x, y)] === 0;
}

export function inRect(r: TileRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** The tile one step in `d` from (x, y). */
export function stepFrom(x: number, y: number, d: Dir): { x: number; y: number } {
  return d === 'n'
    ? { x, y: y - 1 }
    : d === 's'
      ? { x, y: y + 1 }
      : d === 'e'
        ? { x: x + 1, y }
        : { x: x - 1, y };
}
