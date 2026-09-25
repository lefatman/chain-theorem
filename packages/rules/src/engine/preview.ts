/**
 * Move previews (R-INFO-004). The client previews a move using only its own loadout and revealed
 * opponent information; unknowns are flagged with "?". Previews never ask the server anything.
 * The same belief-state construction is used by NPC search, which must never read hidden data (9.4).
 */
import { opposite } from '../board.ts';
import type { ContentRegistry } from '../sdk/types.ts';
import {
  type ActionInput,
  type ApplyResult,
  type MoveInput,
  type BattleEvent,
  type BattleResult,
  type GameState,
  type Loadout,
  type Move,
  type PieceType,
  type Side,
  PIECE_TYPES,
  RulesError,
} from '../types.ts';
import { EventHost } from './host.ts';
import { expandSets, loadoutShape } from './loadout.ts';
import type { PublicState } from './project.ts';
import type { Runtime } from './runtime.ts';

export type Unknown =
  | { kind: 'victimAbilities'; pieceType: PieceType }
  | { kind: 'opponentItems' }
  | { kind: 'reactionAbilities'; pieceType: PieceType };

export interface Preview {
  legal: boolean;
  events: BattleEvent[];
  /** Board after the previewed action (piece id per square). */
  board: number[];
  result: BattleResult | null;
  /** "?" markers: things hidden opponent information could still change (8.4). */
  unknowns: Unknown[];
}

interface MiniEngine {
  applyAction(state: GameState, input: ActionInput): ApplyResult;
  legalMoves(state: GameState, side: Side): Move[];
  readonly registry: ContentRegistry;
}

/**
 * Build a full GameState from a projection: the viewer's own loadout is exact; the opponent's
 * loadout contains only revealed abilities (per piece type, in the order seen) and revealed items.
 */
export function beliefState(rt: Runtime, pub: PublicState, own: Loadout): GameState {
  const me = pub.viewer;
  const opp = opposite(me);
  const oppPub = pub.armies[opp];
  const known = oppPub.revealed;
  const oppSets = PIECE_TYPES.map((t) => [...(known.abilities[t] ?? [])]);
  const oppLoadout: Loadout = {
    elements: oppPub.elements.length > 0 ? [...oppPub.elements] : ['neutral'],
    items: [...known.items],
    sets: oppSets,
  };
  const armies = {
    [me]: {
      level: pub.armies[me].level,
      loadout: own,
      sets: expandSets(own.sets),
      consumedSlots: loadoutShape(own, rt.items, rt.caps).consumedSlots,
    },
    [opp]: {
      level: oppPub.level,
      loadout: oppLoadout,
      sets: expandSets(oppSets),
      consumedSlots: oppPub.consumedSlots,
    },
  } as GameState['armies'];
  const state: GameState = {
    schema: 1,
    contentVersion: pub.contentVersion,
    format: pub.format,
    board: [...pub.board],
    pieces: pub.pieces.map((p) => ({
      id: p.id,
      side: p.side,
      type: p.type,
      element: p.element,
      square: p.square,
      start: p.start,
      capturedSeq: p.capturedSeq,
    })),
    turn: pub.turn,
    castling: pub.castling,
    ep: pub.ep,
    halfmove: pub.halfmove,
    fullmove: pub.fullmove,
    ply: pub.ply,
    armies,
    usage: { ...pub.usage },
    slices: {},
    reveals: { white: pub.armies.white.revealed, black: pub.armies.black.revealed },
    objective: { ...pub.objective },
    captureSeq: Math.max(0, ...pub.pieces.map((p) => p.capturedSeq)),
    repetition: [],
    pending: null,
    result: pub.result,
    inCheck: pub.inCheck,
    eventSeq: pub.eventSeq,
  };
  const host = new EventHost(rt, state);
  const ctx = rt.ctx(host, null);
  const slices: Record<string, unknown> = {};
  for (const [id, hooks] of rt.slices) {
    slices[id] = id in pub.slices ? pub.slices[id] : hooks.stateSlice?.init(ctx);
  }
  state.slices = slices;
  return state;
}

/** Apply an action, answering every prompt with its default option (8.4 previews, AI search). */
export function applyWithDefaults(
  engine: MiniEngine,
  state: GameState,
  input: MoveInput,
  maxPrompts = 16,
): { state: GameState; events: BattleEvent[] } {
  let r = engine.applyAction(state, input);
  const events = [...r.events];
  let guard = 0;
  while (r.kind === 'needsChoice') {
    if (guard++ > maxPrompts) throw new RulesError('internal', 'too many prompts in one action');
    r = engine.applyAction(r.state, {
      kind: 'choice',
      side: r.request.chooser,
      promptId: r.request.promptId,
      option: r.request.defaultOption,
    });
    events.push(...r.events);
  }
  return { state: r.state, events };
}

export function preview(
  engine: MiniEngine,
  rt: Runtime,
  pub: PublicState,
  own: Loadout,
  move: Move,
): Preview {
  const state = beliefState(rt, pub, own);
  const me = pub.viewer;
  const opp = opposite(me);
  const legal = engine
    .legalMoves(state, me)
    .some((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
  if (!legal || state.turn !== me) {
    return { legal: false, events: [], board: [...pub.board], result: null, unknowns: [] };
  }
  const unknowns: Unknown[] = [];
  const known = pub.armies[opp].revealed;
  const victimId = pub.board[move.to] ?? -1;
  const victim = victimId >= 0 ? pub.pieces[victimId] : undefined;
  if (victim && victim.side === opp && !known.complete.includes(victim.type)) {
    unknowns.push({ kind: 'victimAbilities', pieceType: victim.type });
  }
  if (!known.allItems && pub.armies[opp].consumedSlots > 0) {
    const knownCost = known.items.reduce((sum, id) => sum + (rt.items.get(id)?.slotCost ?? 0), 0);
    if (knownCost < pub.armies[opp].consumedSlots) unknowns.push({ kind: 'opponentItems' });
  }
  try {
    const out = applyWithDefaults(engine, state, { kind: 'move', side: me, move });
    return {
      legal: true,
      events: out.events,
      board: out.state.board,
      result: out.state.result,
      unknowns,
    };
  } catch (e) {
    if (e instanceof RulesError)
      return { legal: false, events: [], board: [...pub.board], result: null, unknowns };
    throw e;
  }
}
