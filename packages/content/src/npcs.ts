/**
 * NPC loadouts (9.4, R-FMT-005): NPC loadouts are content data and follow the same rules as players'
 * (R-LOAD-004 at the NPC's level; reveals as usual). Wild: 1–2 abilities; Trainer: a themed build;
 * Elite: the fullest build its level allows. Built deterministically from a seed so a battle can be
 * reproduced; every result is validated before it is returned.
 */
import type { AbilityDef, ItemDef } from '@chain-theorem/rules/sdk';
import type { ElementId, Loadout } from '@chain-theorem/rules';
import { CAPS } from '../config.ts';
import { abilities, engine, items } from '../index.ts';

export type NpcTier = 'wild' | 'trainer' | 'elite';

export interface NpcBuild {
  name: string;
  level: number;
  loadout: Loadout;
}

const TIER_NAME: Record<NpcTier, string> = { wild: 'Wild', trainer: 'Trainer', elite: 'Elite' };
const ELEMENT_NAME: Record<string, string> = {
  ember: 'Ember',
  tide: 'Tide',
  grove: 'Grove',
  storm: 'Storm',
  stone: 'Stone',
  frost: 'Frost',
};

function pickElement(seed: number): ElementId {
  const els = CAPS.ENABLED_ELEMENTS;
  return els[Math.abs(seed) % els.length] as ElementId;
}

/**
 * Abilities an NPC of `element` at `level` would pick: own affinity first, then neutral, then any
 * other (low levels offer few abilities per element, as they do for players); triggered only.
 */
function candidates(element: ElementId, level: number): AbilityDef[] {
  const rank = (a: AbilityDef) => (a.affinity === element ? 0 : a.affinity === 'neutral' ? 1 : 2);
  return abilities
    .filter((a) => !a.retired && a.minLevel <= level && a.category !== 'PASSIVE')
    .sort((a, b) => rank(a) - rank(b) || b.minLevel - a.minLevel || (a.id < b.id ? -1 : 1));
}

/** The largest capacity item that fits `slots` at `level` (capacity N costs N − 1 slots). */
function capacityItem(level: number, slots: number): ItemDef | null {
  const caps = items
    .filter(
      (i) => !i.retired && i.capacity !== undefined && i.minLevel <= level && i.slotCost <= slots,
    )
    .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));
  return caps[0] ?? null;
}

function fill(element: ElementId, level: number, capacity: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const a of candidates(element, level)) {
    if (used + a.slotCost > capacity) continue;
    out.push(a.id);
    used += a.slotCost;
  }
  return out;
}

/**
 * A legal loadout for an NPC of `tier` at `level` (1..LEVEL_CAP). `seed` picks the element unless
 * `element` names an enabled one (a wild encounter entry's army, 10.2). Throws only if the catalogue
 * cannot produce a legal loadout at all (a content bug).
 */
export function npcBuild(
  tier: NpcTier,
  level: number,
  seed: number,
  element?: ElementId,
): NpcBuild {
  const lvl = Math.max(1, Math.min(CAPS.LEVEL_CAP, Math.floor(level)));
  const enabled = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
  const el = element && enabled.includes(element) ? element : pickElement(seed);
  const slots = CAPS.itemSlots(lvl);
  let loadout: Loadout;
  if (tier === 'wild') {
    // 1–2 abilities (9.4): a Dual Adept's Glove when it fits, else one ability.
    const glove = items.find((i) => i.id === 'dual_adepts_glove' && i.minLevel <= lvl);
    loadout = glove
      ? { elements: [el], items: [glove.id], sets: [fill(el, lvl, 2)] }
      : { elements: [el], items: [], sets: [fill(el, lvl, 1)] };
  } else {
    // Trainer: themed around one element with the best capacity item; Elite also adds utility items.
    const cap = capacityItem(lvl, slots);
    const chosen: string[] = cap ? [cap.id] : [];
    let used = cap?.slotCost ?? 0;
    if (tier === 'elite') {
      for (const id of ['resonance_crystal', 'scouts_lens']) {
        const it = items.find((i) => i.id === id && !i.retired && i.minLevel <= lvl);
        if (it && used + it.slotCost <= slots) {
          chosen.push(it.id);
          used += it.slotCost;
        }
      }
    }
    loadout = {
      elements: [el],
      items: chosen,
      sets: [fill(el, lvl, cap?.capacity ?? 1)],
    };
  }
  const v = engine.validateLoadout(loadout, { level: lvl });
  if (!v.ok) throw new Error(`npcBuild produced an illegal loadout: ${JSON.stringify(v.errors)}`);
  return {
    name: `${TIER_NAME[tier]} ${ELEMENT_NAME[el] ?? el} NPC`,
    level: lvl,
    loadout,
  };
}
