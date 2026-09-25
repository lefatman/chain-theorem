/**
 * `@chain-theorem/content/world` (M5, spec 10): the world registry (zones with their Tiled maps,
 * NPCs, Chess Academy lessons, quests, key items and the start zone), lookup maps, the Tiled zone
 * parser and geometry helpers, progression values (XP curve, battle XP, wild rewards, encounter
 * pacing) and the world validator. Plain data plus pure functions; the server decides movement,
 * encounters, lesson results and rewards (R-SEC-003).
 */
import { LESSONS } from './lessons.ts';
import { NPCS } from './npcs.ts';
import { KEY_ITEMS, QUESTS } from './quests.ts';
import { parseZone } from './geometry.ts';
import type {
  KeyItemDef,
  LessonDef,
  NpcDef,
  QuestDef,
  WorldRegistry,
  ZoneDef,
  ZoneGeometry,
} from './types.ts';
import { START_ZONE, ZONES } from './zones.ts';

export * from './geometry.ts';
export type * from './types.ts';
export * from './progression.ts';
export { validateWorld, puzzleMoves } from './validate.ts';
export { TILES, TILESET_NAME, tileId, type TileDef } from './tiles.ts';
export { asTiledMap } from './zones.ts';

export const world: WorldRegistry = {
  zones: ZONES,
  npcs: NPCS,
  lessons: LESSONS,
  quests: QUESTS,
  keyItems: KEY_ITEMS,
  start: { zone: START_ZONE },
};

export const zoneById: ReadonlyMap<string, ZoneDef> = new Map(world.zones.map((z) => [z.id, z]));
export const npcById: ReadonlyMap<string, NpcDef> = new Map(world.npcs.map((n) => [n.id, n]));
export const lessonById: ReadonlyMap<string, LessonDef> = new Map(
  world.lessons.map((l) => [l.id, l]),
);
export const questById: ReadonlyMap<string, QuestDef> = new Map(world.quests.map((q) => [q.id, q]));
export const keyItemById: ReadonlyMap<string, KeyItemDef> = new Map(
  world.keyItems.map((k) => [k.id, k]),
);

const geometryCache = new Map<string, ZoneGeometry>();

/** The parsed map of a zone (parsed once, then cached); throws for an unknown zone. */
export function zoneGeometry(id: string): ZoneGeometry {
  let g = geometryCache.get(id);
  if (!g) {
    const zone = zoneById.get(id);
    if (!zone) throw new Error(`unknown zone ${id}`);
    g = parseZone(zone.map);
    geometryCache.set(id, g);
  }
  return g;
}

/** Where an NPC stands: its zone and tile (each NPC is placed exactly once, validateWorld). */
export function npcLocation(
  id: string,
): { zone: string; x: number; y: number; dir: ZoneGeometry['spawn']['dir'] } | null {
  for (const z of world.zones) {
    const n = zoneGeometry(z.id).npcs.find((p) => p.id === id);
    if (n) return { zone: z.id, x: n.x, y: n.y, dir: n.dir };
  }
  return null;
}

/**
 * The per-step encounter chance in a zone for a player owning `keyItems` (10.2): the zone's rate
 * times every owned key item's multiplier (the Hush Candle halves it).
 */
export function encounterRateFor(zone: ZoneDef, keyItems: readonly string[]): number {
  let rate = zone.encounterRate;
  for (const id of new Set(keyItems)) rate *= keyItemById.get(id)?.encounterRate ?? 1;
  return rate;
}
