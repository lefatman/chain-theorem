/**
 * Balance simulator (17.2, R-TEST-002): the builds it plays are legal for every enabled element and
 * archetype, the archetype suite plays every element pair with both colours, and a simulated battle
 * is deterministic. The balance numbers themselves are in docs/BALANCE_M7.md.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ElementId } from '@chain-theorem/rules';
import { CAPS, abilities, engine } from '@chain-theorem/content';
import {
  ARCHETYPES,
  archetypeElements,
  assertValid,
  buildLoadout,
  elementLoadout,
  setPool,
} from './builds.ts';
import { playSim } from './play.ts';

const ELEMENTS = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
const affinity = new Map(abilities.map((a) => [a.id, a.affinity]));

afterEach(() => setPool('any'));

describe('balance simulator (R-TEST-002)', () => {
  it('R-TEST-002 the archetype suite plays every element pair with both colour assignments', () => {
    for (const els of [ELEMENTS, ELEMENTS.slice(0, 3)]) {
      const colours = new Map<string, Set<boolean>>();
      for (let i = 0; i < 2 * els.length; i++) {
        const [e1, e2] = archetypeElements(els, i);
        expect(e1).not.toBe(e2);
        const key = `${e1}+${e2}`;
        colours.set(key, (colours.get(key) ?? new Set()).add(i % 2 === 0));
      }
      expect(colours.size).toBe(els.length);
      for (const seen of colours.values()) expect([...seen].sort()).toEqual([false, true]);
    }
  });

  it('R-TEST-002 6.5 every simulator build is a legal level-25 loadout for all six elements', () => {
    expect(ELEMENTS).toEqual(['ember', 'tide', 'grove', 'storm', 'stone', 'frost']);
    for (const pool of ['any', 'affinity'] as const) {
      setPool(pool);
      ELEMENTS.forEach((a, i) => {
        const b = ELEMENTS[(i + 1) % ELEMENTS.length] as ElementId;
        for (const arch of ARCHETYPES)
          expect(() => assertValid(buildLoadout(arch, a, b), 25)).not.toThrow();
        expect(() => assertValid(elementLoadout(a), 25)).not.toThrow();
      });
    }
  });

  it('R-TEST-002 6.5 with pool affinity, each element build plays four cards of its own element', () => {
    setPool('affinity');
    for (const e of ELEMENTS) {
      const set = elementLoadout(e).sets[0] ?? [];
      expect(set.filter((id) => affinity.get(id) === e).length, e).toBeGreaterThanOrEqual(4);
      for (const id of set) expect(['neutral', e]).toContain(affinity.get(id));
    }
  });

  it('R-TEST-002 a simulated battle between new elements is deterministic', () => {
    const game = {
      format: 'first_blood' as const,
      white: { loadout: elementLoadout('storm'), level: 25, tier: 'trainer' as const },
      black: { loadout: elementLoadout('frost'), level: 25, tier: 'trainer' as const },
      nodes: 400,
      maxPlies: 40,
      seed: 7,
    };
    const first = playSim(engine, game);
    expect(first.plies).toBeGreaterThan(0);
    expect(playSim(engine, game)).toEqual(first);
  });
});
