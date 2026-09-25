/**
 * R-SEC-001 payload scanner: finds information a viewer must not receive in any serialized payload
 * (a projection, projected events, a socket message). Used by the fuzzer (17.1) and the server's
 * message tests. Knows the content ids that hide information (Masquerade Mask, Hot Foot).
 */
import type { GameState, PieceType, Side } from '@chain-theorem/rules';

/** Ids that `viewer` must not see: opponent items and abilities not yet revealed. */
export function unrevealedIds(
  state: GameState,
  viewer: Side,
): { abilities: Set<string>; items: Set<string> } {
  const opp: Side = viewer === 'white' ? 'black' : 'white';
  const army = state.armies[opp];
  const log = state.reveals[opp];
  const knownAbilities = new Set<string>();
  for (const list of Object.values(log.abilities))
    for (const a of list ?? []) knownAbilities.add(a);
  const abilities = new Set<string>();
  for (const t of Object.keys(army.sets) as PieceType[])
    for (const a of army.sets[t]) if (!knownAbilities.has(a)) abilities.add(a);
  const items = new Set<string>(army.loadout.items.filter((i) => !log.items.includes(i)));
  return { abilities, items };
}

/**
 * Structural checks that an id scan cannot see: while the opponent's Masquerade Mask is up every
 * opponent piece shows the chosen element (DD-26), and pending burns are never projected for
 * opponent pieces (they would expose an Ember piece, DD-26).
 */
function scanDisguise(payload: unknown, state: GameState, opp: Side): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const pub = payload as {
    pieces?: { id: number; side: Side; element: string }[];
    slices?: Record<string, unknown>;
  };
  const pending = (pub.slices?.hot_foot as { pending?: { piece: number }[] } | undefined)?.pending;
  for (const p of pending ?? []) {
    if (state.pieces[p.piece]?.side === opp)
      return `$.slices.hot_foot.pending shows opponent piece ${p.piece}`;
  }
  const mask = state.slices.masquerade_mask as { active?: Record<Side, boolean> } | undefined;
  const shown = state.armies[opp].loadout.itemParams?.masquerade_mask?.element;
  if (mask?.active?.[opp] && shown && Array.isArray(pub.pieces)) {
    for (const p of pub.pieces) {
      if (p.side === opp && p.element !== shown)
        return `$.pieces[${p.id}].element = ${p.element} under an active Mask showing ${shown}`;
    }
  }
  return null;
}

/** Returns a description of the first leak found, or null. */
export function scanPayload(payload: unknown, state: GameState, viewer: Side): string | null {
  const { abilities, items } = unrevealedIds(state, viewer);
  if (abilities.size === 0 && items.size === 0) return null;
  const own = state.armies[viewer];
  const ownIds = new Set<string>([...own.loadout.items, ...Object.values(own.sets).flat()]);
  let leak: string | null = null;
  const walk = (v: unknown, path: string): void => {
    if (leak) return;
    if (typeof v === 'string') {
      if ((abilities.has(v) || items.has(v)) && !ownIds.has(v)) leak = `${path} = "${v}"`;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (abilities.has(k) || items.has(k)) {
          if (!ownIds.has(k)) leak = `${path}.${k} (key)`;
        }
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(JSON.parse(JSON.stringify(payload)), '$');
  // Structural checks on opponent-owned records (catches ids the viewer also owns).
  const opp: Side = viewer === 'white' ? 'black' : 'white';
  const obj = payload as { armies?: Record<Side, { loadout?: unknown; sets?: unknown }> };
  if (
    !leak &&
    obj.armies &&
    (obj.armies[opp]?.loadout !== undefined || obj.armies[opp]?.sets !== undefined)
  ) {
    leak = '$.armies.opponent carries its loadout';
  }
  if (!leak) leak = scanDisguise(payload, state, opp);
  if (!leak && Array.isArray(payload)) {
    for (const e of payload as Record<string, unknown>[]) {
      const side = e.side as Side | undefined;
      const ability = e.ability as string | null | undefined;
      if (side === opp && typeof ability === 'string' && abilities.has(ability)) {
        leak = `event ${String(e.k)} names unrevealed opponent ability ${ability}`;
        break;
      }
      // Knowledge is per piece type (8.2): a name may only appear for a type it was revealed on.
      const pieceType = e.pieceType as PieceType | undefined;
      if (side === opp && typeof ability === 'string' && pieceType) {
        const known = state.reveals[opp].abilities[pieceType] ?? [];
        if (!known.includes(ability)) {
          leak = `event ${String(e.k)} names ${ability} on ${pieceType}, not revealed for that type`;
          break;
        }
      }
      if (side === opp && ability === null && (e.category != null || e.attuned != null)) {
        leak = `event ${String(e.k)} carries category or attuned for a hidden ability (Veil)`;
        break;
      }
      const src = e.source as { kind?: string; id?: string; side?: Side } | undefined;
      if (
        src &&
        src.side === opp &&
        typeof src.id === 'string' &&
        (abilities.has(src.id) || items.has(src.id))
      ) {
        leak = `event ${String(e.k)} source names unrevealed ${src.id}`;
        break;
      }
    }
  }
  return leak;
}

// ---- Spectators (M7 7.2) ------------------------------------------------------------------------

const SIDES_: readonly Side[] = ['white', 'black'];
const other = (s: Side): Side => (s === 'white' ? 'black' : 'white');

/** Every ability and item id `side`'s opponent has seen revealed (on any piece type). */
function revealedIds(state: GameState, side: Side): Set<string> {
  const log = state.reveals[side];
  const out = new Set<string>(log.items);
  for (const list of Object.values(log.abilities)) for (const a of list ?? []) out.add(a);
  return out;
}

/**
 * Ids a spectator must never see as a bare string: an ability or item of either side that its
 * opponent has not seen, unless the same id is revealed on the other side (then a string could name
 * that one; the structural checks below still pin every named id to its owner's reveal log).
 */
export function spectatorHiddenIds(state: GameState): Set<string> {
  const known = new Set<string>([...revealedIds(state, 'white'), ...revealedIds(state, 'black')]);
  const hidden = new Set<string>();
  for (const side of SIDES_) {
    const { abilities, items } = unrevealedIds(state, other(side));
    for (const id of [...abilities, ...items]) if (!known.has(id)) hidden.add(id);
  }
  return hidden;
}

function abilityKnown(state: GameState, side: Side, ability: string, type?: PieceType): boolean {
  const log = state.reveals[side];
  if (type) return log.abilities[type]?.includes(ability) ?? false;
  return Object.values(log.abilities).some((l) => l?.includes(ability));
}

function checkSpectatorEvent(e: Record<string, unknown>, state: GameState): string | null {
  const k = String(e.k);
  if (k === 'ChoiceMade') return `event ${k} reached a spectator (a choice is its chooser's own)`;
  const side = e.side as Side | undefined;
  const ability = e.ability as string | null | undefined;
  const pieceType = e.pieceType as PieceType | undefined;
  if (side && typeof ability === 'string' && !abilityKnown(state, side, ability, pieceType))
    return `event ${k} names ${ability} on ${side} ${pieceType ?? ''}, not known to both players`;
  if (side && ability === null && (e.category != null || e.attuned != null))
    return `event ${k} carries category or attuned for a hidden ability`;
  if ((k === 'EffectFizzled' || k === 'ChargeSpent') && side && ability === null)
    return `event ${k} of an unnamed ability reached a spectator`;
  const src = e.source as { kind?: string; id?: string; side?: Side; piece?: number } | undefined;
  if (src?.side && typeof src.id === 'string') {
    if (src.kind === 'item' && !state.reveals[src.side].items.includes(src.id))
      return `event ${k} source names unrevealed item ${src.id}`;
    if (src.kind === 'ability') {
      const type = src.piece !== undefined ? state.pieces[src.piece]?.type : undefined;
      if (!abilityKnown(state, src.side, src.id, type))
        return `event ${k} source names ${src.id}, not known to both players`;
    }
  }
  if (k === 'Revealed' && side) {
    // Whatever a reveal names is in the owner's reveal log from then on (both players saw it).
    const info = e.info as {
      pieceType?: PieceType;
      ability?: string;
      abilities?: string[];
      item?: string;
      items?: string[];
    };
    const log = state.reveals[side];
    for (const id of [...(info.ability ? [info.ability] : []), ...(info.abilities ?? [])])
      if (!abilityKnown(state, side, id, info.pieceType))
        return `event Revealed carries ${id}, which is not in ${side}'s reveal log`;
    for (const id of [...(info.item ? [info.item] : []), ...(info.items ?? [])])
      if (!log.items.includes(id))
        return `event Revealed carries ${id}, which is not in ${side}'s reveal log`;
  }
  if (k === 'Promoted' && side) {
    const shown = maskShown(state, side);
    if (shown && e.element !== shown)
      return `event Promoted shows ${String(e.element)} under an active Mask showing ${shown}`;
  }
  return null;
}

/** The element `side`'s Masquerade Mask shows while it is up, else null. */
function maskShown(state: GameState, side: Side): string | null {
  const mask = state.slices.masquerade_mask as { active?: Record<Side, boolean> } | undefined;
  const shown = state.armies[side].loadout.itemParams?.masquerade_mask?.element;
  return mask?.active?.[side] && shown ? shown : null;
}

function checkSpectatorProjection(p: Record<string, unknown>, state: GameState): string | null {
  const armies = p.armies as Record<Side, Record<string, unknown>> | undefined;
  for (const side of SIDES_) {
    const army = armies?.[side];
    if (army && (army.loadout !== undefined || army.sets !== undefined))
      return `$.armies.${side} carries its loadout`;
    const shown = maskShown(state, side);
    if (shown && Array.isArray(army?.elements) && army.elements.some((el) => el !== shown))
      return `$.armies.${side}.elements shows the true element under an active Mask`;
  }
  const pieces = p.pieces as { id: number; side: Side; element: string }[] | undefined;
  for (const piece of pieces ?? []) {
    const shown = maskShown(state, piece.side);
    if (shown && piece.element !== shown)
      return `$.pieces[${piece.id}].element = ${piece.element} under an active Mask showing ${shown}`;
  }
  if (Array.isArray(p.legal) && p.legal.length > 0) return '$.legal is not empty';
  const pending = p.pending as { request?: unknown } | null | undefined;
  if (pending && pending.request != null) return '$.pending carries the request';
  const slices = p.slices as Record<string, unknown> | undefined;
  const burns = (slices?.hot_foot as { pending?: unknown[] } | undefined)?.pending;
  if (burns && burns.length > 0) return '$.slices.hot_foot.pending shows a pending burn';
  for (const id of ['masquerade_mask', 'resonance_crystal', 'overabundance'])
    if (slices && id in slices) return `$.slices.${id} is private`;
  const usage = p.usage as Record<string, number> | undefined;
  for (const key of Object.keys(usage ?? {})) {
    const [pid, ability] = key.split(':');
    const piece = state.pieces[Number(pid)];
    if (!piece || !ability || !abilityKnown(state, piece.side, ability, piece.type))
      return `$.usage.${key} counts an ability not known to both players`;
  }
  return null;
}

/**
 * R-SEC-001 / R-INFO-005 scan of anything a spectator receives (M7 7.2): a spectator projection,
 * projected events, or a whole socket frame holding them. A spectator may see about each army only
 * what that army's opponent knows. `state` is the full state the payload was projected from (or any
 * later state of the same battle: knowledge only grows, so a later state never flags a clean
 * payload). Returns the first leak found, or null.
 */
export function scanSpectatorPayload(payload: unknown, state: GameState): string | null {
  const hidden = spectatorHiddenIds(state);
  let leak: string | null = null;
  const walk = (v: unknown, path: string): void => {
    if (leak) return;
    if (typeof v === 'string') {
      if (hidden.has(v)) leak = `${path} = "${v}"`;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      if (k.split(':').some((part) => hidden.has(part))) {
        leak = `${path}.${k} (key)`;
        return;
      }
      walk(x, `${path}.${k}`);
    }
    if (leak) return;
    if (typeof o.k === 'string' && typeof o.i === 'number') {
      const bad = checkSpectatorEvent(o, state);
      if (bad) leak = `${path}: ${bad}`;
    } else if (o.armies && o.pieces) {
      const bad = checkSpectatorProjection(o, state);
      if (bad) leak = `${path}: ${bad}`;
    }
  };
  walk(JSON.parse(JSON.stringify(payload ?? null)) as unknown, '$');
  return leak;
}
