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
