/**
 * Server-side NPC replies (9.4, R-FMT-005). An NPC sees only its own projection plus its own loadout
 * (the policy is never handed the full GameState) and answers inside the same input call.
 *
 * Budgets are node counts, not milliseconds: a Worker does not advance `Date.now()` during pure CPU
 * work, so a time budget cannot stop a search there, and a node budget keeps every reply
 * deterministic (same battle, same replies). The counts below keep a reply near the 50 ms CPU target
 * of 9.4; `npc.unit.test.ts` measures them (SERVER_NPC_BENCH=1). The first search iteration
 * (quiescence over every root move) always completes, so a very wide position can exceed the target.
 */
import { TIERS, chooseOption, evaluate, search } from '@chain-theorem/ai';
import type { ChoiceRequest, Engine, Loadout, Move, PublicState } from '@chain-theorem/rules';
import type { Tier } from './types.ts';

/**
 * Search nodes per NPC move (9.4: about 50 ms CPU per move; PROVISIONAL, tunable). Measured with
 * SERVER_NPC_BENCH=1 over 40 positions from random legal battles (Node 22, 2.8 GHz Xeon):
 * Wild 4,000 nodes (tier default) mean 8 ms, max 19 ms, depth 2; Trainer 20,000 (tier default) mean
 * 13 ms, max 41 ms, depth 3; Elite 12,000 mean 40 ms, p90 52 ms, max 58 ms, depth 3.45 (the
 * simulator default of 60,000 took about 130 ms, so Elite reaches depth 4 only in quiet positions).
 */
export const NPC_NODES: Record<Tier, number> = {
  wild: TIERS.wild.nodes,
  trainer: TIERS.trainer.nodes,
  elite: 12_000,
};

/**
 * An NPC accepts a draw offer only when its own evaluation (from its belief state: projection plus
 * own loadout) is at least this many centipawns worse for it (PROVISIONAL).
 */
export const NPC_DRAW_ACCEPT_CP = -150;

/** How an NPC answers. Inputs are the NPC's projection and its own loadout, nothing else (9.4). */
export interface NpcPolicy {
  move(pub: PublicState, own: Loadout, tier: Tier): Move;
  option(pub: PublicState, own: Loadout, request: ChoiceRequest, tier: Tier): number;
  acceptDraw(pub: PublicState, own: Loadout, tier: Tier): boolean;
}

export function searchPolicy(engine: Engine, nodes: Partial<Record<Tier, number>> = {}): NpcPolicy {
  return {
    move: (pub, own, tier) =>
      search(engine, pub, own, tier, { nodes: nodes[tier] ?? NPC_NODES[tier] }).move,
    option: (pub, own, request, tier) => chooseOption(engine, pub, own, request, tier),
    acceptDraw: (pub, own, tier) =>
      evaluate(engine, engine.beliefState(pub, own), pub.viewer, tier) <= NPC_DRAW_ACCEPT_CP,
  };
}
