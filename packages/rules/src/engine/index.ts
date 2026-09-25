/**
 * createEngine(registry, CAPS) — the public rules engine API (R-DATA-002, spec 13.2). Every function
 * is pure: inputs are never mutated, there are no clocks, no I/O and no unseeded randomness (INV-04).
 */
import { START_FEN, parseFen, piecesFromFen, sanitizeCastling, toFen as fenOf } from '../board.ts';
import { F_CAPTURE, Pos, decodeMove, encodeMove } from '../movegen.ts';
import { moveToUci } from '../board.ts';
import type { Caps, ContentRegistry } from '../sdk/types.ts';
import {
  type ActionInput,
  type ApplyResult,
  type ArmyState,
  type BattleEvent,
  type BattleSetup,
  type ChoiceOption,
  type GameState,
  type Loadout,
  type LoadoutValidation,
  type Move,
  type MoveInput,
  type PlayerFacts,
  type Side,
  RulesError,
} from '../types.ts';
import { ActionRun, NeedChoice } from './action.ts';
import { type Deductions, deduce } from './deduce.ts';
import { EventHost, emptyReveal } from './host.ts';
import { expandSets, loadoutShape, validateLoadout } from './loadout.ts';
import { type Preview, beliefState, preview } from './preview.ts';
import { type PublicEvent, type PublicState, project, projectEvents } from './project.ts';
import { Runtime } from './runtime.ts';

export interface Engine {
  readonly registry: ContentRegistry;
  readonly caps: Caps;
  newBattle(setup: BattleSetup): { state: GameState; events: BattleEvent[] };
  legalMoves(state: GameState, side: Side): Move[];
  applyAction(state: GameState, input: ActionInput): ApplyResult;
  project(state: GameState, viewer: Side): PublicState;
  projectEvents(state: GameState, events: readonly BattleEvent[], viewer: Side): PublicEvent[];
  preview(pub: PublicState, own: Loadout, move: Move): Preview;
  stateHash(state: GameState): string;
  validateLoadout(loadout: Loadout, player: PlayerFacts): LoadoutValidation;
  deduce(pub: PublicState): Deductions;
  toFen(state: GameState): string;
  /** Charges left for an ability on a piece (UI pips, AI). */
  remainingCharges(state: GameState, pieceId: number, abilityId: string): number;
  /**
   * A full state built from a projection plus the viewer's own loadout: the opponent carries only
   * revealed abilities and items (previews, NPC search; NPCs never read hidden data, 9.4).
   */
  beliefState(pub: PublicState, own: Loadout): GameState;
  /** A scratch position with hook-derived movement rules (fast search). */
  position(state: GameState): Pos;
}

/** Cheap structural clone. Nested records that are replaced copy-on-write are shared. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    board: s.board.slice(),
    pieces: s.pieces.map((p) => ({ ...p })),
    usage: { ...s.usage },
    slices: { ...s.slices },
    reveals: { white: s.reveals.white, black: s.reveals.black },
    objective: { ...s.objective },
  };
}

function armyFor(rt: Runtime, entry: BattleSetup['white']): ArmyState {
  const loadout: Loadout = JSON.parse(JSON.stringify(entry.loadout)) as Loadout;
  if (loadout.sets.length !== 1 && loadout.sets.length !== 6) {
    throw new RulesError('bad_setup', 'a loadout has 1 or 6 ability sets');
  }
  if (loadout.elements.length < 1 || loadout.elements.length > 2) {
    throw new RulesError('bad_setup', 'a loadout has 1 or 2 elements');
  }
  return {
    level: entry.level,
    loadout,
    sets: expandSets(loadout.sets),
    consumedSlots: loadoutShape(loadout, rt.items, rt.caps).consumedSlots,
  };
}

export function createEngine(registry: ContentRegistry, caps: Caps): Engine {
  const rt = new Runtime(registry, caps);

  function rulesPos(state: GameState): Pos {
    const host = new EventHost(rt, state);
    return Pos.fromState(state, rt.moveRules(host));
  }

  function legalEncoded(state: GameState, side: Side): number[] {
    if (state.result || state.pending) return [];
    const pos = rulesPos(state);
    if (side !== state.turn) pos.ep = -1;
    return pos.legal(side === 'white' ? 0 : 1);
  }

  function newBattle(setup: BattleSetup): { state: GameState; events: BattleEvent[] } {
    if (!caps.FORMATS[setup.format])
      throw new RulesError('bad_setup', `unknown format ${setup.format}`);
    const parsed = parseFen(setup.fen ?? START_FEN);
    const white = armyFor(rt, setup.white);
    const black = armyFor(rt, setup.black);
    const { board, pieces } = piecesFromFen(parsed, {
      white: white.loadout.elements,
      black: black.loadout.elements,
    });
    const state: GameState = {
      schema: 1,
      contentVersion: registry.version,
      format: setup.format,
      board,
      pieces,
      turn: parsed.turn,
      castling: sanitizeCastling(parsed.castling, (sq) => {
        const id = board[sq] ?? -1;
        return id >= 0 ? (pieces[id] ?? null) : null;
      }),
      ep: parsed.ep,
      halfmove: parsed.halfmove,
      fullmove: parsed.fullmove,
      ply: 0,
      armies: { white, black },
      usage: {},
      slices: {},
      reveals: { white: emptyReveal(), black: emptyReveal() },
      objective: { white: 0, black: 0 },
      captureSeq: 0,
      repetition: [],
      pending: null,
      result: null,
      inCheck: null,
      eventSeq: 0,
    };
    const host = new EventHost(rt, state);
    const initCtx = rt.ctx(host, null);
    const slices: Record<string, unknown> = {};
    for (const [id, hooks] of rt.slices) slices[id] = hooks.stateSlice?.init(initCtx);
    state.slices = slices;
    host.emit({ k: 'BattleStarted', format: setup.format, contentVersion: registry.version });
    for (const e of rt.hook(state, 'onBattleStart')) e.hooks.onBattleStart?.(rt.ctx(host, e));
    const pos = rulesPos(state);
    for (const side of ['white', 'black'] as const) {
      if (pos.inCheck(side === 'white' ? 0 : 1)) {
        state.inCheck = state.inCheck ?? side;
        const king = state.pieces.find((p) => p.side === side && p.type === 'king');
        if (king) host.emit({ k: 'Check', side, square: king.square });
      }
    }
    state.repetition = [rt.stateHash(state)];
    return { state, events: host.events };
  }

  function runAction(
    pre: GameState,
    input: MoveInput,
    answers: ChoiceOption[],
    skip: number,
    preUsed: number,
  ): ApplyResult {
    const legal = legalEncoded(pre, input.side);
    const want = encodeMove(input.move.from, input.move.to);
    const promo = input.move.promotion;
    const m = legal.find((x) => (x & 0xfff) === want && decodeMove(x).promotion === promo);
    if (m === undefined)
      throw new RulesError('illegal_move', `illegal move ${moveToUci(input.move)}`);
    const s = cloneState(pre);
    const run = new ActionRun(rt, s, input, answers, preUsed);
    try {
      run.execute(m);
    } catch (e) {
      if (e instanceof NeedChoice) {
        s.pending = {
          pre,
          input,
          answers: [...run.made],
          request: e.request,
          emitted: run.events.length,
          queue: run.queueSnapshot(),
          preUsed: run.preUsed,
        };
        return {
          kind: 'needsChoice',
          state: s,
          events: run.events.slice(skip),
          request: e.request,
        };
      }
      throw e;
    }
    return { kind: 'done', state: s, events: run.events.slice(skip) };
  }

  function endBattle(
    state: GameState,
    winner: Side | null,
    reason: NonNullable<GameState['result']>['reason'],
  ): ApplyResult {
    if (state.result) throw new RulesError('battle_over', 'the battle is over');
    const s = cloneState(state);
    s.pending = null;
    const host = new EventHost(rt, s);
    s.result = { winner, reason };
    host.emit({ k: 'BattleEnded', result: s.result });
    return { kind: 'done', state: s, events: host.events };
  }

  function applyAction(state: GameState, input: ActionInput): ApplyResult {
    switch (input.kind) {
      case 'move': {
        if (state.result) throw new RulesError('battle_over', 'the battle is over');
        if (state.pending) throw new RulesError('pending_choice', 'a choice is pending');
        if (input.side !== state.turn)
          throw new RulesError('not_your_turn', `it is ${state.turn}'s turn`);
        return runAction(state, input, [], 0, 0);
      }
      case 'choice': {
        if (state.result) throw new RulesError('battle_over', 'the battle is over');
        const pend = state.pending;
        if (!pend) throw new RulesError('no_pending_choice', 'no choice is pending');
        if (input.side !== pend.request.chooser)
          throw new RulesError('not_your_turn', 'this choice belongs to the other player');
        if (input.promptId !== pend.request.promptId)
          throw new RulesError('bad_choice', 'stale prompt');
        const option = pend.request.options[input.option];
        if (!Number.isInteger(input.option) || !option)
          throw new RulesError('bad_choice', 'no such option');
        return runAction(
          pend.pre,
          pend.input,
          [...pend.answers, option],
          pend.emitted,
          pend.preUsed,
        );
      }
      case 'resign':
        return endBattle(state, input.side === 'white' ? 'black' : 'white', 'resign');
      case 'timeout':
        return endBattle(state, input.side === 'white' ? 'black' : 'white', 'timeout');
      case 'abandon':
        return endBattle(state, input.side === 'white' ? 'black' : 'white', 'abandon');
      case 'agreeDraw':
        return endBattle(state, null, 'agreement');
    }
  }

  const engine: Engine = {
    registry,
    caps,
    newBattle,
    legalMoves: (state, side) => legalEncoded(state, side).map(decodeMove),
    applyAction,
    project: (state, viewer) => {
      const legal =
        state.turn === viewer
          ? legalEncoded(state, viewer).map((m) => moveToUci(decodeMove(m)))
          : [];
      return project(rt, state, viewer, legal);
    },
    projectEvents: (state, events, viewer) => projectEvents(state, events, viewer),
    preview: (pub, own, move) => preview(engine, rt, pub, own, move),
    stateHash: (state) => rt.stateHash(state),
    validateLoadout: (loadout, player) =>
      validateLoadout(loadout, player, rt.abilities, rt.items, caps),
    deduce: (pub) => deduce(rt, pub),
    toFen: (state) => fenOf(state),
    beliefState: (pub, own) => beliefState(rt, pub, own),
    position: (state) => rulesPos(state),
    remainingCharges: (state, pieceId, abilityId) => {
      const def = rt.ability(abilityId);
      if (!def || def.limits.charges === undefined) return Infinity;
      const host = new EventHost(rt, state);
      let max = def.limits.charges;
      const view = rt.view(host, pieceId);
      for (const e of rt.hook(state, 'modifyCharges'))
        max = e.hooks.modifyCharges?.(rt.ctx(host, e), view, def, max) ?? max;
      return max - (state.usage[`${pieceId}:${abilityId}`] ?? 0);
    },
  };
  return engine;
}

export { F_CAPTURE };
