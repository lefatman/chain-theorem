/**
 * Scenario Lab (dev only, BUILD_PROMPT M3; excluded from production builds by App.tsx's
 * `import.meta.env.DEV` branch). Load a worked example E1 to E9 (spec 5.5) or a custom position with
 * any loadouts, run its scripted moves, then step through every event of each reaction chain with
 * its plain-language line (11.2), its raw JSON and the board at that step; keep playing both sides by
 * hand. Unlike the battle UI, the lab is allowed to read full GameStates (debug panel).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { engine as defaultEngine } from '@chain-theorem/content';
import type { ScenarioSpec } from '@chain-theorem/content/testing';
import { moveToUci, type FormatId, type Move, type Side } from '@chain-theorem/rules';
import { go } from '../app/router.ts';
import type { Highlights } from '../battle/scene/BoardScene.ts';
import { settings } from '../state/settings.ts';
import { WORKED_EXAMPLES, type WorkedExample } from '../../../../packages/content/src/examples.ts';
import { DebugPanel } from './DebugPanel.tsx';
import {
  type LabFrame,
  frameHighlights,
  optionSquares,
  promptHighlights,
  sessionFrames,
} from './frames.ts';
import { LabBoard, type BoardFrame } from './LabBoard.tsx';
import { type CustomDraft, type DraftField, draftFromSpec, parseDraft } from './parse.ts';
import { PlayPanel } from './PlayPanel.tsx';
import {
  type LabSession,
  answerPrompt,
  errorText,
  exportSpec,
  openPrompt,
  playMove,
  runScenario,
  undo,
} from './session.ts';
import { type LabSource, SetupPanel } from './SetupPanel.tsx';
import { StepPanel } from './StepPanel.tsx';
import './lab.css';

const FIRST = WORKED_EXAMPLES[0] as WorkedExample;

function exampleSpec(ex: WorkedExample, variant: number | null): ScenarioSpec {
  return (variant === null ? undefined : ex.variants?.[variant]?.setup) ?? ex.setup;
}

/** Index of the last frame of the battle start (the position before the first move). */
function startIndex(frames: LabFrame[]): number {
  const i = frames.findIndex((f) => f.action.n > 0);
  return i < 0 ? Math.max(0, frames.length - 1) : Math.max(0, i - 1);
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
}

export function ScenarioLab() {
  const [initial] = useState(() => runScenario(FIRST.setup));
  const [source, setSource] = useState<LabSource>({ kind: 'example', id: FIRST.id, variant: null });
  const [draft, setDraft] = useState<CustomDraft>(() => draftFromSpec(FIRST.setup));
  const [editorOpen, setEditorOpen] = useState(false);
  const [session, setSession] = useState<LabSession | null>(() => initial);
  const [runError, setRunError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Side>('white');
  const [cursor, setCursor] = useState(() => startIndex(sessionFrames(initial, 'white')));
  const [prevCursor, setPrevCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<Move[] | null>(null);
  const [followChains, setFollowChains] = useState(true);

  const parsed = useMemo(() => parseDraft(draft, defaultEngine), [draft]);
  const frames = useMemo(() => (session ? sessionFrames(session, viewer) : []), [session, viewer]);
  const last = frames.length - 1;
  const at = cursor < 0 || cursor > last ? last : cursor;
  const frame = frames[at];
  const atLive = at === last;

  // The position being shown, updated at once so rapid key presses chain before a re-render.
  const atRef = useRef(at);
  atRef.current = at;
  const seek = (i: number | ((current: number) => number)) => {
    const from = atRef.current;
    const to = Math.max(0, Math.min(last, typeof i === 'function' ? i(from) : i));
    atRef.current = to;
    setPrevCursor(from);
    setCursor(to);
    setSelected(null);
    setPromo(null);
  };

  /** Show a new session, starting at `index` (a function of its frames). */
  const load = (s: LabSession, pick: (f: LabFrame[]) => number) => {
    setSession(s);
    setPlaying(false);
    setSelected(null);
    setPromo(null);
    setPlayError(null);
    setPrevCursor(-1);
    setCursor(pick(sessionFrames(s, viewer)));
  };

  const run = (spec: ScenarioSpec, scripted: boolean) => {
    try {
      const s = runScenario(scripted ? spec : { ...spec, moves: [], answers: [] });
      setRunError(null);
      load(s, startIndex);
    } catch (e) {
      setRunError(errorText(e));
    }
  };

  const onExample = (ex: WorkedExample, variant: number | null) => {
    const spec = exampleSpec(ex, variant);
    setSource({ kind: 'example', id: ex.id, variant });
    setDraft(draftFromSpec(spec));
    run(spec, true);
  };

  const onDraft = (field: DraftField, value: string) => {
    setDraft((d) => ({ ...d, [field]: field === 'format' ? (value as FormatId) : value }));
    setSource({ kind: 'custom' });
  };

  /** After a manual move or answer: jump to its first new event, or to the live position. */
  const afterPlay = (next: LabSession, firstNewEvent: number) => {
    setSession(next);
    setSelected(null);
    setPromo(null);
    setPlayError(null);
    const fs = sessionFrames(next, viewer);
    const lastAction = next.actions[next.actions.length - 1];
    const idx = fs.findIndex((f) => f.action === lastAction && f.k === firstNewEvent);
    const to = followChains && idx >= 0 ? idx : fs.length - 1;
    // From the live position, the first new event is one step forward: animate it.
    setPrevCursor(atLive ? to - 1 : -1);
    setCursor(to);
  };

  const onMove = (uci: string) => {
    if (!session) return;
    try {
      afterPlay(playMove(session, uci, 'ask'), 0);
    } catch (e) {
      setPlayError(`${uci}: ${errorText(e)}`);
    }
  };

  const onAnswer = (option: number) => {
    if (!session) return;
    const lastAction = session.actions[session.actions.length - 1];
    try {
      afterPlay(answerPrompt(session, option), lastAction?.events.length ?? 0);
    } catch (e) {
      setPlayError(errorText(e));
    }
  };

  const prompt = session ? openPrompt(session) : null;
  const legal = useMemo(
    () =>
      session && !session.state.result && !openPrompt(session)
        ? session.engine.legalMoves(session.state, session.state.turn)
        : [],
    [session],
  );

  const onSquare = (sq: number) => {
    if (!session) return;
    if (!atLive) {
      setPlaying(false);
      seek(last);
      return;
    }
    if (prompt) {
      const matches = optionSquares(prompt).flatMap((s, i) => (s === sq ? [i] : []));
      if (matches.length === 1 && matches[0] !== undefined) onAnswer(matches[0]);
      return;
    }
    if (selected !== null && selected !== sq) {
      const choices = legal.filter((m) => m.from === selected && m.to === sq);
      if (choices.length > 1) {
        setPromo(choices);
        return;
      }
      if (choices[0]) {
        onMove(moveToUci(choices[0]));
        return;
      }
    }
    setPromo(null);
    setSelected(sq !== selected && legal.some((m) => m.from === sq) ? sq : null);
  };

  // Auto-step through the chain (11.2), pausing at the live position.
  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const s = settings.value;
    const ms = s.reducedMotion ? 700 : s.fastMode ? 350 : 900;
    const id = setTimeout(() => seek(at + 1), ms);
    return () => clearTimeout(id);
  }, [playing, at, last]);

  // Keyboard stepping when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      const to =
        e.key === 'ArrowRight'
          ? (c: number) => c + 1
          : e.key === 'ArrowLeft'
            ? (c: number) => c - 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? last
                : null;
      if (to === null) return;
      e.preventDefault();
      setPlaying(false);
      seek(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const boardFrame = useMemo<BoardFrame | null>(() => {
    if (!frame) return null;
    const before = frames[at - 1];
    return {
      pub: frame.pub,
      from: before && prevCursor === at - 1 ? { pub: before.pub, events: [frame.event] } : null,
    };
    // Recompute only when the shown frame changes, not on every render.
  }, [frame, frames, at, prevCursor]);

  const highlights = useMemo<Highlights>(() => {
    const none: Highlights = {
      selected: null,
      targets: [],
      captures: [],
      lastMove: null,
      attacked: [],
    };
    if (!frame) return none;
    if (!atLive) return frameHighlights(frame);
    const base = frameHighlights(frame);
    if (prompt) return { ...base, ...promptHighlights(prompt) };
    const lastMoveEv = [...frame.action.events].reverse().find((e) => e.k === 'MoveMade');
    const lastMove: [number, number] | null =
      lastMoveEv?.k === 'MoveMade' ? [lastMoveEv.from, lastMoveEv.to] : null;
    const targets = selected === null ? [] : legal.filter((m) => m.from === selected);
    return {
      ...none,
      selected,
      lastMove,
      targets: settings.value.moveHighlights ? targets.map((m) => m.to) : [],
      captures: targets.filter((m) => (frame.pub.board[m.to] ?? -1) >= 0).map((m) => m.to),
    };
  }, [frame, atLive, prompt, selected, legal]);

  const drifted = frames.filter((f) => f.drift && f.drift.length > 0).length;

  return (
    <main class="lab" aria-labelledby="lab-h">
      <header class="lab-head">
        <h2 id="lab-h">
          Scenario Lab <span class="tag">dev only</span>
        </h2>
        <div class="seg" role="group" aria-label="Board seen from">
          <span class="lab-seg-label">Board seen from:</span>
          {(['white', 'black'] as const).map((s) => (
            <button
              key={s}
              class="small"
              aria-pressed={viewer === s}
              onClick={() => {
                setViewer(s);
                setPrevCursor(-1);
              }}
            >
              {s === 'white' ? 'White' : 'Black'}
            </button>
          ))}
        </div>
        <button class="small" onClick={() => go('title')}>
          Back to title
        </button>
      </header>
      <p class="lab-hint lab-intro">
        A debug tool: it reads full game states. The viewer sets the board orientation, sprite
        facing and which ability pips count as revealed; each step also shows what both players'
        logs say.
      </p>

      <SetupPanel
        source={source}
        draft={draft}
        parsed={parsed}
        editorOpen={editorOpen}
        onEditorOpen={setEditorOpen}
        onExample={onExample}
        onDraft={onDraft}
        onCustom={() => {
          setSource({ kind: 'custom' });
          setEditorOpen(true);
        }}
        onRun={(scripted) => parsed.spec && run(parsed.spec, scripted)}
      />
      {runError && (
        <p class="lab-error lab-banner" role="alert">
          <span aria-hidden="true">✖︎ </span>
          {runError}
        </p>
      )}
      {session?.error && (
        <p class="lab-error lab-banner" role="alert">
          <span aria-hidden="true">✖︎ </span>
          {session.error}
        </p>
      )}
      {drifted > 0 && (
        <p class="lab-error lab-banner" role="alert">
          <span aria-hidden="true">✖︎ </span>
          {drifted} rebuilt board{drifted === 1 ? '' : 's'} differ from the engine's projection
          (marked in the list): a lab reducer bug worth reporting.
        </p>
      )}

      {session && frame && boardFrame && (
        <div class="lab-main">
          <div class="lab-left">
            <LabBoard
              frame={boardFrame}
              highlights={highlights}
              onSquare={onSquare}
              label={`Board after step ${at + 1}: ${frame.text} Seen from ${viewer}.`}
            />
            <PlayPanel
              session={session}
              live={frames[last]}
              atLive={atLive}
              legal={legal}
              promo={promo}
              followChains={followChains}
              error={playError}
              onFollowChains={setFollowChains}
              onMove={onMove}
              onAnswer={onAnswer}
              onPromo={(m) => {
                setPromo(null);
                if (m) onMove(moveToUci(m));
              }}
              onUndo={() => load(undo(session), (fs) => fs.length - 1)}
              onGoLive={() => seek(last)}
              onEditExport={() => {
                setDraft(draftFromSpec(exportSpec(session)));
                setSource({ kind: 'custom' });
                setEditorOpen(true);
              }}
            />
          </div>
          <div class="lab-right">
            <StepPanel
              session={session}
              frames={frames}
              cursor={at}
              playing={playing}
              onSeek={(i) => {
                setPlaying(false);
                seek(i);
              }}
              onPlay={(on) => {
                if (on && at >= last) return;
                setPlaying(on);
              }}
            />
          </div>
        </div>
      )}
      {session && frame && <DebugPanel session={session} frame={frame} />}
    </main>
  );
}
