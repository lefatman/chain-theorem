/**
 * Ability knowledge for search (ability-aware evaluation, 3.3, 9.4). Profiles are derived from
 * ability data (effect primitives), never from ability ids, so new content is understood without AI
 * changes. Only information the NPC may see is used: its own loadout and the opponent's revealed
 * abilities (the belief state).
 */
import {
  beats,
  type ElementId,
  type GameState,
  type PieceType,
  type Side,
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
        break;
      case 'negate':
        if (e.of === 'victim' && e.categories.includes('CAPTURED')) p.negatesVictim = true;
        break;
      case 'protect':
        if (e.target.t === 'self') p.protectsSelf = true;
        break;
      case 'reveal':
        p.reveals = true;
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

export interface PieceKnowledge {
  capturing: Profile;
  captures: Profile;
  captured: Profile;
  /** Number of known triggered abilities (board presence value). */
  count: number;
  /** Opponent piece whose type set is not fully known while slots may hide more abilities. */
  uncertain: boolean;
}

function merge(into: Profile, p: Profile): void {
  for (const k of Object.keys(p) as (keyof Profile)[]) if (p[k]) into[k] = true;
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
    const k: PieceKnowledge = {
      capturing: { ...EMPTY },
      captures: { ...EMPTY },
      captured: { ...EMPTY },
      count: 0,
      uncertain: false,
    };
    for (const id of army.sets[t]) {
      const def = abilities.get(id);
      if (!def || (def.eligible !== 'all' && !def.eligible.includes(t))) continue;
      const p = profileOf(def);
      if (def.category === 'CAPTURING') merge(k.capturing, p);
      if (def.category === 'CAPTURES') merge(k.captures, p);
      if (def.category === 'CAPTURED') merge(k.captured, p);
      if (def.category !== 'PASSIVE') k.count++;
    }
    k.uncertain = side !== viewer && !reveals.complete.includes(t);
    out[t] = k;
  }
  return out;
}

export function silenced(
  captorEl: ElementId,
  victimEl: ElementId,
): { victim: boolean; captor: boolean } {
  return { victim: beats(captorEl, victimEl), captor: beats(victimEl, captorEl) };
}
