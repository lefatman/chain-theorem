/**
 * Dossier deductions (R-INFO-003). Facts the engine can prove from public information only:
 * enumerate every item combination consistent with the opponent's consumed slots, displayed
 * elements, level, revealed items and the abilities seen per piece type, then report what holds in
 * all of them. Example (8.3): 1 slot consumed and two abilities seen on pawns means Dual Adept's Glove
 * and no Schedule.
 */
import { opposite } from '../board.ts';
import type { ItemDef } from '../sdk/types.ts';
import { type PieceType, type Side, PIECE_TYPES } from '../types.ts';
import type { PublicState } from './project.ts';
import type { Runtime } from './runtime.ts';

export interface Deductions {
  /** The side the deductions are about (the viewer's opponent). */
  side: Side;
  /** Number of item combinations consistent with everything public. */
  combinations: number;
  /** Items present in every consistent combination. */
  certainItems: string[];
  /** Items that appear in no consistent combination (among those the opponent's level allows). */
  impossibleItems: string[];
  capacity: { min: number; max: number };
  schedule: 'yes' | 'no' | 'unknown';
  blended: 'yes' | 'no' | 'unknown';
  /** Minimum ability capacity implied by abilities seen on one piece type. */
  observedCapacity: number;
  /** Plain-language lines for newcomers (8.3). */
  hints: string[];
  /** True when enumeration was cut short (never silently: shown in the UI). */
  truncated: boolean;
}

const MAX_COMBINATIONS = 200_000;

export function deduce(rt: Runtime, pub: PublicState): Deductions {
  const side = opposite(pub.viewer);
  const army = pub.armies[side];
  const known = army.revealed;
  const level = army.level;
  const caps = rt.caps;

  // Abilities observed per piece type and the capacity they imply.
  let observedCapacity = caps.BASE_ABILITY_CAPACITY;
  const seen: Partial<Record<PieceType, string[]>> = known.abilities;
  for (const t of PIECE_TYPES) {
    const cost = (seen[t] ?? []).reduce(
      (sum, id) => sum + (rt.abilities.get(id)?.slotCost ?? 1),
      0,
    );
    observedCapacity = Math.max(observedCapacity, cost);
  }
  // Schedule is proven when two piece types provably hold different sets.
  let scheduleProven = false;
  for (const a of PIECE_TYPES) {
    for (const b of PIECE_TYPES) {
      if (a === b || !known.complete.includes(b)) continue;
      const full = seen[b] ?? [];
      if ((seen[a] ?? []).some((id) => !full.includes(id))) scheduleProven = true;
    }
  }
  const displayedTwo = army.elements.length === 2;

  const candidates: ItemDef[] = [...rt.items.values()]
    .filter((i) => !i.retired && i.minLevel <= level)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const combos: ItemDef[][] = [];
  let truncated = false;
  const pick: ItemDef[] = [];
  const target = army.consumedSlots;

  const consistent = (combo: ItemDef[]): boolean => {
    const ids = combo.map((i) => i.id);
    if (!known.items.every((id) => ids.includes(id))) return false;
    if (known.allItems && ids.length !== known.items.length) return false;
    let capacity = caps.BASE_ABILITY_CAPACITY;
    let perType = false;
    let second = false;
    let disguise = false;
    for (const i of combo) {
      if (i.capacity !== undefined) capacity = Math.max(capacity, i.capacity);
      if (i.grants?.perTypeSets) perType = true;
      if (i.grants?.secondElement) second = true;
      if (i.hooks.revealFilter?.element) disguise = true;
    }
    if (capacity < observedCapacity) return false;
    if (scheduleProven && !perType) return false;
    // Two displayed elements can only come from Blended Family: a disguise shows one element (DD-26).
    if (displayedTwo && !second) return false;
    // One displayed element rules Blended Family out unless a disguise could be hiding it.
    if (!displayedTwo && second && !disguise) return false;
    return true;
  };

  const walk = (start: number, cost: number, groups: Set<string>): void => {
    if (truncated) return;
    if (cost === target) {
      if (consistent(pick)) {
        combos.push([...pick]);
        if (combos.length >= MAX_COMBINATIONS) truncated = true;
      }
      return;
    }
    for (let i = start; i < candidates.length; i++) {
      const item = candidates[i] as ItemDef;
      if (cost + item.slotCost > target) continue;
      if (item.exclusiveGroup && groups.has(item.exclusiveGroup)) continue;
      pick.push(item);
      if (item.exclusiveGroup) groups.add(item.exclusiveGroup);
      walk(i + 1, cost + item.slotCost, groups);
      if (item.exclusiveGroup) groups.delete(item.exclusiveGroup);
      pick.pop();
    }
  };
  walk(0, 0, new Set());

  const count = new Map<string, number>();
  let capMin = Infinity;
  let capMax = -Infinity;
  let withSchedule = 0;
  let withBlended = 0;
  for (const combo of combos) {
    let capacity = caps.BASE_ABILITY_CAPACITY;
    let perType = false;
    let second = false;
    for (const i of combo) {
      count.set(i.id, (count.get(i.id) ?? 0) + 1);
      if (i.capacity !== undefined) capacity = Math.max(capacity, i.capacity);
      if (i.grants?.perTypeSets) perType = true;
      if (i.grants?.secondElement) second = true;
    }
    capMin = Math.min(capMin, capacity);
    capMax = Math.max(capMax, capacity);
    if (perType) withSchedule++;
    if (second) withBlended++;
  }
  const n = combos.length;
  // With no consistent combination, or a truncated enumeration, nothing is provable (R-INFO-003).
  const sound = n > 0 && !truncated;
  const certainItems = sound
    ? [...count.entries()]
        .filter(([, c]) => c === n)
        .map(([id]) => id)
        .sort()
    : [];
  const impossibleItems = sound ? candidates.filter((i) => !count.has(i.id)).map((i) => i.id) : [];
  const tri = (k: number): 'yes' | 'no' | 'unknown' =>
    !sound ? 'unknown' : k === n ? 'yes' : k === 0 ? 'no' : 'unknown';
  const schedule = tri(withSchedule);
  const blended = tri(withBlended);
  const capacity = sound
    ? { min: capMin, max: capMax }
    : { min: observedCapacity, max: caps.MAX_ABILITY_CAPACITY };

  const name = (id: string) => rt.items.get(id)?.name ?? id;
  const hints: string[] = [];
  hints.push(
    `${army.consumedSlots} item slot${army.consumedSlots === 1 ? '' : 's'} consumed at level ${level}.`,
  );
  if (observedCapacity > caps.BASE_ABILITY_CAPACITY) {
    hints.push(
      `${observedCapacity} ability slots seen on one piece type, so capacity is at least ${observedCapacity}.`,
    );
  }
  if (n === 0)
    hints.push(
      'No item combination fits the public facts (a disguise or an unknown item may be in play).',
    );
  else if (n === 1)
    hints.push(
      `Only one item combination fits: ${(combos[0] ?? []).map((i) => name(i.id)).join(', ') || 'no items'}.`,
    );
  for (const id of certainItems)
    if (!known.items.includes(id)) hints.push(`${name(id)} must be equipped.`);
  if (capacity.min === capacity.max && n > 0)
    hints.push(`Ability capacity is exactly ${capacity.min}.`);
  if (schedule === 'no')
    hints.push("No Multitasker's Schedule: every piece type shares one ability set.");
  if (schedule === 'yes')
    hints.push("Multitasker's Schedule is equipped: piece types may use separate sets.");
  if (truncated) hints.push('Too many combinations to list them all; deductions are partial.');
  return {
    side,
    combinations: n,
    certainItems,
    impossibleItems,
    capacity,
    schedule,
    blended,
    observedCapacity,
    hints,
    truncated,
  };
}
