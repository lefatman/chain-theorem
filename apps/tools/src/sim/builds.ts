/**
 * Representative loadouts for the balance simulator (3.4, 7.3, 17.2). Built from module data only:
 * abilities are ranked by affinity match and category spread, so new content is picked up without
 * changes here.
 */
import { PIECE_TYPES, type ElementId, type Loadout, type PieceType } from '@chain-theorem/rules';
import type { AbilityDef } from '@chain-theorem/rules/sdk';
import { abilities, engine } from '@chain-theorem/content';

export type Archetype = 'maximum' | 'flexible' | 'focused' | 'starter';
/** Ability pool for simulator builds: 'any' ranks every ability, 'affinity' keeps each element to its own and neutral abilities. */
export type Pool = 'any' | 'affinity';
let POOL: Pool = 'any';
export function setPool(p: Pool): void {
  POOL = p;
}
export const ARCHETYPES: Archetype[] = ['maximum', 'flexible', 'focused', 'starter'];

function eligible(a: AbilityDef, t: PieceType | 'all'): boolean {
  if (t === 'all') return true;
  return a.eligible === 'all' || a.eligible.includes(t);
}

/** Fill up to `n` slots with abilities for an element and piece type, preferring its own affinity. */
export function pickAbilities(
  element: ElementId,
  /** Capacity in slots. */
  n: number,
  level: number,
  type: PieceType | 'all' = 'all',
): string[] {
  const pool = abilities
    .filter(
      (a) => !a.retired && a.minLevel <= level && a.category !== 'PASSIVE' && eligible(a, type),
    )
    .filter((a) => POOL === 'any' || a.affinity === element || a.affinity === 'neutral')
    .map((a) => ({
      a,
      score:
        (a.affinity === element ? 10 : a.affinity === 'neutral' ? 2 : 0) +
        (a.category === 'CAPTURED' ? 1.5 : a.category === 'CAPTURES' ? 1 : 0.5) -
        a.minLevel / 100,
    }))
    .sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1));
  // `n` is the set's capacity in slots (7.3): abilities fill it by slotCost, not by count.
  const out: string[] = [];
  const cats = new Map<string, number>();
  let used = 0;
  for (const { a } of pool) {
    if (used >= n) break;
    if (used + a.slotCost > n) continue;
    if ((cats.get(a.category) ?? 0) + a.slotCost > Math.ceil(n / 2)) continue;
    out.push(a.id);
    used += a.slotCost;
    cats.set(a.category, (cats.get(a.category) ?? 0) + a.slotCost);
  }
  if (type === 'king' && n >= 2 && level >= 16 && out.length > 0) {
    // Stalwart (1 slot) replaces the last pick, which costs at least 1.
    out[out.length - 1] = 'stalwart';
  }
  return out;
}

export function buildLoadout(arch: Archetype, a: ElementId, b: ElementId, level = 25): Loadout {
  switch (arch) {
    case 'maximum':
      return {
        elements: [a, b],
        items: ['headmaster_ring', 'multitaskers_schedule', 'blended_family'],
        sets: PIECE_TYPES.map((t) =>
          pickAbilities(t === 'rook' || t === 'queen' || t === 'king' ? b : a, 5, level, t),
        ),
      };
    case 'flexible':
      return {
        elements: [a, b],
        items: [
          'journeymans_medallion',
          'multitaskers_schedule',
          'blended_family',
          'resonance_crystal',
        ],
        sets: PIECE_TYPES.map((t) =>
          pickAbilities(t === 'rook' || t === 'queen' || t === 'king' ? b : a, 4, level, t),
        ),
      };
    case 'focused':
      return {
        elements: [a],
        items: ['headmaster_ring', 'resonance_crystal', 'scouts_lens'],
        sets: [pickAbilities(a, 5, level)],
      };
    case 'starter':
      return {
        elements: [a],
        items: ['dual_adepts_glove'],
        sets: [pickAbilities(a, 2, Math.min(level, 5))],
      };
  }
}

/** Mono-element build used for element matchups (isolates the element relationship). */
export function elementLoadout(element: ElementId): Loadout {
  return buildLoadout('focused', element, element);
}

export function assertValid(l: Loadout, level: number): Loadout {
  const v = engine.validateLoadout(l, { level });
  if (!v.ok)
    throw new Error(`simulator build is invalid: ${v.errors.map((e) => e.message).join('; ')}`);
  return l;
}
