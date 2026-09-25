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
  PIECE_TYPES,
  applyWithDefaults,
  decodeMove,
  uciToMove,
} from '@chain-theorem/rules';
import { sideKnowledge } from './knowledge.ts';
import { type SearchCtx, VALUE, WIN, evalPos, negamax, play, quiesce, unplay } from './fast.ts';
import type { EffectSpec, Engine } from './types.ts';

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

/** Quiescence node budget per prompt option (options are short tactical lines). */
const OPTION_NODES = 20_000;
/**
 * Value of the extra move a bonus action grants. Quiescence only sees material, so without it a
 * capture that could also be made on the next normal turn (E6 Riposte) would tie with Decline.
 */
const TEMPO = 10;

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
  // Bulwark's spent list is a public slice (6.1), so it is in the belief state too.
  const spent = (state.slices.bulwark as { spent?: number[] } | undefined)?.spent ?? [];
  const bulwarkSpent = new Uint8Array(state.pieces.length);
  for (const id of spent) if (id >= 0 && id < bulwarkSpent.length) bulwarkSpent[id] = 1;
  return {
    pos,
    elem: state.pieces.map((p) => p.element),
    start: state.pieces.map((p) => p.start),
    bulwarkSpent,
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

/**
 * The fast-search context for `state` seen by `viewer` (unlimited budget): what the plies below the
 * root search on. Exported for tests and tools that probe how known reactions are modelled.
 */
export function searchContext(
  engine: Engine,
  state: GameState,
  viewer: Side,
  tier: Tier = 'trainer',
): SearchCtx {
  return makeCtx(engine, state, viewer, TIERS[tier], {
    maxNodes: Infinity,
    deadline: Infinity,
    now: null,
  });
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
        if (t > alpha) alpha = t;
        continue;
      }
      // The first iteration (every root move checked by quiescence, a few hundred nodes each) always
      // completes, so no move keeps an optimistic static score that a one-move capture refutes,
      // however loaded the device. Deeper iterations respect the budget, also between root moves
      // (R-FMT-005 ~50 ms): a wide root of shallow subtrees would otherwise never reach the check.
      const first = d === 0;
      if (!first && (nodes >= maxNodes || (now !== null && now() >= deadline))) {
        aborted = true;
        break;
      }
      const ctx = first
        ? makeCtx(engine, c.state, me, tier, { maxNodes: Infinity, deadline: Infinity, now: null })
        : makeCtx(engine, c.state, me, tier, { maxNodes: maxNodes - nodes, deadline, now });
      // Every iteration, the first included, only asks whether this move beats the best so far.
      // The window is shifted by this move's noise: a cut-off child scores at most alpha - 1
      // after its noise is added, so a failed bound can never overtake the best move.
      const nz = noise(c.move);
      const beta = -(alpha - nz) + 1;
      const raw =
        d === 0 ? -quiesce(ctx, -Infinity, beta, 6) : -negamax(ctx, d, -Infinity, beta, 1);
      nodes += ctx.nodes;
      if (ctx.aborted) {
        aborted = true;
        break;
      }
      const score = raw + nz;
      next.set(c, score);
      if (score > alpha) alpha = score;
    }
    // Partial deeper iterations are discarded.
    if (aborted && d > 0) break;
    for (const [c, s] of next) c.score = s;
    if (aborted) break;
    completedDepth = d + 1;
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
 * The fixed square a chosen piece is moved to by `abilityId` (its starting square for a
 * `move(chosen, start)` effect), or -1 when the destination is chosen later or is not fixed.
 */
function fixedDestination(engine: Engine, abilityId: string, start: number): number {
  const def = engine.registry.abilities.find((a) => a.id === abilityId);
  if (!def) return -1;
  const find = (list: readonly EffectSpec[]): number => {
    for (const e of list) {
      if (e.op === 'move' && e.piece.t === 'chosen') return e.to.s === 'start' ? start : -1;
      const inner = e.op === 'when' ? find(e.then) : e.op === 'atChainEnd' ? find(e.effects) : -1;
      if (inner !== -1) return inner;
    }
    return -1;
  };
  const base = find(def.effects);
  return base !== -1 ? base : def.attuned ? find(def.attuned.effects) : -1;
}

/**
 * Answer a mid-action prompt (5.4) from public information: bonus moves and squares by evaluation,
 * effect-capture targets by value. Ties go to the lowest option index (the default).
 *
 * A prompt arrives in the middle of an action, so the side to move in `pub` is the acting player
 * and the other side moves once the chain settles. Every option is scored from the chooser's point
 * of view with that next mover to move (a quiescence search), so a piece left en prise after a
 * declined bonus move or on a chosen square is seen as lost. Bonus moves are played with the known
 * reactions (fast.ts `play`): a revealed Poisoned Meat captor removes the capturing piece and a
 * format objective reached in the chain ends the battle (E4).
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
    maxNodes: OPTION_NODES,
    deadline: Infinity,
    now: null,
  });
  const pos = base.pos;
  const meCode = me === 'white' ? 0 : 1;
  const actor = pos.turn;
  /** Score the current scratch position for the chooser, with `mover` to move next. */
  const settle = (mover: number): number => {
    const saved = pos.turn;
    pos.turn = mover;
    base.nodes = 0;
    base.aborted = false;
    const q = quiesce(base, -Infinity, Infinity, 4);
    pos.turn = saved;
    return mover === meCode ? q : -q;
  };
  let best = req.defaultOption;
  let bestScore = -Infinity;
  req.options.forEach((opt, i) => {
    let score: number;
    switch (opt.kind) {
      case 'decline':
        score = settle(actor ^ 1);
        break;
      case 'piece': {
        // Harm the most valuable enemy piece, shield the most valuable own piece; a piece that
        // will be moved or revived scores level (its square prompt decides), unless the ability
        // sends it to a fixed square (Snowbound, Permafrost: its starting square). After the
        // capture that is scored by placing the piece there; before it (a Capturing prompt, whose
        // capture is still to come) sending the most valuable enemy piece home scores best.
        const p = belief.pieces[opt.piece];
        const v = p ? (VALUE[PIECE_TYPES.indexOf(p.type)] ?? 0) : 0;
        const mine = p?.side === me;
        const home =
          req.purpose === 'move' && p ? fixedDestination(engine, req.source.ability, p.start) : -1;
        const beforeCapture =
          engine.registry.abilities.find((a) => a.id === req.source.ability)?.category ===
          'CAPTURING';
        if (req.purpose === 'protect') score = mine ? v : -v;
        else if (home >= 0 && beforeCapture) score = mine ? -v : v;
        else if (home >= 0 && p && p.square >= 0 && (pos.board[home] as number) < 0) {
          const from = p.square;
          pos.board[from] = -1;
          pos.board[home] = opt.piece;
          pos.psq[opt.piece] = home;
          score = settle(actor ^ 1);
          pos.board[home] = -1;
          pos.board[from] = opt.piece;
          pos.psq[opt.piece] = from;
        } else if (req.purpose === 'move' || req.purpose === 'revive') score = 0;
        else score = mine ? -v : v;
        break;
      }
      case 'square': {
        // Place the piece the effect moves (the captor for a push, the bearer for a step back).
        const id = req.subject ?? req.source.piece;
        const from = pos.psq[id] as number;
        const there = pos.board[opt.square] as number;
        if (from >= 0) pos.board[from] = -1;
        pos.board[opt.square] = id;
        pos.psq[id] = opt.square;
        score = settle(actor ^ 1);
        pos.board[opt.square] = there;
        pos.psq[id] = from;
        if (from >= 0) pos.board[from] = id;
        break;
      }
      case 'move': {
        const m = pos.legal(meCode).find((x) => {
          const d = decodeMove(x);
          return d.from === opt.from && d.to === opt.to && d.promotion === opt.promotion;
        });
        if (m === undefined) {
          score = -Infinity;
          break;
        }
        // The bonus move is the chooser's; `play` flips the side to move to the next mover.
        const played = play(base, m);
        if (played.terminal !== 0) score = played.terminal;
        else score = settle(pos.turn) + played.bias + TEMPO;
        unplay(base, played);
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

export { WIN, play, unplay };
export type { SearchCtx, Played } from './fast.ts';
