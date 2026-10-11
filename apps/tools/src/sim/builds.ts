/**
 * Representative loadouts for the balance simulator (3.4, 7.3, 17.2). Built from module data only:
 * abilities are ranked by affinity match, then dealt across the four categories, so new content is
 * picked up without changes here (DD-98 section 4: the earlier picker capped each category at half
 * the set, left passives out and so played no Capturing card, which made the `REACTIONS_ONLY`
 * silence scope unmeasurable). Every limit is read from data: a card's `slotCost`, the categories
 * it excludes (rule 8) and `CAPS.MAX_PASSIVES_PER_SET` (rule 9, plan item B5), so a card priced at
 * two slots or a change to the passive cap needs no edit here.
 */
import {
  PIECE_TYPES,
  loadoutShape,
  type Category,
  type ElementId,
  type Loadout,
  type PieceType,
} from '@chain-theorem/rules';
import type { AbilityDef } from '@chain-theorem/rules/sdk';
import { CAPS, abilities, engine, items as itemDefs } from '@chain-theorem/content';

const ITEMS = new Map(itemDefs.map((i) => [i.id, i]));

export type Archetype = 'maximum' | 'flexible' | 'focused' | 'starter';
/** Ability pool for simulator builds: 'any' ranks every ability, 'affinity' keeps each element to its own and neutral abilities. */
export type Pool = 'any' | 'affinity';
let POOL: Pool = 'any';
export function setPool(p: Pool): void {
  POOL = p;
}
/**
 * Cards to deal right after the signature (`--prefer pierce,phalanx`): a build that must carry a
 * particular card, such as a Capturing card with an effect for the silence-scope runs (DD-98
 * section 4, `docs/BALANCE_BASELINE.md` finding 5) or Obstinate for every Focused build (B5). The
 * signature still leads. Until B5 a preferred card only scored +5 within its category, so a
 * preferred passive never reached a build whose signature is itself the passive (Storm's Electric
 * Slide took the one passive the spread dealt); now the preferred cards are dealt before the
 * category spread when they fit, and the +5 orders them among themselves.
 */
let PREFER: ReadonlySet<string> = new Set();
export function setPrefer(ids: readonly string[]): void {
  PREFER = new Set(ids);
}
/**
 * Items left out of every build (`--without resonance_crystal`): the slot stays empty. For runs that
 * must isolate a rule from an item that interacts with it (the Crystal under ONCE_PER_ABILITY).
 */
let WITHOUT: ReadonlySet<string> = new Set();
export function setWithout(ids: readonly string[]): void {
  WITHOUT = new Set(ids);
}
const items = (ids: string[]): string[] => ids.filter((id) => !WITHOUT.has(id));
/**
 * The king's set (`--king`): 'stalwart' (the default) puts Stalwart on it from its level (16) with
 * the Schedule builds, followed by what rule 9 allows (one more passive at the shipped cap, see
 * `pickAbilities`); 'plain' deals the king passives like any other type and never Stalwart. Focused
 * and Starter never carry it: Stalwart in an army-wide set strips the offensive cards (rule 8), and
 * Starter plays at level 5.
 */
export type King = 'plain' | 'stalwart';
let KING: King = 'stalwart';
export function setKing(mode: King): void {
  KING = mode;
}
export const ARCHETYPES: Archetype[] = ['maximum', 'flexible', 'focused', 'starter'];
/** Deal order when categories are equally filled and their best cards score alike (M3 3.4). */
const CATEGORIES: readonly Category[] = ['CAPTURED', 'CAPTURES', 'CAPTURING', 'PASSIVE'];

function eligible(a: AbilityDef, t: PieceType | 'all'): boolean {
  if (t === 'all') return true;
  return a.eligible === 'all' || a.eligible.includes(t);
}

/**
 * A card that can never act on the piece type is not dealt to that type's set: a Captured card on
 * the king (a king is never captured; a Stalwart king's capture ends the battle, R-RULES-004) and
 * Obstinate on the king (it guards against higher ranks, and nothing outranks a king, DD-97).
 */
function inert(a: AbilityDef, t: PieceType | 'all'): boolean {
  return t === 'king' && (a.category === 'CAPTURED' || a.id === 'obstinate');
}

function score(a: AbilityDef, element: ElementId, type: PieceType | 'all'): number {
  const affinity = a.affinity === element ? 10 : a.affinity === 'neutral' ? 2 : 0;
  const category = a.category === 'CAPTURED' ? 1.5 : a.category === 'CAPTURES' ? 1 : 0.5;
  // A card built for a few piece types is the natural pick for one of those types' sets (Pawn Storm
  // on pawns, Afterimage on knights) and a poor one for an army-wide set, where it idles on the
  // other types but still uses the slot (7.3); there it ranks below every army-wide card.
  const fit = a.eligible === 'all' ? 0 : type === 'all' ? -1 : 0.75;
  // A preferred card outranks every other neutral card, never the signature (whose +10 affinity
  // beats a neutral card's 2 + 5 at any category and fit); among preferred cards the +5 keeps
  // their natural order, which is the order `pickAbilities` deals them in.
  const prefer = PREFER.has(a.id) ? 5 : 0;
  return affinity + category + fit + prefer - a.minLevel / 100;
}

/**
 * Fill up to `n` slots with abilities for an element and piece type. The best card comes first (the
 * element's own signature when the level allows), then the preferred cards (`--prefer`) that fit,
 * then the emptiest category is dealt its best remaining card each time, ties going to the category
 * whose best card scores highest; so a set of four or more spreads over all four categories and
 * carries a Capturing card and a passive. A card is dealt only when its `slotCost` fits the capacity
 * left and, for a passive, when the set holds fewer than `CAPS.MAX_PASSIVES_PER_SET` passives
 * (loadout rule 9, B5); the spread then moves on to the other categories, so a set never needs the
 * validator to tell it about rule 9.
 *
 * Unless `--king plain`, the king's set from Stalwart's level is Stalwart first and then whatever
 * rule 9 still allows: at the shipped cap of two, one more passive (the element's signature when
 * that is a passive, else the best neutral one). Nothing else can go on it: Captured cards are inert
 * on a king (`inert`), and Stalwart's `excludes` keep Capturing and Captures cards out (rule 8,
 * DD-102). So the Stalwart king set stops early, short of its five-slot capacity (two or three
 * slots used), and that is the price B5 puts on the king that must be caught
 * (`docs/BALANCE_BASELINE.md` 9.3).
 */
export function pickAbilities(
  element: ElementId,
  /** Capacity in slots. */
  n: number,
  level: number,
  type: PieceType | 'all' = 'all',
): string[] {
  const stalwart =
    KING === 'stalwart' && type === 'king' && n >= 2
      ? abilities.find((a) => a.id === 'stalwart' && !a.retired && a.minLevel <= level)
      : undefined;
  // With Stalwart on the set, the categories it excludes stay off it (rule 8).
  const excluded = new Set<Category>(stalwart?.excludes?.categories ?? []);
  const pool = abilities
    .filter((a) => !a.retired && a.minLevel <= level && eligible(a, type) && !inert(a, type))
    // Stalwart goes on the king set only: anywhere else rule 8 would strip the set of its
    // offensive cards.
    .filter((a) => a.id !== 'stalwart' && !excluded.has(a.category))
    .filter((a) => POOL === 'any' || a.affinity === element || a.affinity === 'neutral')
    .map((a) => ({ a, s: score(a, element, type) }))
    .sort((x, y) => y.s - x.s || (x.a.id < y.a.id ? -1 : 1));
  const out: string[] = [];
  const filled = new Map<Category, number>();
  let used = 0;
  let passives = 0;
  const take = (a: AbilityDef) => {
    out.push(a.id);
    used += a.slotCost;
    if (a.category === 'PASSIVE') passives++;
    filled.set(a.category, (filled.get(a.category) ?? 0) + a.slotCost);
  };
  // `n` is the set's capacity in slots (7.3): abilities fill it by slotCost, not by count; rule 9
  // counts passives by card.
  const fits = (a: AbilityDef) =>
    !out.includes(a.id) &&
    used + a.slotCost <= n &&
    (a.category !== 'PASSIVE' || passives < CAPS.MAX_PASSIVES_PER_SET);
  if (stalwart && fits(stalwart)) take(stalwart);
  const first = pool.find((x) => fits(x.a));
  if (first) take(first.a);
  // Preferred cards come before the category spread, in score order (B5): a preferred passive then
  // reaches a build whose signature is itself the passive, which the spread alone never gave it.
  for (const x of pool) if (PREFER.has(x.a.id) && fits(x.a)) take(x.a);
  for (;;) {
    if (used >= n) break;
    let best: { a: AbilityDef; s: number } | undefined;
    let bestFill = Infinity;
    for (const cat of CATEGORIES) {
      const cand = pool.find((x) => x.a.category === cat && fits(x.a));
      if (!cand) continue;
      const fill = filled.get(cat) ?? 0;
      if (fill < bestFill || (fill === bestFill && best !== undefined && cand.s > best.s)) {
        best = cand;
        bestFill = fill;
      }
    }
    if (!best) break;
    take(best.a);
  }
  return out;
}

export function buildLoadout(arch: Archetype, a: ElementId, b: ElementId, level = 25): Loadout {
  const second = (t: PieceType): ElementId =>
    t === 'rook' || t === 'queen' || t === 'king' ? b : a;
  switch (arch) {
    case 'maximum':
      return {
        elements: [a, b],
        items: items(['headmaster_ring', 'multitaskers_schedule', 'blended_family']),
        sets: PIECE_TYPES.map((t) => pickAbilities(second(t), 5, level, t)),
      };
    case 'flexible':
      return {
        elements: [a, b],
        items: items([
          'journeymans_medallion',
          'multitaskers_schedule',
          'blended_family',
          'resonance_crystal',
        ]),
        sets: PIECE_TYPES.map((t) => pickAbilities(second(t), 4, level, t)),
      };
    case 'focused':
      return {
        elements: [a],
        items: items(['headmaster_ring', 'resonance_crystal', 'scouts_lens']),
        sets: [pickAbilities(a, 5, level)],
      };
    case 'starter':
      return {
        elements: [a],
        items: items(['dual_adepts_glove']),
        sets: [pickAbilities(a, 2, Math.min(level, 5))],
      };
  }
}

/**
 * The element pair of an archetype suite's game `i`: pairs cycle through consecutive elements, and
 * each pair plays two games in a row (the colours alternate by game), so every pair is played with
 * both colour assignments. Cycling the pair every game tied each pair to one colour whenever the
 * number of elements is even, as it is with six (M7 7.3, R-TEST-002).
 */
export function archetypeElements(els: readonly ElementId[], i: number): [ElementId, ElementId] {
  const pair = Math.floor(i / 2);
  return [els[pair % els.length] as ElementId, els[(pair + 1) % els.length] as ElementId];
}

/** Mono-element build used for element matchups (isolates the element relationship). */
export function elementLoadout(element: ElementId): Loadout {
  return buildLoadout('focused', element, element);
}

/**
 * The two builds of a card's mirror test (`--suite cards`, 17.2 "any single ability"): the element's
 * Focused build (its items and element) with the card under test in front of its best other cards
 * up to capacity, against those same cards plus the next best ones in the slots the card used. Both
 * sides use the whole capacity (5 at level 25 with the Headmaster Ring), so a one-slot card is
 * measured against the one-slot card it displaces and a two-slot card (B5: Obstinate, Block Path)
 * against the two one-slot cards, or the other two-slot card, it displaces; section 5 of
 * `docs/BALANCE_BASELINE.md` played the four best other cards against those four alone, which with
 * cards of unequal price would have measured the card against an empty slot or two.
 *
 * "Best other cards" is the picker's own deal order over the whole pool (`pickAbilities` at
 * unlimited capacity, so `--prefer` and `--pool` apply: `--prefer obstinate` plays every mirror test
 * with Obstinate on both sides), minus the card, minus the categories the card excludes (rule 8;
 * Stalwart: Capturing and Captures, left out of both sides), and a passive is dealt only while rule
 * 9 allows, the tested card counting towards the cap on its side. Same element on both sides, so no
 * silence and the same trait: the score measures the card by itself.
 */
export function cardLoadouts(
  id: string,
  element: ElementId,
): { withCard: Loadout; without: Loadout } {
  const card = abilities.find((a) => a.id === id);
  if (!card) throw new Error(`unknown ability ${id}`);
  const excluded = new Set<Category>(card.excludes?.categories ?? []);
  const base = elementLoadout(element);
  const capacity = loadoutShape(base, ITEMS, CAPS).capacity;
  const byId = new Map(abilities.map((a) => [a.id, a]));
  const ranked = pickAbilities(element, Infinity, 25)
    .map((x) => byId.get(x))
    .filter((a): a is AbilityDef => a !== undefined && a.id !== id && !excluded.has(a.category));
  /** The next cards of the ranking that fit `free` slots beside `have`, under rule 9. */
  const deal = (have: readonly AbilityDef[], free: number): AbilityDef[] => {
    const taken: AbilityDef[] = [];
    const held = new Set(have.map((a) => a.id));
    let passives = have.filter((a) => a.category === 'PASSIVE').length;
    for (const a of ranked) {
      if (free === 0) break;
      if (held.has(a.id) || a.slotCost > free) continue;
      if (a.category === 'PASSIVE') {
        if (passives >= CAPS.MAX_PASSIVES_PER_SET) continue;
        passives++;
      }
      taken.push(a);
      held.add(a.id);
      free -= a.slotCost;
    }
    return taken;
  };
  const rest = deal([card], capacity - card.slotCost);
  const filler = deal(rest, card.slotCost);
  return {
    withCard: { ...base, sets: [[id, ...rest.map((a) => a.id)]] },
    without: { ...base, sets: [[...rest, ...filler].map((a) => a.id)] },
  };
}

export function assertValid(l: Loadout, level: number): Loadout {
  const v = engine.validateLoadout(l, { level });
  if (!v.ok)
    throw new Error(`simulator build is invalid: ${v.errors.map((e) => e.message).join('; ')}`);
  return l;
}
