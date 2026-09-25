/**
 * Scenario Lab session (dev only, BUILD_PROMPT M3): a battle built from a ScenarioSpec (spec 5.5
 * worked examples or a custom position), its scripted moves, and any moves played by hand after
 * them (hot-seat on the loaded position). Every committed action keeps the exact GameState before and
 * after it, its full event list and every prompt with the partial state the engine returned at that
 * point, so the lab can rebuild and verify a board for every single event (frames.ts).
 *
 * The lab is a debug tool: unlike the battle UI it reads full GameStates and unprojected events
 * (hidden loadouts included). Nothing here is reachable in production builds.
 */
import { engine as defaultEngine, makeEngine } from '@chain-theorem/content';
import { type Answer, type ScenarioSpec, loadoutOf } from '@chain-theorem/content/testing';
import {
  type ApplyResult,
  type BattleEvent,
  type ChoiceOption,
  type ChoiceRequest,
  type Engine,
  type GameState,
  type Side,
  RulesError,
  moveToUci,
  uciToMove,
} from '@chain-theorem/rules';

export interface LabPrompt {
  request: ChoiceRequest;
  /** Number of this action's events emitted before the prompt opened. */
  at: number;
  /** The engine's partial state while the prompt was open (exact board at that point). */
  state: GameState;
  /** Chosen option index; null while the prompt is still open. */
  answer: number | null;
}

export interface LabAction {
  /** Position in the session (0 = battle start). */
  n: number;
  kind: 'start' | 'move';
  side: Side | null;
  uci: string | null;
  /** Part of the loaded script (true) or played by hand in the lab (false). */
  scripted: boolean;
  before: GameState;
  /** Latest state: settled, or suspended on the open prompt. */
  after: GameState;
  events: BattleEvent[];
  prompts: LabPrompt[];
}

export interface LabSession {
  readonly engine: Engine;
  readonly spec: ScenarioSpec;
  readonly actions: readonly LabAction[];
  readonly state: GameState;
  /** Why the scripted run stopped early (bad move, bad answer), if it did. */
  readonly error: string | null;
}

export function errorText(e: unknown): string {
  if (e instanceof RulesError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Start the battle only (no moves). Throws on a bad FEN or setup. */
export function startSession(spec: ScenarioSpec): LabSession {
  const engine = spec.caps ? makeEngine(spec.caps) : defaultEngine;
  const { state, events } = engine.newBattle({
    format: spec.format ?? 'full',
    white: { level: spec.white?.level ?? 30, loadout: loadoutOf(spec.white) },
    black: { level: spec.black?.level ?? 30, loadout: loadoutOf(spec.black) },
    ...(spec.fen ? { fen: spec.fen } : {}),
  });
  const start: LabAction = {
    n: 0,
    kind: 'start',
    side: null,
    uci: null,
    scripted: true,
    before: state,
    after: state,
    events,
    prompts: [],
  };
  return { engine, spec, actions: [start], state, error: null };
}

/** The prompt waiting for an answer, if any. */
export function openPrompt(s: LabSession): LabPrompt | null {
  const last = s.actions[s.actions.length - 1];
  const p = last?.prompts[last.prompts.length - 1];
  return p && p.answer === null ? p : null;
}

function pickAnswer(answer: Answer | undefined, req: ChoiceRequest): number {
  if (answer === undefined) return req.defaultOption;
  if (typeof answer === 'number') {
    if (!Number.isInteger(answer) || answer < 0 || answer >= req.options.length)
      throw new Error(`answer ${answer} is not an option index (0..${req.options.length - 1})`);
    return answer;
  }
  if (typeof answer === 'function') return answer(req);
  const idx = req.options.findIndex((o) => JSON.stringify(o) === JSON.stringify(answer));
  if (idx < 0)
    throw new Error(
      `answer ${JSON.stringify(answer)} is not an option of ${JSON.stringify(req.options)}`,
    );
  return idx;
}

function replaceLast(s: LabSession, action: LabAction, error: string | null = s.error): LabSession {
  return { ...s, actions: [...s.actions.slice(0, -1), action], state: action.after, error };
}

/** Fold one engine result into an action (events appended, prompt recorded when suspended). */
function absorb(action: LabAction, r: ApplyResult): LabAction {
  const events = [...action.events, ...r.events];
  const prompts =
    r.kind === 'needsChoice'
      ? [...action.prompts, { request: r.request, at: events.length, state: r.state, answer: null }]
      : action.prompts;
  return { ...action, after: r.state, events, prompts };
}

/** Answer the open prompt with option index `option`. Throws RulesError on a bad answer. */
export function answerPrompt(s: LabSession, option: number): LabSession {
  const p = openPrompt(s);
  const last = s.actions[s.actions.length - 1];
  if (!p || !last) throw new Error('no prompt is open');
  const r = s.engine.applyAction(s.state, {
    kind: 'choice',
    side: p.request.chooser,
    promptId: p.request.promptId,
    option,
  });
  const answered: LabAction = {
    ...last,
    prompts: last.prompts.map((q) => (q === p ? { ...q, answer: option } : q)),
  };
  return replaceLast(s, absorb(answered, r));
}

/**
 * Play one UCI move for the side to move. With `answers`, prompts are answered from the front of the
 * list (consumed) and fall back to each prompt's default, like scenario(); with 'ask', the first
 * prompt stays open for the lab user. Throws RulesError on an illegal move.
 */
export function playMove(
  s: LabSession,
  uci: string,
  answers: Answer[] | 'ask',
  scripted = false,
): LabSession {
  if (openPrompt(s)) throw new Error('answer the open prompt first');
  const side = s.state.turn;
  const r = s.engine.applyAction(s.state, { kind: 'move', side, move: uciToMove(uci) });
  const action = absorb(
    {
      n: s.actions.length,
      kind: 'move',
      side,
      uci: moveToUci(uciToMove(uci)),
      scripted,
      before: s.state,
      after: s.state,
      events: [],
      prompts: [],
    },
    r,
  );
  let next: LabSession = {
    ...s,
    actions: [...s.actions, action],
    state: action.after,
  };
  if (answers === 'ask') return next;
  for (let p = openPrompt(next); p; p = openPrompt(next)) {
    next = answerPrompt(next, pickAnswer(answers.shift(), p.request));
  }
  return next;
}

/**
 * Build a session from a spec and run its scripted moves. Never throws after the battle starts: a
 * failing move stops the script and is reported in `error`, keeping the actions played so far.
 */
export function runScenario(spec: ScenarioSpec): LabSession {
  let s = startSession(spec);
  const answers = [...(spec.answers ?? [])];
  const moves = spec.moves ?? [];
  for (let i = 0; i < moves.length; i++) {
    const uci = moves[i] ?? '';
    try {
      s = playMove(s, uci, answers, true);
    } catch (e) {
      return { ...s, error: `Scripted move ${i + 1} (${uci}) failed: ${errorText(e)}` };
    }
  }
  return s;
}

/** Take back the last action (or the half-finished one waiting on a prompt). */
export function undo(s: LabSession): LabSession {
  if (s.actions.length <= 1) return s;
  const last = s.actions[s.actions.length - 1];
  if (!last) return s;
  return { ...s, actions: s.actions.slice(0, -1), state: last.before, error: null };
}

/**
 * The session as a scenario() spec, manual moves and answers included, so a lab finding can be pasted
 * straight into a golden or module test. Answers are the chosen options (data, not indexes).
 */
export function exportSpec(s: LabSession): ScenarioSpec {
  const moves: string[] = [];
  const answers: ChoiceOption[] = [];
  for (const a of s.actions) {
    if (a.kind !== 'move' || !a.uci) continue;
    moves.push(a.uci);
    for (const p of a.prompts) {
      const o = p.answer === null ? undefined : p.request.options[p.answer];
      if (o) answers.push(o);
    }
  }
  const { answers: _drop, moves: _old, ...rest } = s.spec;
  return { ...rest, moves, ...(answers.length > 0 ? { answers } : {}) };
}
