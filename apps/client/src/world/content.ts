/**
 * World content on the client (M5, spec 10): zone maps, NPC looks, lesson and quest names. The
 * registry (`@chain-theorem/content/world`, its Tiled maps are the biggest part) is only reachable
 * from the lazily loaded world screen, so it never weighs on the first load (12.3). The server
 * decides everything that matters (R-SEC-003); the client uses this only to draw maps, predict its
 * own steps and label things.
 */
import { signal } from '@preact/signals';
import {
  keyItemById,
  lessonById,
  npcById,
  questById,
  zoneById,
  zoneGeometry as contentGeometry,
  type KeyItemDef,
  type LessonDef,
  type NpcDef,
  type QuestDef,
  type ZoneDef,
  type ZoneGeometry,
} from '@chain-theorem/content/world';

export interface WorldIndex {
  zones: ReadonlyMap<string, ZoneDef>;
  npcs: ReadonlyMap<string, NpcDef>;
  lessons: ReadonlyMap<string, LessonDef>;
  quests: ReadonlyMap<string, QuestDef>;
  keyItems: ReadonlyMap<string, KeyItemDef>;
}

/** The loaded registry (null until `loadWorld()` resolves), for labels in the overlay. */
export const worldIndex = signal<WorldIndex | null>(null);

let loading: Promise<WorldIndex> | null = null;

/** The world registry's lookup maps (async so it can move to its own chunk without API changes). */
export function loadWorld(): Promise<WorldIndex> {
  loading ??= Promise.resolve().then(() => {
    const ix: WorldIndex = {
      zones: zoneById,
      npcs: npcById,
      lessons: lessonById,
      quests: questById,
      keyItems: keyItemById,
    };
    worldIndex.value = ix;
    return ix;
  });
  return loading;
}

/** Parsed geometry of a zone's Tiled map, or null when the client has no map for it. */
export async function zoneGeometry(zone: string): Promise<ZoneGeometry | null> {
  await loadWorld();
  try {
    return contentGeometry(zone);
  } catch (e) {
    // An unknown zone (content newer on the server) or a malformed map: play on without a map.
    console.warn(`no map for zone ${zone}`, e);
    return null;
  }
}

/** A readable zone name: the content name, else the id with words capitalised. */
export function zoneName(zone: string, ix: WorldIndex | null = worldIndex.value): string {
  const def = ix?.zones.get(zone);
  if (def) return def.name;
  return zone
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => `${w[0]?.toUpperCase() ?? ''}${w.slice(1)}`)
    .join(' ');
}

/** Chess lessons may be skipped by veterans; ability and element lessons may not (10.3). */
export function lessonSkippable(lesson: string, ix: WorldIndex | null = worldIndex.value): boolean {
  return ix?.lessons.get(lesson)?.skippable === true;
}
