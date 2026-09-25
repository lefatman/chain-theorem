/**
 * Wild encounters (R-WORLD-002, 10.2): decided on the server only (R-SEC-003). A step on a wild tile
 * rolls against the zone's rate times the multipliers of the key items the player owns; the entry is
 * picked by weight and its level is clamped to the player's level ± 2 and the entry's range.
 */
import type { EncounterEntry, KeyItemDef, ZoneDef } from './world.ts';

/** Wild NPC levels stay within this many levels of the player (10.2). */
export const WILD_LEVEL_WINDOW = 2;

/** Chance per wild step: the zone rate times every owned key item's multiplier, within [0, 1]. */
export function encounterRate(
  zone: Pick<ZoneDef, 'encounterRate'>,
  keyItems: readonly string[],
  defs: ReadonlyMap<string, KeyItemDef>,
): number {
  let rate = zone.encounterRate;
  for (const id of new Set(keyItems)) {
    const m = defs.get(id)?.encounterRate;
    if (m !== undefined && Number.isFinite(m) && m >= 0) rate *= m;
  }
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
}

/** Pick an entry by weight with `r` in [0, 1). Null when no entry has a positive weight. */
export function pickEntry(entries: readonly EncounterEntry[], r: number): EncounterEntry | null {
  let total = 0;
  for (const e of entries) if (e.weight > 0) total += e.weight;
  if (total <= 0) return null;
  let target = r * total;
  let last: EncounterEntry | null = null;
  for (const e of entries) {
    if (!(e.weight > 0)) continue;
    last = e;
    if (target < e.weight) return e;
    target -= e.weight;
  }
  return last;
}

/**
 * The wild NPC's level: uniform over the entry range intersected with the player's level ± 2. When
 * they do not overlap, the player's window wins (the nearest level in it), so a wild fight is never
 * far above or below the player.
 */
export function wildLevel(entry: EncounterEntry, playerLevel: number, r: number): number {
  const wLo = playerLevel - WILD_LEVEL_WINDOW;
  const wHi = playerLevel + WILD_LEVEL_WINDOW;
  const lo = Math.max(entry.levels[0], wLo);
  const hi = Math.min(entry.levels[1], wHi);
  let level: number;
  if (lo <= hi) level = lo + Math.min(hi - lo, Math.floor(r * (hi - lo + 1)));
  else level = entry.levels[0] > wHi ? wHi : wLo;
  return Math.min(100, Math.max(1, Math.round(level)));
}
