/**
 * The loadout a player fights with in the overworld (M5, DD-78): the most recently saved loadout that
 * is legal right now (R-LOAD-004, rechecked because levels and collections change), else one built
 * from the player's own collection, so a new player can battle before opening the loadout builder.
 */
import { CAPS, abilities, engine, items } from '@chain-theorem/content';
import type { ElementId, Loadout, PlayerFacts } from '@chain-theorem/rules';

export interface SavedLoadout {
  loadout: unknown;
  updatedAt: number;
}

/**
 * A legal loadout from owned modules only: the element with the most owned abilities, the owned
 * capacity item with the largest capacity that fits the slots, and owned abilities (that element
 * first, then neutral, then others) up to the capacity. Falls back to fewer modules until legal.
 */
export function autoLoadout(facts: PlayerFacts): Loadout {
  const level = facts.level;
  const owned = new Set(facts.ownedAbilities ?? []);
  const ownedItems = new Set(facts.ownedItems ?? []);
  const enabled = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
  const usable = abilities.filter((a) => !a.retired && a.minLevel <= level && owned.has(a.id));
  const count = (el: ElementId) => usable.filter((a) => a.affinity === el).length;
  const element = [...enabled].sort((a, b) => count(b) - count(a))[0] ?? 'ember';
  const slots = CAPS.itemSlots(level);
  const cap = items
    .filter(
      (i) =>
        !i.retired &&
        i.capacity !== undefined &&
        i.minLevel <= level &&
        i.slotCost <= slots &&
        ownedItems.has(i.id),
    )
    .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0) || (a.id < b.id ? -1 : 1))[0];
  const rank = (aff: string) => (aff === element ? 0 : aff === 'neutral' ? 1 : 2);
  const ordered = [...usable].sort(
    (a, b) => rank(a.affinity) - rank(b.affinity) || (a.id < b.id ? -1 : 1),
  );
  const fill = (capacity: number): string[] => {
    const out: string[] = [];
    let used = 0;
    for (const a of ordered) {
      if (used + a.slotCost > capacity) continue;
      out.push(a.id);
      used += a.slotCost;
    }
    return out;
  };
  const tries: Loadout[] = [
    ...(cap ? [{ elements: [element], items: [cap.id], sets: [fill(cap.capacity ?? 1)] }] : []),
    { elements: [element], items: [], sets: [fill(1)] },
    { elements: [element], items: [], sets: [[]] },
  ];
  for (const l of tries) if (engine.validateLoadout(l, facts).ok) return l;
  return { elements: [element], items: [], sets: [[]] };
}

/** The newest saved loadout that is legal now, else `autoLoadout`. */
export function fightingLoadout(saved: readonly SavedLoadout[], facts: PlayerFacts): Loadout {
  const newest = [...saved].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of newest) {
    const l = s.loadout as Loadout;
    if (engine.validateLoadout(l, facts).ok) return l;
  }
  return autoLoadout(facts);
}
