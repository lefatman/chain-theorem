/**
 * Per-event frames for the Scenario Lab: one board per event of every action, rebuilt with the
 * forward reducer from the exact state before the action, and snapped back to the engine's exact
 * projection wherever the engine exposes one (at each prompt and when the action settles). Any
 * difference found at those checkpoints is reported as drift, so a reducer bug can never hide.
 */
import type { BattleEvent, Engine, PublicState, Side } from '@chain-theorem/rules';
import { describe } from '../battle/describe.ts';
import type { Highlights } from '../battle/scene/BoardScene.ts';
import { applyEventToPublic, frameDrift } from './reducer.ts';
import type { LabAction, LabPrompt, LabSession } from './session.ts';

export interface LabFrame {
  action: LabAction;
  /** Index of the event in `action.events`. */
  k: number;
  event: BattleEvent;
  /** The board right after this event, as `viewer` would see it. */
  pub: PublicState;
  /** The board right before this event. */
  prev: PublicState;
  /** Plain-language line (11.2), omniscient: the lab shows hidden ability names. */
  text: string;
  /** Prompt that opened right after this event. */
  promptAfter: LabPrompt | null;
  /** Prompt answered by this event (ChoiceMade). */
  answered: LabPrompt | null;
  /** Checkpoint result: null = no exact state here; [] = rebuilt board matches the engine. */
  drift: string[] | null;
}

const cache = new WeakMap<LabAction, Partial<Record<Side, LabFrame[]>>>();

function startPub(engine: Engine, action: LabAction, viewer: Side): PublicState {
  const pub = engine.project(action.before, viewer);
  const first = action.events[0];
  return {
    ...pub,
    legal: [],
    pending: null,
    eventSeq: first ? first.i : pub.eventSeq,
  };
}

export function actionFrames(engine: Engine, action: LabAction, viewer: Side): LabFrame[] {
  const hit = cache.get(action)?.[viewer];
  if (hit) return hit;
  const checkpoints = new Map<number, { exact: PublicState; settled: boolean }>();
  for (const p of action.prompts)
    checkpoints.set(p.at, { exact: engine.project(p.state, viewer), settled: false });
  if (!action.after.pending)
    checkpoints.set(action.events.length, {
      exact: engine.project(action.after, viewer),
      settled: true,
    });
  const trueElement = (id: number) => action.before.pieces[id]?.element;
  const trueElements = (side: Side) => action.before.armies[side].loadout.elements;
  // The lab reads the full state: track the true usage counters through the chain so each frame
  // shows exactly the counters its viewer may see.
  let trueUsage: Record<string, number> = { ...action.before.usage };
  const frames: LabFrame[] = [];
  let pub = startPub(engine, action, viewer);
  let choice = 0;
  action.events.forEach((event, k) => {
    const prev = pub;
    if (event.k === 'ChargeSpent' && event.ability !== null) {
      const key = `${event.piece}:${event.ability}`;
      trueUsage = { ...trueUsage, [key]: (trueUsage[key] ?? 0) + 1 };
    }
    pub = applyEventToPublic(pub, event, { trueElement, trueElements, trueUsage });
    const cp = checkpoints.get(k + 1);
    let drift: string[] | null = null;
    if (cp) {
      drift = frameDrift(pub, cp.exact, cp.settled);
      pub = cp.exact;
    }
    let answered: LabPrompt | null = null;
    if (event.k === 'ChoiceMade') answered = action.prompts[choice++] ?? null;
    frames.push({
      action,
      k,
      event,
      pub,
      prev,
      text: describe(event, pub),
      promptAfter: action.prompts.find((p) => p.at === k + 1) ?? null,
      answered,
      drift,
    });
  });
  cache.set(action, { ...cache.get(action), [viewer]: frames });
  return frames;
}

/** Every frame of the session in order (the step-through list). */
export function sessionFrames(s: LabSession, viewer: Side): LabFrame[] {
  return s.actions.flatMap((a) => actionFrames(s.engine, a, viewer));
}

/** Where a piece was last seen up to frame `f` (for pointing at a piece that was just removed). */
function lastSquare(f: LabFrame, piece: number): number {
  const now = f.pub.pieces[piece]?.square ?? -1;
  if (now >= 0) return now;
  const before = f.prev.pieces[piece]?.square ?? -1;
  if (before >= 0) return before;
  for (let k = f.k; k >= 0; k--) {
    const ev = f.action.events[k];
    if (ev?.k === 'Captured' && ev.victim === piece) return ev.square;
  }
  return -1;
}

const NONE: Highlights = {
  selected: null,
  targets: [],
  captures: [],
  lastMove: null,
  attacked: [],
};

/** Board highlights for one step: the move it made, or the square/piece it is about. */
export function frameHighlights(f: LabFrame): Highlights {
  const ev = f.event;
  let focus: number | null = null;
  let lastMove: [number, number] | null = null;
  switch (ev.k) {
    case 'ActionStarted':
      lastMove = [ev.move.from, ev.move.to];
      break;
    case 'MoveMade':
    case 'PieceMoved':
      lastMove = [ev.from, ev.to];
      break;
    case 'Captured':
    case 'PieceRevived':
      focus = ev.square;
      break;
    case 'SquareIgnited':
    case 'SquareExtinguished':
    case 'Check':
      focus = ev.square;
      break;
    case 'Promoted':
    case 'AbilityTriggered':
    case 'AbilitySilenced':
    case 'AbilityNegated':
    case 'ChargeSpent':
      focus = lastSquare(f, ev.piece);
      break;
    case 'EffectFizzled':
      focus = lastSquare(f, ev.target ?? ev.piece);
      break;
    case 'ChoiceMade': {
      const o = ev.option;
      if (o.kind === 'move') lastMove = [o.from, o.to];
      else if (o.kind === 'square' || o.kind === 'piece') focus = o.square;
      break;
    }
    default:
      break;
  }
  const prompt = f.promptAfter ? promptHighlights(f.promptAfter) : { targets: [], captures: [] };
  return { ...NONE, ...prompt, selected: focus !== null && focus >= 0 ? focus : null, lastMove };
}

/**
 * The square that identifies each option of a prompt on the board: a square or piece option's
 * square; for bonus moves, the moving piece when the options differ by mover (Riposte: several
 * capturers, one destination), otherwise the destination (Momentum: one piece, many squares).
 */
export function optionSquares(p: LabPrompt): (number | null)[] {
  const opts = p.request.options;
  const froms = new Set(opts.flatMap((o) => (o.kind === 'move' ? [o.from] : [])));
  const moves = opts.filter((o) => o.kind === 'move').length;
  const byMover = froms.size === moves && moves > 1;
  return opts.map((o) => {
    if (o.kind === 'move') return byMover ? o.from : o.to;
    if (o.kind === 'square' || o.kind === 'piece') return o.square;
    return null;
  });
}

/** Prompt highlights: option squares as targets, a shared bonus-move destination as a capture. */
export function promptHighlights(p: LabPrompt): Pick<Highlights, 'targets' | 'captures'> {
  const targets = [...new Set(optionSquares(p).flatMap((s) => (s === null ? [] : [s])))];
  const dests = new Set(p.request.options.flatMap((o) => (o.kind === 'move' ? [o.to] : [])));
  const captures = dests.size === 1 && !targets.some((t) => dests.has(t)) ? [...dests] : [];
  return { targets: [...targets, ...captures], captures };
}
