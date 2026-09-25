/**
 * One fuzzed battle (M2 done-when, R-SEC-001, R-TEST-001 replay layer): random valid loadouts,
 * random legal moves and random prompt answers until the battle ends or hits the ply cap. Checks:
 * no crash, bounded chains (event count per action, depth <= 1), identical replay (events and final
 * hash), and projection safety (no unrevealed opponent id in any projected payload, and nothing a
 * spectator may not know in the spectator projection and events, M7 7.2).
 */
import type {
  ActionInput,
  BattleEvent,
  Engine,
  FormatId,
  GameState,
  Loadout,
} from '@chain-theorem/rules';
import { fnv1a64 } from '@chain-theorem/rules';
import { scanPayload, scanSpectatorPayload } from '@chain-theorem/content/scan';
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
      // M7 7.2: spectators see only what both players know (R-INFO-005).
      const spec =
        scanSpectatorPayload(engine.projectSpectator(state), state) ??
        scanSpectatorPayload(engine.projectSpectatorEvents(state, events), state);
      if (spec) return `${label}: R-SEC-001 leak to a spectator: ${spec}`;
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
