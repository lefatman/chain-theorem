/**
 * Balance simulator (17.2, R-TEST-002): the builds it plays are legal for every enabled element and
 * archetype, the archetype suite plays every element pair with both colours, and a simulated battle
 * is deterministic. The balance numbers themselves are in docs/BALANCE_M7.md.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BattleEvent, ElementId } from '@chain-theorem/rules';
import { CAPS, abilities, engine } from '@chain-theorem/content';
import {
  ARCHETYPES,
  archetypeElements,
  assertValid,
  buildLoadout,
  cardLoadouts,
  elementLoadout,
  pickAbilities,
  setPool,
} from './builds.ts';
import { decisiveAbilities, playSim } from './play.ts';

const ELEMENTS = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
const affinity = new Map(abilities.map((a) => [a.id, a.affinity]));
const category = new Map(abilities.map((a) => [a.id, a.category]));
const eligibleFor = new Map(abilities.map((a) => [a.id, a.eligible]));

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

  it('R-TEST-002 6.5 DD-98 with pool affinity, each element build plays its signature and otherwise neutral cards', () => {
    setPool('affinity');
    for (const e of ELEMENTS) {
      const set = elementLoadout(e).sets[0] ?? [];
      expect(set.filter((id) => affinity.get(id) === e).length, e).toBe(1);
      expect(set.length, e).toBeGreaterThanOrEqual(4);
      for (const id of set) expect(['neutral', e]).toContain(affinity.get(id));
    }
  });

  it('R-TEST-002 DD-98 a Focused build deals its five slots across all four categories: every element carries a Capturing card and a passive', () => {
    for (const e of ELEMENTS) {
      const set = elementLoadout(e).sets[0] ?? [];
      expect(set, e).toHaveLength(5);
      const cats = new Set(set.map((id) => category.get(id)));
      expect([...cats].sort(), e).toEqual(['CAPTURED', 'CAPTURES', 'CAPTURING', 'PASSIVE']);
      // The signature leads; the rest of an army-wide set is army-wide (7.3: a type-bound card
      // idles on the other types but still uses the slot).
      expect(affinity.get(set[0] ?? ''), e).toBe(e);
      for (const id of set.slice(1)) expect(eligibleFor.get(id), `${e} ${id}`).toBe('all');
    }
  });

  it("R-TEST-002 7.3 a piece type's set prefers cards built for it: Pawn Storm on pawns, Afterimage on knights", () => {
    const sets = buildLoadout('maximum', 'ember', 'tide').sets;
    expect(sets[0]).toContain('pawn_storm');
    expect(sets[1]).toContain('afterimage');
    expect(sets[0]).not.toContain('afterimage');
    for (const set of sets.slice(0, 5)) {
      const cats = new Set(set.map((id) => category.get(id)));
      expect([...cats].sort()).toEqual(['CAPTURED', 'CAPTURES', 'CAPTURING', 'PASSIVE']);
    }
  });

  it('R-TEST-002 DD-102 R-RULES-004 the king set from level 16 is Stalwart and passives: no Captured, Capturing or Captures card and no Obstinate', () => {
    for (const e of ELEMENTS) {
      const king = pickAbilities(e, 5, 25, 'king');
      expect(king[0], e).toBe('stalwart');
      expect(king, e).toContain('block_path');
      expect(king, e).not.toContain('obstinate');
      for (const id of king) expect(category.get(id), `${e} ${id}`).toBe('PASSIVE');
      const other = ELEMENTS[(ELEMENTS.indexOf(e) + 1) % ELEMENTS.length] as ElementId;
      expect(() => assertValid(buildLoadout('maximum', e, other), 25), e).not.toThrow();
    }
    // Below level 16 the king plays offensive cards and no Captured card.
    const young = pickAbilities('ember', 5, 15, 'king');
    expect(young).not.toContain('stalwart');
    expect(young.some((id) => category.get(id) === 'CAPTURES')).toBe(true);
    expect(young.some((id) => category.get(id) === 'CAPTURED')).toBe(false);
  });

  it('R-TEST-002 17.2 card mirror builds: for every card both sides are legal at level 25, the card leads one side and is missing from the other, and the other cards match', () => {
    const cards = abilities.filter((a) => !a.retired && a.minLevel <= 25);
    expect(cards.length).toBeGreaterThanOrEqual(30);
    for (const card of cards) {
      const element = (card.affinity === 'neutral' ? 'ember' : card.affinity) as ElementId;
      const { withCard, without } = cardLoadouts(card.id, element);
      expect(() => assertValid(withCard, 25), card.id).not.toThrow();
      expect(() => assertValid(without, 25), card.id).not.toThrow();
      const a = withCard.sets[0] ?? [];
      const b = without.sets[0] ?? [];
      expect(a[0], card.id).toBe(card.id);
      expect(b, card.id).not.toContain(card.id);
      expect(a.slice(1), card.id).toEqual(b);
      expect(b.length, card.id).toBeGreaterThanOrEqual(3);
      for (const cat of card.excludes?.categories ?? [])
        expect(
          b.map((id) => category.get(id)),
          card.id,
        ).not.toContain(cat);
    }
  });

  it('R-TEST-002 17.2 a surprise loss needs an unseen ability that acted: Scout naming a set is not one, an effect capture or an observed turn is', () => {
    const base = { i: 0, depth: 0 } as const;
    const src = (id: string, side: 'white' | 'black') =>
      ({ kind: 'ability', id, piece: 1, side }) as const;
    const scoutOnly = [
      {
        ...base,
        k: 'AbilityTriggered',
        side: 'white',
        piece: 1,
        pieceType: 'bishop',
        ability: 'scout',
        category: 'CAPTURING',
        attuned: false,
      },
      {
        ...base,
        k: 'Revealed',
        side: 'white',
        info: { kind: 'ability', pieceType: 'bishop', ability: 'scout' },
        cause: 'activated',
      },
      {
        ...base,
        k: 'Revealed',
        side: 'black',
        info: { kind: 'set', pieceType: 'pawn', abilities: ['last_word'] },
        cause: 'effect',
        source: src('scout', 'white'),
      },
      {
        ...base,
        k: 'Captured',
        victim: 9,
        victimSide: 'black',
        victimType: 'knight',
        square: 30,
        by: 'move',
        captor: 1,
      },
    ] as unknown as BattleEvent[];
    expect(decisiveAbilities(scoutOnly, 'white')).toEqual(new Set());
    const acted = [
      {
        ...base,
        k: 'Revealed',
        side: 'white',
        info: { kind: 'ability', pieceType: 'queen', ability: 'electric_slide' },
        cause: 'observed',
        source: src('electric_slide', 'white'),
      },
      {
        ...base,
        k: 'Captured',
        victim: 9,
        victimSide: 'black',
        victimType: 'pawn',
        square: 30,
        by: 'effect',
        captor: 1,
        source: src('cleave', 'white'),
      },
      {
        ...base,
        k: 'PieceMoved',
        piece: 9,
        side: 'black',
        from: 61,
        to: 2,
        source: src('snowdrift', 'white'),
      },
      // The loser's own reaction is not the winner's doing.
      {
        ...base,
        k: 'Captured',
        victim: 1,
        victimSide: 'white',
        victimType: 'bishop',
        square: 54,
        by: 'effect',
        captor: null,
        source: src('last_word', 'black'),
      },
    ] as unknown as BattleEvent[];
    expect([...decisiveAbilities(acted, 'white')].sort()).toEqual([
      'cleave',
      'electric_slide',
      'snowdrift',
    ]);
    expect([...decisiveAbilities(acted, 'black')]).toEqual(['last_word']);
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
