/** One AI-vs-AI battle for the simulator. Each side searches its own projection only (9.4). */
import type { BattleEvent, Engine, FormatId, GameState, Loadout, Side } from '@chain-theorem/rules';
import { chooseOption, search, type Tier } from '@chain-theorem/ai';

export interface SimGame {
  format: FormatId;
  white: { loadout: Loadout; level: number; tier: Tier };
  black: { loadout: Loadout; level: number; tier: Tier };
  nodes: number;
  maxPlies: number;
  seed: number;
}

export interface SimOutcome {
  winner: Side | null;
  reason: string;
  plies: number;
  /** Decided by an ability of the winner that the loser had never seen (17.2 "surprise losses"). */
  surprise: boolean;
}

/**
 * The abilities of `side` that did something in an action's events: the source of an effect
 * capture, of a moved, revived or spawned piece or of a rewind, or a passive observed for the first
 * time (a leap, a turn, a denied capture). An ability that only named itself decided nothing: Scout
 * revealing the victim's set, a Capturing guard with nothing to guard. Used for 17.2 "surprise
 * losses": a battle decided by one of these that the loser had never seen.
 */
export function decisiveAbilities(events: readonly BattleEvent[], side: Side): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.k === 'Revealed') {
      if (e.side === side && e.cause === 'observed' && e.info.kind === 'ability')
        out.add(e.info.ability);
      continue;
    }
    if (
      (e.k === 'Captured' && e.by === 'effect') ||
      e.k === 'PieceMoved' ||
      e.k === 'PieceRevived' ||
      e.k === 'Spawned' ||
      e.k === 'Rewound'
    ) {
      const src = e.source;
      if (src?.kind === 'ability' && src.side === side) out.add(src.id);
    }
  }
  return out;
}

export function playSim(engine: Engine, g: SimGame): SimOutcome {
  let { state } = engine.newBattle({
    format: g.format,
    white: g.white,
    black: g.black,
    strict: true,
  });
  let plies = 0;
  let lastReveals: GameState['reveals'] | null = null;
  let lastEvents: BattleEvent[] = [];
  while (!state.result && plies < g.maxPlies) {
    const side = state.turn;
    const me = g[side];
    const pub = engine.project(state, side);
    const res = search(engine, pub, me.loadout, me.tier, {
      nodes: g.nodes,
      seed: g.seed * 1000 + plies,
    });
    lastReveals = state.reveals;
    let r = engine.applyAction(state, { kind: 'move', side, move: res.move });
    lastEvents = [...r.events];
    while (r.kind === 'needsChoice') {
      const req = r.request;
      const chooser = g[req.chooser];
      const option = chooseOption(
        engine,
        engine.project(r.state, req.chooser),
        chooser.loadout,
        req,
        chooser.tier,
      );
      r = engine.applyAction(r.state, {
        kind: 'choice',
        side: req.chooser,
        promptId: req.promptId,
        option,
      });
      lastEvents.push(...r.events);
    }
    state = r.state;
    plies++;
  }
  const result = state.result;
  let surprise = false;
  if (result?.winner && lastReveals) {
    // What the loser knew of the winner's abilities before the final action.
    const known = new Set(Object.values(lastReveals[result.winner].abilities).flat());
    surprise = [...decisiveAbilities(lastEvents, result.winner)].some((id) => !known.has(id));
  }
  return { winner: result?.winner ?? null, reason: result?.reason ?? 'ply_cap', plies, surprise };
}
