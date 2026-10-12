/**
 * Ability knowledge for search (ability-aware evaluation, 3.3, 9.4). Profiles are derived from
 * ability data (effect primitives), never from ability ids, so new content is understood without AI
 * changes. Only information the NPC may see is used: its own loadout and the opponent's revealed
 * abilities (the belief state). M7 7.3 adds the patterns of the Storm, Stone and Frost catalogue
 * (negating the captor, pushing it back or home, guarding a friend, moving an enemy piece) and the
 * three new traits' public effects on a capture (`traitEffects`). Trigger conditions (5.6) stay with
 * the profile of the ability that carries them and are decided per capture (`conditionsHold`,
 * `effectiveProfile`): Cornered bites only on the rim (DD-123), Overwhelm negates only a lower rank
 * (DD-125), Redo rewinds only a capture by an equal or higher rank (DD-100).
 */
import {
  beats,
  eligibleFor,
  isRim,
  rankCompare,
  type Condition,
  type ElementId,
  type GameState,
  type PieceType,
  type Side,
  type Square,
  type Zone,
} from '@chain-theorem/rules';
import type { AbilityDef, EffectSpec, Engine } from './types.ts';

export interface Profile {
  /** CAPTURED: effect-captures the captor. */
  killsCaptor: boolean;
  /** CAPTURED/CAPTURES: effect-captures some other enemy piece. */
  killsOther: boolean;
  /** CAPTURED: the piece revives itself. */
  selfRevive: boolean;
  /** CAPTURES: revives a friendly piece. */
  reviveFriendly: boolean;
  /** Grants a bonus move (tempo). */
  bonus: boolean;
  /** CAPTURING: negates the victim's CAPTURED abilities. */
  negatesVictim: boolean;
  /** CAPTURING: protects the captor from effect captures. */
  protectsSelf: boolean;
  /** CAPTURED: reveals information (small value). */
  reveals: boolean;
  /** The bonus action captures the captor (Riposte), rather than granting a free move. */
  recaptures: boolean;
  /** CAPTURED: negates the captor's After-capturing abilities (Stonewall; M7). */
  negatesCaptor: boolean;
  /** CAPTURED: pushes the captor back towards the square it moved from (Frost Heave; M7). */
  pushesCaptor: boolean;
  /** CAPTURED: sends the captor to its starting square (Permafrost; M7). */
  sendsCaptorHome: boolean;
  /** Protects a chosen friendly piece from effect captures (Buttress; M7). */
  protectsFriend: boolean;
  /** Moves a chosen enemy piece: control (Snowdrift, Snowbound; M7). */
  movesEnemy: boolean;
  /** CAPTURED: the capture is undone by a rewind (Redo, DD-100). */
  undoesCapture: boolean;
  /** CAPTURES: the captor gains a twin that moves every turn (Schrödinger's Joker, DD-101). */
  spawns: boolean;
}

const EMPTY: Profile = {
  killsCaptor: false,
  killsOther: false,
  selfRevive: false,
  reviveFriendly: false,
  bonus: false,
  negatesVictim: false,
  protectsSelf: false,
  reveals: false,
  recaptures: false,
  negatesCaptor: false,
  pushesCaptor: false,
  sendsCaptorHome: false,
  protectsFriend: false,
  movesEnemy: false,
  undoesCapture: false,
  spawns: false,
};

function scan(effects: readonly EffectSpec[], p: Profile, cat: AbilityDef['category']): void {
  for (const e of effects) {
    switch (e.op) {
      case 'effectCapture':
        if (e.target.t === 'captor' && cat === 'CAPTURED') p.killsCaptor = true;
        else p.killsOther = true;
        break;
      case 'revive':
        if (e.piece.t === 'self') p.selfRevive = true;
        else p.reviveFriendly = true;
        break;
      case 'bonusAction':
        p.bonus = true;
        if (e.bonus.capture === 'captor') p.recaptures = true;
        break;
      case 'negate':
        if (e.of === 'victim' && e.categories.includes('CAPTURED')) p.negatesVictim = true;
        if (e.of === 'captor' && e.categories.includes('CAPTURES')) p.negatesCaptor = true;
        break;
      case 'protect':
        if (e.target.t === 'self') p.protectsSelf = true;
        else if (e.target.t === 'chosen' && e.target.filter.side !== 'enemy')
          p.protectsFriend = true;
        break;
      case 'move':
        // Self-moves after a capture (Hit and Run, Afterimage, Ricochet's CONTINUE) are not modelled.
        if (e.piece.t === 'captor' && cat === 'CAPTURED') {
          if (e.to.s === 'start') p.sendsCaptorHome = true;
          else p.pushesCaptor = true;
        } else if (e.piece.t === 'chosen' && e.piece.filter.side === 'enemy') p.movesEnemy = true;
        break;
      case 'reveal':
        p.reveals = true;
        break;
      case 'rewind':
        if (cat === 'CAPTURED') p.undoesCapture = true;
        break;
      case 'spawn':
        if (cat === 'CAPTURES') p.spawns = true;
        break;
      case 'when':
        scan(e.then, p, cat);
        break;
      case 'atChainEnd':
        scan(e.effects, p, cat);
        break;
      default:
        break;
    }
  }
}

const cache = new WeakMap<AbilityDef, Profile>();
export function profileOf(def: AbilityDef): Profile {
  const hit = cache.get(def);
  if (hit) return hit;
  const p = { ...EMPTY };
  scan(def.effects, p, def.category);
  if (def.attuned) scan(def.attuned.effects, p, def.category);
  cache.set(def, p);
  return p;
}

/**
 * Do an ability's trigger conditions (5.6) all hold for a capture of a `victimType` piece by a
 * `captorType` piece on `captureSquare`? The engine's test (action.ts `condHolds`) from what the
 * search knows at that point: a ZONE condition resolves either subject to the capture square, since
 * a captured piece uses the square it was captured on (5.4) and the captor stands there when its
 * triggers are evaluated (DD-123). Data only, never ability ids; the chain over `Condition` is
 * exhaustive, so a new variant is a type error here rather than a condition silently ignored.
 */
export function conditionsHold(
  conditions: readonly Condition[] | undefined,
  captorType: PieceType,
  victimType: PieceType,
  captureSquare: Square,
): boolean {
  if (conditions === undefined) return true;
  for (const c of conditions) {
    if (!conditionHolds(c, captorType, victimType, captureSquare)) return false;
  }
  return true;
}

function conditionHolds(
  c: Condition,
  captorType: PieceType,
  victimType: PieceType,
  captureSquare: Square,
): boolean {
  if ('victimTypeNot' in c) return victimType !== c.victimTypeNot;
  if ('victimTypeIs' in c) return c.victimTypeIs.includes(victimType);
  if ('captorTypeIs' in c) return c.captorTypeIs.includes(captorType);
  if ('captorTypeNot' in c) return captorType !== c.captorTypeNot;
  if ('rank' in c) {
    const of = c.rank.of === 'victim' ? victimType : captorType;
    const to = c.rank.to === 'victim' ? victimType : captorType;
    return rankCompare(of, c.rank.cmp, to);
  }
  if ('zone' in c) return inZone(c.zone.is, captureSquare);
  return unknownCondition(c);
}

/** Exhaustiveness sink: compiles only while every `Condition` variant is handled above. */
function unknownCondition(c: never): never {
  throw new Error(`unknown trigger condition ${JSON.stringify(c)}`);
}

/** Exhaustive over `Zone` (DD-123): a new zone fails to compile here. */
function inZone(zone: Zone, sq: Square): boolean {
  switch (zone) {
    case 'rim':
      return isRim(sq);
  }
}

/** The trigger categories a capture resolves (PASSIVE abilities have no capture profile). */
export type TriggerCategory = 'CAPTURING' | 'CAPTURES' | 'CAPTURED';

/** A known ability with trigger conditions (5.6): its profile counts only when they hold. */
export interface ConditionalKnowledge {
  category: TriggerCategory;
  profile: Profile;
  conditions: readonly Condition[];
}

export interface PieceKnowledge {
  /** Merged profile of the type's known unconditional CAPTURING abilities. */
  capturing: Profile;
  /** Merged profile of the type's known unconditional CAPTURES abilities. */
  captures: Profile;
  /** Merged profile of the type's known unconditional CAPTURED abilities. */
  captured: Profile;
  /**
   * The type's known abilities that carry trigger conditions, one entry each; `effectiveProfile`
   * adds each to the merged profile of its category for the captures its conditions admit. Empty
   * for most types, which then read their merged profiles as they are.
   */
  conditional: readonly ConditionalKnowledge[];
  /** Number of known triggered abilities (board presence value), conditional ones included. */
  count: number;
  /** Opponent piece whose type set is not fully known while slots may hide more abilities. */
  uncertain: boolean;
}

function merge(into: Profile, p: Profile): void {
  for (const k of Object.keys(p) as (keyof Profile)[]) if (p[k]) into[k] = true;
}

/**
 * The profile of `category` that applies to one capture: the merged profile of the type's
 * unconditional abilities plus every conditional one whose trigger conditions hold for this captor,
 * victim and capture square (Cornered DD-123, Overwhelm DD-125, Redo DD-100, Phalanx, Reinforce).
 * Returns the merged profile itself, with no allocation, when nothing conditional applies.
 */
export function effectiveProfile(
  k: PieceKnowledge,
  category: TriggerCategory,
  captorType: PieceType,
  victimType: PieceType,
  captureSquare: Square,
): Profile {
  const base =
    category === 'CAPTURING' ? k.capturing : category === 'CAPTURES' ? k.captures : k.captured;
  if (k.conditional.length === 0) return base;
  let out: Profile | null = null;
  for (const c of k.conditional) {
    if (c.category !== category) continue;
    if (!conditionsHold(c.conditions, captorType, victimType, captureSquare)) continue;
    out ??= { ...base };
    merge(out, c.profile);
  }
  return out ?? base;
}

/** Knowledge per piece type for one side of a (belief) state. */
export function sideKnowledge(
  engine: Engine,
  state: GameState,
  side: Side,
  viewer: Side,
): Record<PieceType, PieceKnowledge> {
  const out = {} as Record<PieceType, PieceKnowledge>;
  const army = state.armies[side];
  const reveals = state.reveals[side];
  const abilities = new Map(engine.registry.abilities.map((a) => [a.id, a]));
  for (const t of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as PieceType[]) {
    const conditional: ConditionalKnowledge[] = [];
    const k: PieceKnowledge = {
      capturing: { ...EMPTY },
      captures: { ...EMPTY },
      captured: { ...EMPTY },
      conditional,
      count: 0,
      uncertain: false,
    };
    for (const id of army.sets[t]) {
      const def = abilities.get(id);
      if (!def || !eligibleFor(def, t)) continue;
      const cat = def.category;
      if (cat === 'PASSIVE') continue;
      k.count++;
      const p = profileOf(def);
      // An attuned piece may trigger under `def.attuned.conditions` instead; the search ignores
      // attunement for profiles (both effect lists are scanned), so the base conditions stand.
      const conditions = def.conditions ?? [];
      if (conditions.length > 0) conditional.push({ category: cat, profile: p, conditions });
      else if (cat === 'CAPTURING') merge(k.capturing, p);
      else if (cat === 'CAPTURES') merge(k.captures, p);
      else merge(k.captured, p);
    }
    k.uncertain = side !== viewer && !reveals.complete.includes(t);
    out[t] = k;
  }
  return out;
}

/**
 * Negating captures left per piece (DD-120, R-FMT-005): for a piece of the viewer's own side, the
 * largest number of charges left on a CAPTURING ability of its type that negates the victim's
 * reactions (Pierce: 2, plus the engine's trait adjustments such as Overabundance), read from the
 * public usage counters through `engine.remainingCharges`; `Infinity` when one of them has no charge
 * limit (Phalanx) or the type carries no such ability. Every opponent piece is `Infinity` too: its
 * counters are not read, so its known negation keeps the per-type treatment. A negation with trigger
 * conditions (Overwhelm, DD-125; Phalanx) counts here whenever it has charges left: whether it
 * applies to a given capture is decided there (`effectiveProfile` in fast.ts `play`), and a charge
 * is spent only when it does.
 */
export function negateCharges(engine: Engine, state: GameState, viewer: Side): number[] {
  const abilities = new Map(engine.registry.abilities.map((a) => [a.id, a]));
  const sets = state.armies[viewer].sets;
  return state.pieces.map((p) => {
    if (p.side !== viewer) return Infinity;
    let left = -Infinity;
    for (const id of sets[p.type]) {
      const def = abilities.get(id);
      if (!def || def.category !== 'CAPTURING' || !eligibleFor(def, p.type)) continue;
      if (!profileOf(def).negatesVictim) continue;
      left = Math.max(left, engine.remainingCharges(state, p.id, def.id));
    }
    return left === -Infinity ? Infinity : Math.max(0, left);
  });
}

export function silenced(
  captorEl: ElementId,
  victimEl: ElementId,
): { victim: boolean; captor: boolean } {
  return { victim: beats(captorEl, victimEl), captor: beats(victimEl, captorEl) };
}

/**
 * The element traits that change a capture's reactions (6.1, COMMITTED, public knowledge): Always
 * First puts a Storm captor's After-capturing abilities ahead of a non-Storm victim's reactions;
 * Stillness negates them when the victim is Frost; Bulwark saves a Stone piece from its first effect
 * capture (the spent list is a public slice). A Stone pawn is covered only when the engine's
 * `caps.TRAITS.BULWARK_PAWNS` says so (DD-113): `bulwarkPawns` is that public setting.
 */
export function traitEffects(
  captorEl: ElementId,
  victimEl: ElementId,
  captorType: PieceType,
  bulwarkPawns: boolean,
): { stormFirst: boolean; stillness: boolean; captorBulwark: boolean } {
  return {
    stormFirst: captorEl === 'storm' && victimEl !== 'storm',
    stillness: victimEl === 'frost',
    captorBulwark: captorEl === 'stone' && (captorType !== 'pawn' || bulwarkPawns),
  };
}
