/**
 * Random valid loadouts for fuzzing and simulation. Built from module data and CAPS only, then
 * checked with engine.validateLoadout (R-LOAD-004), so every loadout produced is legal to play.
 */
import { PIECE_TYPES, type Engine, type Loadout } from '@chain-theorem/rules';
import type { AbilityDef, ItemDef } from '@chain-theorem/rules/sdk';
import type { Rng } from './rng.ts';

export function randomLoadout(engine: Engine, rng: Rng, level: number): Loadout {
  const caps = engine.caps;
  const items = engine.registry.items.filter((i) => !i.retired && i.minLevel <= level);
  const abilities = engine.registry.abilities.filter((a) => !a.retired && a.minLevel <= level);
  for (let attempt = 0; attempt < 50; attempt++) {
    const budget = caps.itemSlots(level);
    const chosen: ItemDef[] = [];
    let used = 0;
    const groups = new Set<string>();
    for (const item of rng.shuffle([...items])) {
      if (!rng.chance(0.45)) continue;
      if (used + item.slotCost > budget) continue;
      if (item.exclusiveGroup && groups.has(item.exclusiveGroup)) continue;
      chosen.push(item);
      used += item.slotCost;
      if (item.exclusiveGroup) groups.add(item.exclusiveGroup);
    }
    const capacity = Math.max(caps.BASE_ABILITY_CAPACITY, ...chosen.map((i) => i.capacity ?? 0));
    const perType = chosen.some((i) => i.grants?.perTypeSets) && rng.chance(0.7);
    const blended = chosen.some((i) => i.grants?.secondElement);
    const els = rng.shuffle([...caps.ENABLED_ELEMENTS]);
    const elements = blended ? [els[0], els[1]] : [els[0]];
    const itemParams: NonNullable<Loadout['itemParams']> = {};
    for (const i of chosen)
      if (i.param?.element === 'required')
        itemParams[i.id] = { element: rng.pick(caps.ENABLED_ELEMENTS) };
    const makeSet = (): string[] => {
      const set: string[] = [];
      let cost = 0;
      for (const a of rng.shuffle([...abilities]) as AbilityDef[]) {
        if (cost + a.slotCost > capacity) continue;
        if (!rng.chance(0.6)) continue;
        set.push(a.id);
        cost += a.slotCost;
      }
      return set;
    };
    const sets = perType ? PIECE_TYPES.map(() => makeSet()) : [makeSet()];
    const loadout: Loadout = {
      elements: elements.filter((e): e is NonNullable<typeof e> => e !== undefined),
      items: chosen.map((i) => i.id),
      sets,
    };
    if (Object.keys(itemParams).length > 0) loadout.itemParams = itemParams;
    if (engine.validateLoadout(loadout, { level }).ok) return loadout;
  }
  return { elements: [caps.ENABLED_ELEMENTS[0] ?? 'ember'], items: [], sets: [[]] };
}
