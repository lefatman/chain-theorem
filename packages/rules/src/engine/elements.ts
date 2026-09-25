/**
 * Element relationships (R-ELEM-001, R-ELEM-002, spec 6): two rock-paper-scissors triangles.
 * Ember beats Grove beats Tide beats Ember; Storm beats Frost beats Stone beats Storm.
 * An element's only disadvantage is against its foil. Neutral has no relationships.
 */
import type { ElementId } from '../types.ts';

const BEATS: Readonly<Record<ElementId, ElementId | null>> = {
  ember: 'grove',
  grove: 'tide',
  tide: 'ember',
  storm: 'frost',
  frost: 'stone',
  stone: 'storm',
  neutral: null,
};

/** True when element `a` beats element `b`. */
export function beats(a: ElementId, b: ElementId): boolean {
  return BEATS[a] === b;
}

/** The element that beats `e` (its foil), or null for neutral. */
export function foilOf(e: ElementId): ElementId | null {
  for (const [k, v] of Object.entries(BEATS) as [ElementId, ElementId | null][])
    if (v === e) return k;
  return null;
}
