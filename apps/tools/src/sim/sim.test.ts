/**
 * Balance simulator (17.2, R-TEST-002): the builds it plays are legal for every enabled element and
 * archetype, the archetype suite plays every element pair with both colours, and a simulated battle
 * is deterministic. The balance numbers themselves are in docs/BALANCE_M7.md.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadoutShape, type BattleEvent, type ElementId, type Loadout } from '@chain-theorem/rules';
import { CAPS, abilities, engine, items } from '@chain-theorem/content';
import {
  ARCHETYPES,
  AS_WIDE,
  archetypeElements,
  assertValid,
  buildLoadout,
  cardLoadouts,
  elementLoadout,
  pickAbilities,
  setKing,
  setPool,
  setPrefer,
  setWithout,
} from './builds.ts';
import { decisiveAbilities, playSim } from './play.ts';
import { capsOverrides } from '../lib/caps.ts';

const ELEMENTS = CAPS.ENABLED_ELEMENTS as readonly ElementId[];
const affinity = new Map(abilities.map((a) => [a.id, a.affinity]));
const category = new Map(abilities.map((a) => [a.id, a.category]));
const eligibleFor = new Map(abilities.map((a) => [a.id, a.eligible]));
const slotCost = new Map(abilities.map((a) => [a.id, a.slotCost]));
const ITEMS = new Map(items.map((i) => [i.id, i]));
/** Slots a set uses (7.3: by slot cost, not by card). */
const slots = (set: readonly string[]): number =>
  set.reduce((s, id) => s + (slotCost.get(id) ?? 0), 0);
const passives = (set: readonly string[]): number =>
  set.filter((id) => category.get(id) === 'PASSIVE').length;
/** The ability capacity a loadout's items grant (the Headmaster Ring: 5). */
const capacityOf = (l: Loadout): number => loadoutShape(l, ITEMS, CAPS).capacity;
/** Every ordered pair of distinct enabled elements. */
const PAIRS: [ElementId, ElementId][] = ELEMENTS.flatMap((a) =>
  ELEMENTS.filter((b) => b !== a).map((b): [ElementId, ElementId] => [a, b]),
);
/** Every build the suites play at level 25: the four archetypes per element pair and the element builds. */
const allBuilds = (): { tag: string; loadout: Loadout }[] => [
  ...PAIRS.flatMap(([a, b]) =>
    ARCHETYPES.map((arch) => ({ tag: `${arch} ${a} ${b}`, loadout: buildLoadout(arch, a, b) })),
  ),
  ...ELEMENTS.map((e) => ({ tag: `element ${e}`, loadout: elementLoadout(e) })),
];

afterEach(() => {
  setPool('any');
  setPrefer([]);
  setWithout([]);
  setKing('stalwart');
});

describe('balance simulator (R-TEST-002)', () => {
  it('R-TEST-002 --caps overrides merge object-valued caps one level deep onto the defaults', () => {
    expect(capsOverrides('')).toEqual({});
    expect(capsOverrides('{"TRAITS":{"HOT_FOOT_TURNS":3}}')).toEqual({
      TRAITS: { ...CAPS.TRAITS, HOT_FOOT_TURNS: 3 },
    });
    expect(capsOverrides('{"SILENCE_SCOPE":"OFF","TWIN_GROUP_MAX":2}')).toEqual({
      SILENCE_SCOPE: 'OFF',
      TWIN_GROUP_MAX: 2,
    });
    // A misspelt cap would silently measure the defaults.
    expect(() => capsOverrides('{"NOPE":1}')).toThrow(/unknown cap/);
  });

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
      const loadout = elementLoadout(e);
      const set = loadout.sets[0] ?? [];
      // The Headmaster Ring's five slots, filled by slot cost (7.3): four cards when the passive is
      // the two-slot Obstinate (B5), five when the signature is the passive (Storm) and the spread
      // deals one-slot cards.
      expect(capacityOf(loadout), e).toBe(5);
      expect(slots(set), e).toBe(5);
      const cats = new Set(set.map((id) => category.get(id)));
      expect([...cats].sort(), e).toEqual(['CAPTURED', 'CAPTURES', 'CAPTURING', 'PASSIVE']);
      // The signature leads; the rest of an army-wide set is army-wide (7.3: a type-bound card
      // idles on the other types but still uses the slot), or a card the picker deals like one
      // because the types it leaves out are ones it could never act on (Obstinate, DD-116).
      expect(affinity.get(set[0] ?? ''), e).toBe(e);
      for (const id of set.slice(1))
        expect(eligibleFor.get(id) === 'all' || AS_WIDE.has(id), `${e} ${id}`).toBe(true);
    }
  });

  it("R-TEST-002 7.3 a piece type's set prefers cards built for it: Pawn Storm on pawns, Afterimage on knights", () => {
    // Stone's signature is a Captured card, so each per-type set's Captures pick is open and goes
    // to the type's own card (Pawn Storm is pawns-only, Afterimage never on a pawn).
    const sets = buildLoadout('maximum', 'stone', 'frost').sets;
    expect(sets[0]).toContain('pawn_storm');
    expect(sets[1]).toContain('afterimage');
    expect(sets[0]).not.toContain('afterimage');
    expect(sets[1]).not.toContain('pawn_storm');
    // With a Captures signature (Ember's Cleave) the category is filled before the spread starts
    // and, Obstinate costing two slots (B5), no fifth slot is left for a second Captures card: the
    // type-bound card the set prefers is then the Captured one, Rebirth (non-king) over the
    // army-wide Last Word.
    const ember = buildLoadout('maximum', 'ember', 'tide').sets;
    expect(ember[0]).toContain('rebirth');
    expect(ember[0]).not.toContain('last_word');
    expect(ember[0]).not.toContain('pawn_storm');
    for (const set of [...sets.slice(0, 5), ...ember.slice(0, 5)]) {
      const cats = new Set(set.map((id) => category.get(id)));
      expect([...cats].sort()).toEqual(['CAPTURED', 'CAPTURES', 'CAPTURING', 'PASSIVE']);
    }
  });

  it('R-TEST-002 DD-102 R-RULES-004 B5 with --king stalwart the king set from level 16 is Stalwart plus the passives rule 9 allows and stops there: no Captured, Capturing or Captures card and no Obstinate', () => {
    setKing('stalwart');
    for (const e of ELEMENTS) {
      const king = pickAbilities(e, 5, 25, 'king');
      expect(king[0], e).toBe('stalwart');
      // Rule 9 caps the passives, Captured cards are inert on a king and Stalwart excludes the two
      // offensive categories (rule 8): nothing else can be dealt, so the set ends at the cap, short
      // of its five slots.
      expect(king, e).toHaveLength(CAPS.MAX_PASSIVES_PER_SET);
      expect(slots(king), e).toBeLessThan(5);
      expect(king, e).not.toContain('obstinate');
      for (const id of king) expect(category.get(id), `${e} ${id}`).toBe('PASSIVE');
      // The second passive is the element's signature when that is a passive (Storm's Electric
      // Slide, +10 affinity), else the best neutral passive a king can use: Block Path, the lowest
      // level one after Obstinate, which is inert on a king.
      const signature = abilities.find((a) => a.affinity === e && !a.retired);
      expect(king[1], e).toBe(signature?.category === 'PASSIVE' ? signature.id : 'block_path');
      const other = ELEMENTS[(ELEMENTS.indexOf(e) + 1) % ELEMENTS.length] as ElementId;
      expect(() => assertValid(buildLoadout('maximum', e, other), 25), e).not.toThrow();
    }
    // Below level 16 the king plays offensive cards and no Captured card.
    const young = pickAbilities('ember', 5, 15, 'king');
    expect(young).not.toContain('stalwart');
    expect(young.some((id) => category.get(id) === 'CAPTURES')).toBe(true);
    expect(young.some((id) => category.get(id) === 'CAPTURED')).toBe(false);
  });

  it('R-TEST-002 with --king plain every archetype build for every element pair is legal at level 25 and no set holds Stalwart', () => {
    setKing('plain');
    for (const [a, b] of PAIRS) {
      for (const arch of ARCHETYPES) {
        const l = buildLoadout(arch, a, b);
        expect(() => assertValid(l, 25), `${arch} ${a} ${b}`).not.toThrow();
        for (const set of l.sets) expect(set, `${arch} ${a} ${b}`).not.toContain('stalwart');
      }
    }
  });

  it('R-TEST-002 DD-102 with --king stalwart (the default) the Maximum and Flexible king sets lead with Stalwart, the 7.3 item lists are unchanged and the other five sets never hold it', () => {
    for (const [a, b] of PAIRS) {
      const tag = `${a} ${b}`;
      for (const arch of ARCHETYPES)
        expect(() => assertValid(buildLoadout(arch, a, b), 25), `${arch} ${tag}`).not.toThrow();
      const maximum = buildLoadout('maximum', a, b);
      expect(maximum.elements, tag).toEqual([a, b]);
      expect(maximum.items, tag).toEqual([
        'headmaster_ring',
        'multitaskers_schedule',
        'blended_family',
      ]);
      expect(maximum.sets[5]?.[0], tag).toBe('stalwart');
      const flexible = buildLoadout('flexible', a, b);
      expect(flexible.items, tag).toEqual([
        'journeymans_medallion',
        'multitaskers_schedule',
        'blended_family',
        'resonance_crystal',
      ]);
      expect(flexible.sets[5]?.[0], tag).toBe('stalwart');
      for (const l of [maximum, flexible])
        for (const set of l.sets.slice(0, 5)) expect(set, tag).not.toContain('stalwart');
      for (const arch of ['focused', 'starter'] as const)
        for (const set of buildLoadout(arch, a, b).sets) expect(set, tag).not.toContain('stalwart');
    }
  });

  it('R-TEST-002 17.2 B5 card mirror builds: for every card both sides are legal at level 25 and use the whole capacity, the card leads one side, and the other side carries the same other cards plus the next best in the slots the card used', () => {
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
      // Both sides fill the Headmaster Ring's five slots; the card's own slots are filled on the
      // other side by the next best cards, after the shared ones.
      const capacity = capacityOf(withCard);
      expect(capacity, card.id).toBe(5);
      expect(slots(a), card.id).toBe(capacity);
      expect(slots(b), card.id).toBe(capacity);
      const rest = a.slice(1);
      expect(b.slice(0, rest.length), card.id).toEqual(rest);
      expect(slots(b.slice(rest.length)), card.id).toBe(card.slotCost);
      // Rules 8 and 9 hold on both sides without the validator's help.
      expect(passives(a), card.id).toBeLessThanOrEqual(CAPS.MAX_PASSIVES_PER_SET);
      expect(passives(b), card.id).toBeLessThanOrEqual(CAPS.MAX_PASSIVES_PER_SET);
      for (const cat of card.excludes?.categories ?? [])
        for (const set of [a, b])
          expect(
            set.map((id) => category.get(id)),
            card.id,
          ).not.toContain(cat);
    }
  });

  it('R-TEST-002 B5 17.2 the mirror test of a two-slot card uses the same capacity on both sides: the card is measured against the cards that fill its slots, and both sides validate', () => {
    const cards = abilities.filter((a) => !a.retired && a.minLevel <= 25);
    // Whichever abilities cost two slots in the registry (B5: Obstinate and Block Path); should
    // none, every card is checked against its own slot cost and the test still holds.
    const wide = cards.filter((a) => a.slotCost > 1);
    for (const card of wide.length > 0 ? wide : cards) {
      for (const element of ELEMENTS) {
        if (card.affinity !== 'neutral' && card.affinity !== element) continue;
        const { withCard, without } = cardLoadouts(card.id, element);
        const tag = `${card.id} ${element}`;
        expect(() => assertValid(withCard, 25), tag).not.toThrow();
        expect(() => assertValid(without, 25), tag).not.toThrow();
        const a = withCard.sets[0] ?? [];
        const b = without.sets[0] ?? [];
        expect(slots(a), tag).toBe(capacityOf(withCard));
        expect(slots(b), tag).toBe(slots(a));
        // The side without the card holds the card's other cards and then cards worth exactly the
        // card's slot cost: a two-slot card against two one-slot cards, or one other two-slot card.
        const filler = b.slice(a.length - 1);
        expect(filler.length, tag).toBeGreaterThanOrEqual(1);
        expect(slots(filler), tag).toBe(card.slotCost);
        expect(a.slice(1), tag).toEqual(b.slice(0, a.length - 1));
      }
    }
    // The shipped Obstinate at two slots (B5) is measured against the two one-slot cards it displaces
    // in Ember's build, whose other passive, Block Path, also costs two and so is dealt last.
    const obstinate = abilities.find((a) => a.id === 'obstinate');
    if (obstinate?.slotCost === 2) {
      const { withCard, without } = cardLoadouts('obstinate', 'ember');
      const filler = (without.sets[0] ?? []).slice((withCard.sets[0] ?? []).length - 1);
      expect(filler).toHaveLength(2);
      for (const id of filler) expect(slotCost.get(id), id).toBe(1);
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

  it('R-TEST-002 B5 --prefer deals the listed cards right after the signature, in score order, before the category spread; the signature still leads', () => {
    setPrefer(['pierce', 'riposte']);
    for (const e of ELEMENTS) {
      const set = elementLoadout(e).sets[0] ?? [];
      expect(affinity.get(set[0] ?? ''), e).toBe(e);
      // Both preferred cards follow the signature whatever its category; Riposte (a Captured card,
      // +1.5) scores above Pierce (Capturing, +0.5), so it is dealt first. Scout, the Capturing card
      // the spread would have dealt, is out.
      expect(set.slice(1, 3), e).toEqual(['riposte', 'pierce']);
      expect(set, e).not.toContain('scout');
      expect(() => assertValid(elementLoadout(e), 25), e).not.toThrow();
    }
    setPrefer([]);
    expect(elementLoadout('ember').sets[0]).toContain('scout');
  });

  it('R-TEST-002 B5 setPrefer([obstinate]) puts Obstinate second in every Focused build, Storm included, whose signature Electric Slide is itself a passive, and the build validates', () => {
    setPrefer(['obstinate']);
    for (const e of ELEMENTS) {
      const loadout = elementLoadout(e);
      const set = loadout.sets[0] ?? [];
      expect(affinity.get(set[0] ?? ''), e).toBe(e);
      expect(set[1], e).toBe('obstinate');
      expect(slots(set), e).toBe(capacityOf(loadout));
      expect(passives(set), e).toBeLessThanOrEqual(CAPS.MAX_PASSIVES_PER_SET);
      expect(() => assertValid(loadout, 25), e).not.toThrow();
    }
    // Storm's set then holds its two passives (the cap) and the spread fills the rest with other
    // categories.
    const storm = elementLoadout('storm').sets[0] ?? [];
    expect(category.get(storm[0] ?? '')).toBe('PASSIVE');
    expect(passives(storm)).toBe(CAPS.MAX_PASSIVES_PER_SET);
  });

  it('R-TEST-002 B5 every archetype build for every element pair and every element build validates at level 25 under the shipped data, with either pool and either king', () => {
    for (const pool of ['any', 'affinity'] as const) {
      setPool(pool);
      for (const king of ['stalwart', 'plain'] as const) {
        setKing(king);
        for (const { tag, loadout } of allBuilds())
          expect(() => assertValid(loadout, 25), `${pool} ${king} ${tag}`).not.toThrow();
      }
    }
  });

  it('R-TEST-002 B5 rule 9: no set of any simulator build holds more than CAPS.MAX_PASSIVES_PER_SET passives, with either king', () => {
    expect(CAPS.MAX_PASSIVES_PER_SET).toBeGreaterThanOrEqual(1);
    for (const king of ['stalwart', 'plain'] as const) {
      setKing(king);
      for (const { tag, loadout } of allBuilds())
        for (const set of loadout.sets)
          expect(passives(set), `${king} ${tag} ${set.join(',')}`).toBeLessThanOrEqual(
            CAPS.MAX_PASSIVES_PER_SET,
          );
    }
    // The cap bites: with Stalwart the Schedule builds' king set is exactly at it.
    setKing('stalwart');
    for (const [a, b] of PAIRS)
      for (const arch of ['maximum', 'flexible'] as const)
        expect(passives(buildLoadout(arch, a, b).sets[5] ?? []), `${arch} ${a} ${b}`).toBe(
          CAPS.MAX_PASSIVES_PER_SET,
        );
  });

  it('R-TEST-002 --without leaves the listed items out of every build and the builds stay legal', () => {
    setWithout(['resonance_crystal']);
    for (const arch of ARCHETYPES) {
      const l = buildLoadout(arch, 'ember', 'tide');
      expect(l.items, arch).not.toContain('resonance_crystal');
      expect(() => assertValid(l, 25), arch).not.toThrow();
    }
    expect(buildLoadout('focused', 'ember', 'ember').items).toEqual([
      'headmaster_ring',
      'scouts_lens',
    ]);
    setWithout([]);
    expect(buildLoadout('focused', 'ember', 'ember').items).toContain('resonance_crystal');
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
