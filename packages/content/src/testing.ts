/**
 * Scenario helper for module tests and golden tests (13.5 "scenario() test": board setup, loadouts,
 * moves, expected events). Tests bypass loadout validation on purpose so they can use 'neutral'
 * elements and any ability mix (DD-23).
 */
import {
  type ApplyResult,
  type BattleEvent,
  type ChoiceOption,
  type ChoiceRequest,
  type Engine,
  type FormatId,
  type GameState,
  type Loadout,
  type Side,
  parseSquare,
  uciToMove,
} from '@chain-theorem/rules';
import type { Caps } from '@chain-theorem/rules/sdk';
import { makeEngine, engine as defaultEngine } from '../index.ts';

export interface ArmySpec {
  level?: number;
  elements?: Loadout['elements'];
  items?: string[];
  itemParams?: Loadout['itemParams'];
  /** One army-wide set, or six per-type sets. */
  sets?: string[][];
  /** Shorthand for one army-wide set. */
  abilities?: string[];
}

export type Answer = number | ChoiceOption | ((req: ChoiceRequest) => number);

export interface ScenarioSpec {
  fen?: string;
  format?: FormatId;
  white?: ArmySpec;
  black?: ArmySpec;
  caps?: Partial<Caps>;
  /** UCI moves, applied in order by the side to move. */
  moves?: string[];
  /** Answers for prompts, consumed in order; default is each prompt's defaultOption. */
  answers?: Answer[];
}

export interface ScenarioStep {
  uci: string;
  side: Side;
  events: BattleEvent[];
  prompts: ChoiceRequest[];
}

export interface ScenarioResult {
  engine: Engine;
  initial: GameState;
  state: GameState;
  /** Events of all moves (setup events excluded). */
  events: BattleEvent[];
  setupEvents: BattleEvent[];
  steps: ScenarioStep[];
  prompts: ChoiceRequest[];
  /** Kinds of the events, in order, handy for snapshot-style assertions. */
  kinds: string[];
}

export function loadoutOf(spec: ArmySpec | undefined): Loadout {
  const sets = spec?.sets ?? [spec?.abilities ?? []];
  const loadout: Loadout = {
    elements: spec?.elements ?? ['neutral'],
    items: spec?.items ?? [],
    sets,
  };
  if (spec?.itemParams) loadout.itemParams = spec.itemParams;
  return loadout;
}

function pickAnswer(answer: Answer | undefined, req: ChoiceRequest): number {
  if (answer === undefined) return req.defaultOption;
  if (typeof answer === 'number') return answer;
  if (typeof answer === 'function') return answer(req);
  const idx = req.options.findIndex((o) => JSON.stringify(o) === JSON.stringify(answer));
  if (idx < 0)
    throw new Error(
      `scenario answer ${JSON.stringify(answer)} is not an option of ${JSON.stringify(req.options)}`,
    );
  return idx;
}

/** Start a battle from a spec without applying moves. */
export function setup(spec: ScenarioSpec): {
  engine: Engine;
  state: GameState;
  events: BattleEvent[];
} {
  const engine = spec.caps ? makeEngine(spec.caps) : defaultEngine;
  const { state, events } = engine.newBattle({
    format: spec.format ?? 'full',
    white: { level: spec.white?.level ?? 30, loadout: loadoutOf(spec.white) },
    black: { level: spec.black?.level ?? 30, loadout: loadoutOf(spec.black) },
    ...(spec.fen ? { fen: spec.fen } : {}),
  });
  return { engine, state, events };
}

/** Apply one UCI move, answering prompts from `answers` (mutated: consumed from the front). */
export function play(
  engine: Engine,
  state: GameState,
  uci: string,
  answers: Answer[] = [],
): { state: GameState; step: ScenarioStep } {
  const side = state.turn;
  let r: ApplyResult = engine.applyAction(state, { kind: 'move', side, move: uciToMove(uci) });
  const events = [...r.events];
  const prompts: ChoiceRequest[] = [];
  while (r.kind === 'needsChoice') {
    prompts.push(r.request);
    const option = pickAnswer(answers.shift(), r.request);
    r = engine.applyAction(r.state, {
      kind: 'choice',
      side: r.request.chooser,
      promptId: r.request.promptId,
      option,
    });
    events.push(...r.events);
  }
  return { state: r.state, step: { uci, side, events, prompts } };
}

export function scenario(spec: ScenarioSpec): ScenarioResult {
  const { engine, state: initial, events: setupEvents } = setup(spec);
  let state = initial;
  const answers = [...(spec.answers ?? [])];
  const steps: ScenarioStep[] = [];
  for (const uci of spec.moves ?? []) {
    const r = play(engine, state, uci, answers);
    state = r.state;
    steps.push(r.step);
  }
  const events = steps.flatMap((s) => s.events);
  return {
    engine,
    initial,
    state,
    events,
    setupEvents,
    steps,
    prompts: steps.flatMap((s) => s.prompts),
    kinds: events.map((e) => e.k),
  };
}

/** Piece id currently on a square (by name), or -1. */
export function idAt(state: GameState, square: string): number {
  return state.board[parseSquare(square)] ?? -1;
}

/** Piece standing on a square (by name), or undefined. */
export function pieceAt(state: GameState, square: string) {
  const id = idAt(state, square);
  return id >= 0 ? state.pieces[id] : undefined;
}

/** Events of one kind, typed. */
export function eventsOf<K extends BattleEvent['k']>(
  events: readonly BattleEvent[],
  k: K,
): Extract<BattleEvent, { k: K }>[] {
  return events.filter((e): e is Extract<BattleEvent, { k: K }> => e.k === k);
}

export { parseSquare };
