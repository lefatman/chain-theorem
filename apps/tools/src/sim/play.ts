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

export function playSim(engine: Engine, g: SimGame): SimOutcome {
  let { state } = engine.newBattle({ format: g.format, white: g.white, black: g.black });
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
    const loser: Side = result.winner === 'white' ? 'black' : 'white';
    const known = new Set(Object.values(lastReveals[result.winner].abilities).flat());
    surprise =
      lastEvents.some(
        (e) =>
          e.k === 'AbilityTriggered' &&
          e.side === result.winner &&
          e.ability !== null &&
          !known.has(e.ability),
      ) && loser !== result.winner;
  }
  return { winner: result?.winner ?? null, reason: result?.reason ?? 'ply_cap', plies, surprise };
}
