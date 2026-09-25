/**
 * Loadout editing helpers for the builder (R-LOAD-003, R-LOAD-004, R-ELEM-004). These only shape the
 * draft (item swaps, set count, element count); the engine's validateLoadout stays the single judge
 * of legality, and the builder shows its errors verbatim.
 */
import { CAPS, abilityById, itemById } from '@chain-theorem/content';
import { PIECE_TYPES, type ElementId, type Loadout, type PieceType } from '@chain-theorem/rules';

export function shapeOf(items: readonly string[]): {
  capacity: number;
  perTypeSets: boolean;
  secondElement: boolean;
  consumed: number;
} {
  let capacity: number = CAPS.BASE_ABILITY_CAPACITY;
  let perTypeSets = false;
  let secondElement = false;
  let consumed = 0;
  for (const id of items) {
    const def = itemById.get(id);
    if (!def) continue;
    consumed += def.slotCost;
    if (def.capacity !== undefined) capacity = Math.max(capacity, def.capacity);
    if (def.grants?.perTypeSets) perTypeSets = true;
    if (def.grants?.secondElement) secondElement = true;
  }
  return {
    capacity: Math.min(capacity, CAPS.MAX_ABILITY_CAPACITY),
    perTypeSets,
    secondElement,
    consumed,
  };
}

/** Lowest level at which `slots` item slots are unlocked (7.1), or null past the cap. */
export function levelForSlots(slots: number): number | null {
  for (let l = 1; l <= CAPS.LEVEL_CAP; l++) if (CAPS.itemSlots(l) >= slots) return l;
  return null;
}

function firstOtherElement(taken: readonly ElementId[]): ElementId {
  return (
    CAPS.ENABLED_ELEMENTS.find((e) => !taken.includes(e)) ?? CAPS.ENABLED_ELEMENTS[0] ?? 'ember'
  );
}

/** Re-fit sets and elements after the item list changed (Schedule, Blended Family, DD-13). */
function refit(prev: Loadout, items: string[]): Loadout {
  const shape = shapeOf(items);
  const sets =
    !shape.perTypeSets && prev.sets.length === 6 ? [[...(prev.sets[0] ?? [])]] : prev.sets;
  const a = prev.elements[0] ?? CAPS.ENABLED_ELEMENTS[0] ?? 'ember';
  const elements: ElementId[] = shape.secondElement
    ? [a, prev.elements[1] && prev.elements[1] !== a ? prev.elements[1] : firstOtherElement([a])]
    : [a];
  const itemParams: NonNullable<Loadout['itemParams']> = {};
  for (const id of items) {
    const def = itemById.get(id);
    if (def?.param?.element !== 'required') continue;
    itemParams[id] = prev.itemParams?.[id] ?? { element: firstOtherElement(elements) };
  }
  const next: Loadout = { elements, items, sets };
  if (Object.keys(itemParams).length > 0) next.itemParams = itemParams;
  return next;
}

/** Equip an item; another item of the same exclusive group (capacity) is replaced (7.4 rule 3). */
export function equipItem(l: Loadout, id: string): Loadout {
  const def = itemById.get(id);
  if (!def || l.items.includes(id)) return l;
  const kept = def.exclusiveGroup
    ? l.items.filter((x) => itemById.get(x)?.exclusiveGroup !== def.exclusiveGroup)
    : l.items;
  return refit(l, [...kept, id]);
}

export function unequipItem(l: Loadout, id: string): Loadout {
  if (!l.items.includes(id)) return l;
  return refit(
    l,
    l.items.filter((x) => x !== id),
  );
}

/** The item this one would replace (same exclusive group), if any. */
export function replacedBy(l: Loadout, id: string): string | null {
  const g = itemById.get(id)?.exclusiveGroup;
  if (!g) return null;
  return l.items.find((x) => x !== id && itemById.get(x)?.exclusiveGroup === g) ?? null;
}

/** Why an item cannot be equipped right now, or null. */
export function itemBlock(l: Loadout, level: number, id: string): string | null {
  const def = itemById.get(id);
  if (!def) return 'Unknown item';
  if (def.retired) return 'Retired';
  if (l.items.includes(id)) return null;
  if (def.minLevel > level) return `Needs level ${def.minLevel}`;
  const swapped = replacedBy(l, id);
  const freed = swapped ? (itemById.get(swapped)?.slotCost ?? 0) : 0;
  const free = CAPS.itemSlots(level) - shapeOf(l.items).consumed + freed;
  if (def.slotCost > free)
    return `Needs ${def.slotCost} free slot${def.slotCost > 1 ? 's' : ''} (${Math.max(0, free)} free)`;
  return null;
}

/** Switch between one army-wide set and six per-type sets (Multitasker's Schedule, 7.3). */
export function setPerType(l: Loadout, on: boolean): Loadout {
  if (on && l.sets.length !== 6)
    return { ...l, sets: PIECE_TYPES.map(() => [...(l.sets[0] ?? [])]) };
  if (!on && l.sets.length === 6) return { ...l, sets: [[...(l.sets[0] ?? [])]] };
  return l;
}

export function setCost(set: readonly string[]): number {
  return set.reduce((n, id) => n + (abilityById.get(id)?.slotCost ?? 1), 0);
}

/** Why an ability cannot be added to a set right now, or null. */
export function abilityBlock(
  set: readonly string[],
  capacity: number,
  level: number,
  id: string,
): string | null {
  const def = abilityById.get(id);
  if (!def) return 'Unknown ability';
  if (def.retired) return 'Retired';
  if (set.includes(id)) return 'Already in this set';
  if (def.minLevel > level) return `Needs level ${def.minLevel}`;
  const left = capacity - setCost(set);
  if (def.slotCost > left)
    return left <= 0 ? `Set is full (${capacity})` : `Needs ${def.slotCost} free`;
  return null;
}

export function editSet(l: Loadout, index: number, fn: (set: string[]) => string[]): Loadout {
  return { ...l, sets: l.sets.map((s, i) => (i === index ? fn([...s]) : s)) };
}

/** Move an ability inside a set: order is resolution order (5.4). */
export function moveInSet(set: readonly string[], from: number, to: number): string[] {
  const out = [...set];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  if (x !== undefined) out.splice(to, 0, x);
  return out;
}

/** The piece type a set applies to (null = army-wide). */
export function setType(l: Loadout, index: number): PieceType | null {
  return l.sets.length === 6 ? (PIECE_TYPES[index] ?? null) : null;
}
