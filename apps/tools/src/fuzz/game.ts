/**
 * One fuzzed battle (M2 done-when, R-SEC-001, R-TEST-001 replay layer): random valid loadouts,
 * random legal moves and random prompt answers until the battle ends or hits the ply cap. Checks:
 * no crash, bounded chains (event count per action, depth <= 1), identical replay (events and final
 * hash), and projection safety (no unrevealed opponent id in any projected payload).
 */
import type {
  ActionInput,
  BattleEvent,
  Engine,
  FormatId,
  GameState,
  Loadout,
  PieceType,
  Side,
} from '@chain-theorem/rules';
import { fnv1a64 } from '@chain-theorem/rules';
import { Rng } from '../lib/rng.ts';
import { randomLoadout } from '../lib/loadouts.ts';

export interface FuzzOptions {
  maxPlies: number;
  scanProjection: boolean;
  checkReplay: boolean;
}

export interface FuzzGameResult {
  seed: number;
  plies: number;
  actions: number;
  events: number;
  maxChain: number;
  result: string;
  hash: string;
  capped: boolean;
  scanned: boolean;
  failure?: string;
}

const FORMATS: FormatId[] = ['first_blood', 'vanguard', 'full'];

interface Setup {
  format: FormatId;
  white: { level: number; loadout: Loadout };
  black: { level: number; loadout: Loadout };
}

export function makeSetup(engine: Engine, rng: Rng): Setup {
  const wl = 1 + rng.int(engine.caps.LEVEL_CAP);
  const bl = 1 + rng.int(engine.caps.LEVEL_CAP);
  return {
    format: rng.pick(FORMATS),
    white: { level: wl, loadout: randomLoadout(engine, rng, wl) },
    black: { level: bl, loadout: randomLoadout(engine, rng, bl) },
  };
}

function eventsDigest(events: readonly BattleEvent[]): string {
  const [a, b] = fnv1a64(JSON.stringify(events));
  return a.toString(16) + b.toString(16);
}

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

export function fuzzGame(engine: Engine, seed: number, opts: FuzzOptions): FuzzGameResult {
  const rng = new Rng(seed);
  const setup = makeSetup(engine, rng);
  const start = engine.newBattle({ ...setup, strict: true });
  let state = start.state;
  const actions: ActionInput[] = [];
  const allEvents: BattleEvent[] = [...start.events];
  let maxChain = 0;
  let plies = 0;
  const out = (failure?: string): FuzzGameResult => ({
    seed,
    plies,
    actions: actions.length,
    events: allEvents.length,
    maxChain,
    result: state.result ? `${state.result.winner ?? 'draw'}:${state.result.reason}` : 'capped',
    hash: engine.stateHash(state),
    capped: !state.result,
    scanned: opts.scanProjection,
    ...(failure ? { failure } : {}),
  });
  const check = (events: BattleEvent[], label: string): string | null => {
    maxChain = Math.max(maxChain, events.length);
    if (events.length > engine.caps.MAX_EVENTS_PER_ACTION)
      return `${label}: ${events.length} events`;
    for (const e of events)
      if (e.depth < 0 || e.depth > 1) return `${label}: event depth ${e.depth}`;
    if (opts.scanProjection) {
      for (const viewer of ['white', 'black'] as const) {
        const leak =
          scanPayload(engine.project(state, viewer), state, viewer) ??
          scanPayload(engine.projectEvents(state, events, viewer), state, viewer);
        if (leak) return `${label}: R-SEC-001 leak to ${viewer}: ${leak}`;
      }
    }
    return null;
  };
  try {
    const f0 = check(start.events, 'setup');
    if (f0) return out(f0);
    while (!state.result && plies < opts.maxPlies) {
      const side = state.turn;
      const moves = engine.legalMoves(state, side);
      if (moves.length === 0) return out(`no legal moves but no result at ply ${plies}`);
      // Bias toward captures so reaction chains get exercised.
      const captures = moves.filter((m) => (state.board[m.to] ?? -1) >= 0);
      const move = captures.length > 0 && rng.chance(0.5) ? rng.pick(captures) : rng.pick(moves);
      let input: ActionInput = { kind: 'move', side, move };
      let r = engine.applyAction(state, input);
      actions.push(input);
      state = r.state;
      allEvents.push(...r.events);
      let f = check(r.events, `ply ${plies}`);
      if (f) return out(f);
      let prompts = 0;
      while (r.kind === 'needsChoice') {
        if (++prompts > 32) return out(`too many prompts at ply ${plies}`);
        // DD-11: the suspended state must survive a JSON round trip (Durable Object restart).
        const stored = JSON.parse(JSON.stringify(r.state)) as GameState;
        input = {
          kind: 'choice',
          side: r.request.chooser,
          promptId: r.request.promptId,
          option: rng.int(r.request.options.length),
        };
        r = engine.applyAction(stored, input);
        actions.push(input);
        state = r.state;
        allEvents.push(...r.events);
        f = check(r.events, `ply ${plies} choice`);
        if (f) return out(f);
      }
      plies++;
    }
    if (opts.checkReplay) {
      const again = engine.newBattle({ ...setup, strict: true });
      let s = again.state;
      const replayEvents: BattleEvent[] = [...again.events];
      for (const a of actions) {
        const r = engine.applyAction(s, a);
        s = r.state;
        replayEvents.push(...r.events);
      }
      if (engine.stateHash(s) !== engine.stateHash(state)) return out('replay: final hash differs');
      if (eventsDigest(replayEvents) !== eventsDigest(allEvents))
        return out('replay: event stream differs');
    }
    return out();
  } catch (e) {
    return out(
      `crash at ply ${plies}: ${e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`,
    );
  }
}
