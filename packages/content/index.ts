/**
 * @chain-theorem/content — every ability, item and trait module (13.5), the global caps, and a ready
 * engine: `createEngine(registry, CAPS)`. `rules` never imports this package.
 */
import { canonicalJson, createEngine, fnv1a64, type Engine } from '@chain-theorem/rules';
import type { Caps, ContentRegistry } from '@chain-theorem/rules/sdk';
import { CAPS } from './config.ts';
import { abilities, items, traits } from './registry.generated.ts';

/** Content version recorded in every battle so replays load the same module versions (13.5). */
export const CONTENT_VERSION = (() => {
  const ids = {
    a: abilities.map((m) => [m.id, m.version]),
    i: items.map((m) => [m.id, m.version]),
    t: traits.map((m) => [m.id, m.version]),
  };
  const [hi, lo] = fnv1a64(canonicalJson(ids));
  return `c1-${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
})();

export const registry: ContentRegistry = { abilities, items, traits, version: CONTENT_VERSION };

export const engine: Engine = createEngine(registry, CAPS);

/** An engine with caps overrides (tests, simulator tuning such as silenceScope). */
export function makeEngine(overrides: Partial<Caps> = {}): Engine {
  return createEngine(registry, { ...CAPS, ...overrides });
}

export const abilityById = new Map(abilities.map((a) => [a.id, a]));
export const itemById = new Map(items.map((i) => [i.id, i]));
export const traitById = new Map(traits.map((t) => [t.id, t]));

export * from './config.ts';
export { abilities, items, traits };
