/**
 * @chain-theorem/ai — NPC search (M3 step 3.3, R-FMT-005). Iterative-deepening alpha-beta with a
 * time or node budget and an ability-aware evaluation; Wild, Trainer and Elite tiers. Depends only on
 * @chain-theorem/rules. NPCs see only their own projection (9.4): search runs on the belief state
 * built from it, never on hidden data.
 *
 * Root moves are applied with the full rules engine (every ability resolves exactly); the plies
 * below the root use the fast position search with known-ability approximations (fast.ts).
 */
import {
  type ChoiceRequest,
  type GameState,
  type Loadout,
  type Move,
  type PublicState,
  type Side,
  applyWithDefaults,
  mFrom,
  mPromo,
  mTo,
  uciToMove,
} from '@chain-theorem/rules';
import { sideKnowledge } from './knowledge.ts';
import { type SearchCtx, WIN, evalPos, negamax, quiesce } from './fast.ts';
import type { Engine } from './types.ts';

export type Tier = 'wild' | 'trainer' | 'elite';

export interface TierDef {
  /** Total search depth in plies, root included (9.4: Wild 2, Trainer 3, Elite 4). */
  depth: number;
  /** Default time budget per move in ms (9.4: about 50 ms, tunable). */
  ms: number;
  /** Node budget used when no clock is supplied (deterministic: simulator, tests). */
  nodes: number;
  abilityAware: boolean;
  /** Risk charged for capturing a piece whose abilities are unknown (fraction of captor value). */
  risk: number;
  /** Deterministic score noise in centipawns (keeps wild encounters beatable). */
  noise: number;
}

export const TIERS: Record<Tier, TierDef> = {
  wild: { depth: 2, ms: 50, nodes: 4_000, abilityAware: false, risk: 0, noise: 40 },
  trainer: { depth: 3, ms: 50, nodes: 20_000, abilityAware: true, risk: 0.08, noise: 8 },
  elite: { depth: 4, ms: 50, nodes: 60_000, abilityAware: true, risk: 0.12, noise: 0 },
};

export interface SearchOptions {
  /** Time budget in ms; requires `now`. */
  ms?: number;
  now?: () => number;
  /** Node budget (default from the tier when no clock is given). */
  nodes?: number;
  /** Override the tier depth. */
  depth?: number;
  /** Seed for deterministic noise. */
  seed?: number;
}

export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  nodes: number;
  scores: { uci: string; score: number }[];
}

function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function moveKey(m: Move): number {
  return m.from * 64 + m.to + (m.promotion ? m.promotion.length * 4096 : 0);
}

function makeCtx(
  engine: Engine,
  state: GameState,
  viewer: Side,
  tier: TierDef,
  budget: { maxNodes: number; deadline: number; now: (() => number) | null },
): SearchCtx {
  const pos = engine.position(state);
  const need = engine.caps.FORMATS[state.format]?.objective?.nonPawnCaptures ?? null;
  return {
    pos,
    elem: state.pieces.map((p) => p.element),
    know: [
      sideKnowledge(engine, state, 'white', viewer),
      sideKnowledge(engine, state, 'black', viewer),
    ],
    abilityAware: tier.abilityAware,
    risk: tier.risk,
    silence: engine.caps.SILENCE_SCOPE,
    objectiveNeed: need,
    objective: [state.objective.white, state.objective.black],
    nodes: 0,
    maxNodes: budget.maxNodes,
    deadline: budget.deadline,
    now: budget.now,
    aborted: false,
  };
}

function terminalScore(state: GameState, me: Side): number | null {
  if (!state.result) return null;
  if (state.result.winner === null) return 0;
  return state.result.winner === me ? WIN : -WIN;
}

/** Choose a move for the viewer of `pub` using only public information plus its own loadout. */
export function search(
  engine: Engine,
  pub: PublicState,
  own: Loadout,
  tierName: Tier,
  opts: SearchOptions = {},
): SearchResult {
  const tier = TIERS[tierName];
  const me = pub.viewer;
  const belief = engine.beliefState(pub, own);
  const legal = pub.legal.length > 0 ? pub.legal.map(uciToMove) : engine.legalMoves(belief, me);
  if (legal.length === 0) throw new Error('no legal moves');
  const now = opts.now ?? null;
  const start = now ? now() : 0;
  const deadline = now ? start + (opts.ms ?? tier.ms) : Infinity;
  const maxNodes = opts.nodes ?? (now ? Infinity : tier.nodes);
  const depthLimit = Math.max(1, opts.depth ?? tier.depth);
  const seed = opts.seed ?? pub.ply;

  interface Child {
    move: Move;
    state: GameState | null;
    score: number;
  }
  const children: Child[] = legal.map((move) => {
    try {
      const r = applyWithDefaults(engine, belief, { kind: 'move', side: me, move });
      return { move, state: r.state, score: 0 };
    } catch {
      return { move, state: null, score: -Infinity };
    }
  });
  let nodes = 0;
  let completedDepth = 0;
  const noise = (m: Move) =>
    tier.noise > 0 ? (hash32(seed, moveKey(m)) % (2 * tier.noise + 1)) - tier.noise : 0;
  for (const c of children) {
    if (!c.state) continue;
    const t = terminalScore(c.state, me);
    if (t !== null) {
      c.score = t;
      continue;
    }
    const ctx = makeCtx(engine, c.state, me, tier, {
      maxNodes: Infinity,
      deadline: Infinity,
      now: null,
    });
    c.score = -evalPos(ctx, ctx.pos.turn) + noise(c.move);
  }
  // Iterative deepening over the plies below the root.
  for (let d = 0; d < depthLimit; d++) {
    const order = [...children].sort((a, b) => b.score - a.score);
    const next = new Map<Child, number>();
    let aborted = false;
    let alpha = -Infinity;
    for (const c of order) {
      if (!c.state) continue;
      const t = terminalScore(c.state, me);
      if (t !== null) {
        next.set(c, t);
        continue;
      }
      const ctx = makeCtx(engine, c.state, me, tier, { maxNodes: maxNodes - nodes, deadline, now });
      const raw =
        d === 0
          ? -quiesce(ctx, -Infinity, Infinity, 6)
          : -negamax(ctx, d, -Infinity, -alpha + 1, 1);
      nodes += ctx.nodes;
      if (ctx.aborted) {
        aborted = true;
        break;
      }
      const score = raw + noise(c.move);
      next.set(c, score);
      if (score > alpha) alpha = score;
    }
    if (aborted && d > 0) break;
    for (const [c, s] of next) c.score = s;
    completedDepth = d + 1;
    if (aborted) break;
  }
  const ranked = [...children].sort(
    (a, b) => b.score - a.score || moveKey(a.move) - moveKey(b.move),
  );
  const best = ranked[0] as Child;
  return {
    move: best.move,
    score: best.score,
    depth: completedDepth,
    nodes,
    scores: ranked.map((c) => ({ uci: `${c.move.from}-${c.move.to}`, score: c.score })),
  };
}

export function chooseMove(
  engine: Engine,
  pub: PublicState,
  own: Loadout,
  tier: Tier,
  opts: SearchOptions = {},
): Move {
  return search(engine, pub, own, tier, opts).move;
}

/** Static evaluation of a state for `side` (centipawns, positive is good for `side`). */
export function evaluate(
  engine: Engine,
  state: GameState,
  side: Side,
  tier: Tier = 'trainer',
): number {
  const ctx = makeCtx(engine, state, side, TIERS[tier], {
    maxNodes: Infinity,
    deadline: Infinity,
    now: null,
  });
  return evalPos(ctx, side === 'white' ? 0 : 1);
}

/**
 * Answer a mid-action prompt (5.4) from public information: bonus moves and squares by evaluation,
 * effect-capture targets by value. Ties go to the lowest option index (the default).
 */
export function chooseOption(
  engine: Engine,
  pub: PublicState,
  own: Loadout,
  req: ChoiceRequest,
  tierName: Tier = 'trainer',
): number {
  const tier = TIERS[tierName];
  const me = req.chooser;
  const belief = engine.beliefState(pub, own);
  const base = makeCtx(engine, belief, me, tier, {
    maxNodes: 20_000,
    deadline: Infinity,
    now: null,
  });
  const meCode = me === 'white' ? 0 : 1;
  let best = req.defaultOption;
  let bestScore = -Infinity;
  req.options.forEach((opt, i) => {
    let score: number;
    const pos = base.pos;
    switch (opt.kind) {
      case 'decline':
        score = evalPos(base, meCode);
        break;
      case 'piece': {
        const p = belief.pieces[opt.piece];
        const v = p
          ? ([100, 320, 330, 500, 900, 0][
              ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].indexOf(p.type)
            ] ?? 0)
          : 0;
        score = p && p.side !== me ? v : -v;
        break;
      }
      case 'square': {
        const id = req.source.piece;
        const from = pos.psq[id] as number;
        if (from >= 0) {
          pos.board[from] = -1;
        }
        pos.board[opt.square] = id;
        pos.psq[id] = opt.square;
        score = evalPos(base, meCode);
        pos.board[opt.square] = -1;
        pos.psq[id] = from;
        if (from >= 0) pos.board[from] = id;
        break;
      }
      case 'move': {
        const moves = pos.legal(meCode);
        const m = moves.find(
          (x) => mFrom(x) === opt.from && mTo(x) === opt.to && (mPromo(x) === 0) === !opt.promotion,
        );
        if (m === undefined) {
          score = -Infinity;
          break;
        }
        const u = pos.make(m);
        score = -quiesce(base, -Infinity, Infinity, 4);
        pos.unmake(u);
        break;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export { WIN };
