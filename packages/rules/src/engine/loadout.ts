/**
 * Loadout model and validation (R-LOAD-003, R-LOAD-004 INVARIANT at battle start, R-ELEM-004).
 * Every limit comes from CAPS and module data (13.5); no item or ability id appears here. Rule 9
 * (7.4, DD-109): an ability with `kingItemSlots` in the set that applies to the king adds them to
 * rule 1's item slot total, which stays public (8.1).
 */
import type { AbilityDef, Caps, ItemDef } from '../sdk/types.ts';
import {
  type Loadout,
  type LoadoutError,
  type LoadoutValidation,
  type PieceType,
  type PlayerFacts,
  PIECE_TYPES,
} from '../types.ts';

export interface LoadoutShape {
  capacity: number;
  perTypeSets: boolean;
  secondElement: boolean;
  /** Item slot cost of the items plus `kingSlots` (rule 1 with rule 9; public, 8.1). */
  consumedSlots: number;
  /** Item slots added by abilities in the king's set (rule 9, DD-109); 0 without `abilities`. */
  kingSlots: number;
}

/** The set that applies to the king: the sixth per-type set, or the army-wide set (7.3). */
export function kingSet(loadout: Loadout): readonly string[] {
  return (loadout.sets.length === 6 ? loadout.sets[5] : loadout.sets[0]) ?? [];
}

/**
 * Item slots the king's set adds to the loadout's item slot total (7.4 rule 9, DD-109): the sum of
 * `kingItemSlots` over the abilities it holds (Stalwart on a king costs one item slot).
 */
export function kingSlotCost(loadout: Loadout, abilities: ReadonlyMap<string, AbilityDef>): number {
  let n = 0;
  for (const id of new Set(kingSet(loadout))) n += abilities.get(id)?.kingItemSlots ?? 0;
  return n;
}

/** Names of the abilities in the king's set that add item slots (rule 9), in set order. */
function kingSlotPayers(loadout: Loadout, abilities: ReadonlyMap<string, AbilityDef>): string {
  const names: string[] = [];
  for (const id of new Set(kingSet(loadout))) {
    const def = abilities.get(id);
    if (def?.kingItemSlots) names.push(def.name);
  }
  return names.join(' and ');
}

export function loadoutShape(
  loadout: Loadout,
  items: ReadonlyMap<string, ItemDef>,
  caps: Caps,
  abilities?: ReadonlyMap<string, AbilityDef>,
): LoadoutShape {
  let capacity = caps.BASE_ABILITY_CAPACITY;
  let perTypeSets = false;
  let secondElement = false;
  let consumedSlots = 0;
  for (const id of loadout.items) {
    const def = items.get(id);
    if (!def) continue;
    consumedSlots += def.slotCost;
    if (def.capacity !== undefined) capacity = Math.max(capacity, def.capacity);
    if (def.grants?.perTypeSets) perTypeSets = true;
    if (def.grants?.secondElement) secondElement = true;
  }
  const kingSlots = abilities ? kingSlotCost(loadout, abilities) : 0;
  return {
    capacity: Math.min(capacity, caps.MAX_ABILITY_CAPACITY),
    perTypeSets,
    secondElement,
    consumedSlots: consumedSlots + kingSlots,
    kingSlots,
  };
}

/** Expand 1 army-wide set, or 6 per-type sets, into a set per piece type (7.3). */
export function expandSets(sets: readonly (readonly string[])[]): Record<PieceType, string[]> {
  const out = {} as Record<PieceType, string[]>;
  PIECE_TYPES.forEach((t, i) => {
    const set = sets.length === 6 ? sets[i] : sets[0];
    out[t] = [...(set ?? [])];
  });
  return out;
}

export function validateLoadout(
  loadout: Loadout,
  player: PlayerFacts,
  abilities: ReadonlyMap<string, AbilityDef>,
  items: ReadonlyMap<string, ItemDef>,
  caps: Caps,
): LoadoutValidation {
  const errors: LoadoutError[] = [];
  const level = player.level;
  if (!Number.isInteger(level) || level < 1 || level > caps.LEVEL_CAP) {
    // Without a valid level, rules 1 and 2 cannot be checked: reject outright.
    return {
      ok: false,
      errors: [
        {
          rule: 2,
          code: 'bad_level',
          message: `level must be an integer from 1 to ${caps.LEVEL_CAP}`,
        },
      ],
      consumedSlots: 0,
      unlockedSlots: 0,
      capacity: caps.BASE_ABILITY_CAPACITY,
    };
  }
  const unlockedSlots = caps.itemSlots(level);
  const err = (
    rule: LoadoutError['rule'],
    code: LoadoutError['code'],
    message: string,
    ref?: string,
  ) => errors.push(ref === undefined ? { rule, code, message } : { rule, code, message, ref });

  // Items: known, owned, not retired, level, duplicates, exclusive groups (rules 1, 2, 3, 7).
  const seenItems = new Set<string>();
  const groups = new Map<string, string>();
  for (const id of loadout.items) {
    const def = items.get(id);
    if (!def) {
      err(7, 'unknown_item', `unknown item ${id}`, id);
      continue;
    }
    if (seenItems.has(id)) err(3, 'duplicate_item', `${def.name} is equipped twice`, id);
    seenItems.add(id);
    if (def.retired) err(7, 'retired', `${def.name} is retired`, id);
    if (player.ownedItems && !player.ownedItems.includes(id))
      err(7, 'not_owned', `you do not own ${def.name}`, id);
    if (def.minLevel > level) err(2, 'item_level', `${def.name} needs level ${def.minLevel}`, id);
    if (def.exclusiveGroup) {
      const other = groups.get(def.exclusiveGroup);
      if (other && other !== id)
        err(
          3,
          'exclusive_group',
          `${def.name} and ${other} are both ${def.exclusiveGroup} items`,
          id,
        );
      else groups.set(def.exclusiveGroup, id);
    }
    if (def.param?.element === 'required') {
      const el = loadout.itemParams?.[id]?.element;
      if (!el || !caps.ENABLED_ELEMENTS.includes(el))
        err(7, 'item_param', `${def.name} needs an element choice`, id);
    }
  }
  // Rule 1 counts the king's set too (rule 9, DD-109): kingSlots is public, like the item total.
  const shape = loadoutShape(loadout, items, caps, abilities);
  if (shape.consumedSlots > unlockedSlots) {
    const itemSlots = shape.consumedSlots - shape.kingSlots;
    const royal =
      shape.kingSlots > 0
        ? ` and ${kingSlotPayers(loadout, abilities)} on the king ${shape.kingSlots} more (rule 9)`
        : '';
    err(
      1,
      'slots_exceeded',
      `items use ${itemSlots} slot${itemSlots === 1 ? '' : 's'}${royal} but level ${level} unlocks ${unlockedSlots}`,
    );
  }

  // Sets (rules 4, 5).
  const setCount = loadout.sets.length;
  if (!(setCount === 1 || (setCount === 6 && shape.perTypeSets))) {
    err(
      5,
      'set_count',
      shape.perTypeSets
        ? 'use 1 army-wide set or 6 per-type sets'
        : "use exactly 1 ability set (6 need Multitasker's Schedule)",
    );
  }
  const checkedAbility = new Set<string>();
  loadout.sets.forEach((set, i) => {
    const label = setCount === 6 ? `${PIECE_TYPES[i]} set` : 'ability set';
    const inSet = new Set<string>();
    let cost = 0;
    for (const id of set) {
      const def = abilities.get(id);
      if (!def) {
        err(7, 'unknown_ability', `unknown ability ${id}`, id);
        continue;
      }
      if (inSet.has(id))
        err(4, 'duplicate_ability', `${def.name} appears twice in the ${label}`, id);
      inSet.add(id);
      cost += def.slotCost;
      if (checkedAbility.has(id)) continue;
      checkedAbility.add(id);
      if (def.retired) err(7, 'retired', `${def.name} is retired`, id);
      if (player.ownedAbilities && !player.ownedAbilities.includes(id))
        err(7, 'not_owned', `you do not own ${def.name}`, id);
      if (def.minLevel > level)
        err(2, 'ability_level', `${def.name} needs level ${def.minLevel}`, id);
    }
    if (cost > shape.capacity)
      err(
        4,
        'capacity_exceeded',
        `the ${label} uses ${cost} ability slots; capacity is ${shape.capacity}`,
      );
    // Rule 8 (DD-102): an ability that excludes categories shares no set with them.
    for (const id of inSet) {
      const def = abilities.get(id);
      if (!def?.excludes) continue;
      for (const other of inSet) {
        const o = abilities.get(other);
        if (o && other !== id && def.excludes.categories.includes(o.category))
          err(
            8,
            'excluded_category',
            `${def.name} cannot share the ${label} with ${o.name} (${o.category.toLowerCase()})`,
            id,
          );
      }
    }
  });

  // Elements (rule 6, R-ELEM-004).
  const els = loadout.elements;
  if (shape.secondElement) {
    if (els.length !== 2) err(6, 'elements_count', 'Blended Family needs two elements');
    else if (els[0] === els[1])
      err(6, 'elements_same', 'Blended Family needs two different elements');
  } else if (els.length !== 1) {
    err(6, 'elements_count', 'choose exactly one element (two need Blended Family)');
  }
  for (const el of els)
    if (!caps.ENABLED_ELEMENTS.includes(el))
      err(6, 'element_disabled', `${el} is not available`, el);

  return {
    ok: errors.length === 0,
    errors,
    consumedSlots: shape.consumedSlots,
    unlockedSlots,
    capacity: shape.capacity,
  };
}
