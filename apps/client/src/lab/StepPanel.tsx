/**
 * Step-through of every event of every action (11.2: "every reaction chain is replayable step by
 * step with a plain-language log line per step"): navigation, the selected event's plain line, what
 * each player's own log would say, prompts and answers, the raw event JSON, and whether the rebuilt
 * board was checked against the engine at this point.
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { abilityName } from '../battle/describe.ts';
import type { LabFrame } from './frames.ts';
import type { LabSession } from './session.ts';
import { actionLabel, eventTag, optionText, prettyJson, projectedLines, sideName } from './text.ts';

export interface StepPanelProps {
  session: LabSession;
  frames: LabFrame[];
  cursor: number;
  playing: boolean;
  onSeek(index: number): void;
  onPlay(playing: boolean): void;
}

function actionStarts(frames: LabFrame[]): number[] {
  const out: number[] = [];
  frames.forEach((f, i) => {
    if (f.k === 0) out.push(i);
  });
  return out;
}

export function StepPanel({ session, frames, cursor, playing, onSeek, onPlay }: StepPanelProps) {
  const f = frames[cursor];
  const last = frames.length - 1;
  const starts = useMemo(() => actionStarts(frames), [frames]);
  const current = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Keep the current event visible inside the list only; never scroll the page away from the
    // board (on narrow screens the list is not a scroll box and this does nothing).
    const box = list.current;
    const item = current.current;
    if (!box || !item || box.scrollHeight <= box.clientHeight) return;
    const top = item.offsetTop; // .lab-chain is the offset parent (position: relative)
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + item.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + item.offsetHeight - box.clientHeight;
  }, [cursor, frames]);
  if (!f) return null;
  const lines = projectedLines(session, f);
  const groupIdx = starts.findLastIndex((s) => s <= cursor);
  const prevAction = cursor > (starts[groupIdx] ?? 0) ? starts[groupIdx] : starts[groupIdx - 1];
  const nextAction = starts[groupIdx + 1];
  const prompt = f.promptAfter;
  const answered = f.answered;

  return (
    <section class="lab-steps panel" aria-labelledby="lab-steps-h">
      <h3 id="lab-steps-h">Reaction chain, event by event</h3>
      <div class="lab-nav" role="group" aria-label="Step controls">
        <button
          class="small"
          onClick={() => onSeek(0)}
          disabled={cursor === 0}
          aria-label="First event"
        >
          <span aria-hidden="true">⏮︎</span>
        </button>
        <button
          class="small"
          onClick={() => prevAction !== undefined && onSeek(prevAction)}
          disabled={prevAction === undefined}
          aria-label="Start of this or the previous action"
        >
          <span aria-hidden="true">⇤</span> Action
        </button>
        <button
          class="small"
          onClick={() => onSeek(cursor - 1)}
          disabled={cursor === 0}
          aria-label="Previous event"
        >
          <span aria-hidden="true">◀︎</span> Prev
        </button>
        <button
          class="small"
          onClick={() => onSeek(cursor + 1)}
          disabled={cursor >= last}
          aria-label="Next event"
        >
          Next <span aria-hidden="true">▶︎</span>
        </button>
        <button
          class="small"
          onClick={() => nextAction !== undefined && onSeek(nextAction)}
          disabled={nextAction === undefined}
          aria-label="Start of the next action"
        >
          Action <span aria-hidden="true">⇥</span>
        </button>
        <button
          class="small"
          onClick={() => onSeek(last)}
          disabled={cursor >= last}
          aria-label="Last event (live position)"
        >
          <span aria-hidden="true">⏭︎</span> Live
        </button>
        <button
          class="small"
          aria-pressed={playing}
          onClick={() => onPlay(!playing)}
          disabled={!playing && cursor >= last}
        >
          {playing ? 'Pause' : 'Auto-step'}
        </button>
      </div>
      <p class="lab-hint">
        Keys: <kbd>←</kbd> <kbd>→</kbd> step, <kbd>Home</kbd> <kbd>End</kbd> first and live.
      </p>

      <div class="lab-step" aria-live="polite">
        <p class="lab-step-meta">
          Step {cursor + 1} of {frames.length} · {actionLabel(f.action)}
          {f.action.kind === 'move' && !f.action.scripted ? ' (played in the lab)' : ''} · event{' '}
          {f.event.i}
          {f.event.depth > 0 ? ` · depth ${f.event.depth} (bonus action)` : ''}
        </p>
        <p class="lab-step-line">
          <span class="tag">{eventTag(f.event)}</span> {f.text}
        </p>
        <dl class="lab-seen">
          <dt>White's log</dt>
          <dd>{lines.white}</dd>
          <dt>Black's log</dt>
          <dd>{lines.black}</dd>
        </dl>
        {prompt && (
          <div class="lab-prompt-note">
            <strong>
              <span aria-hidden="true">❓︎ </span>
              Prompt to {sideName(prompt.request.chooser)} (
              {abilityName(prompt.request.source.ability)}, {prompt.request.kind}):
            </strong>
            <ol start={0}>
              {prompt.request.options.map((o, i) => (
                <li key={i}>
                  {optionText(f.pub, o)}
                  {i === prompt.request.defaultOption ? ' (default)' : ''}
                  {i === prompt.answer ? ' ← chosen' : ''}
                </li>
              ))}
            </ol>
            {prompt.answer === null && <p>Waiting for the answer (see Play).</p>}
          </div>
        )}
        {answered && answered.answer !== null && (
          <p class="lab-prompt-note">
            Answer to {abilityName(answered.request.source.ability)}:{' '}
            {optionText(f.pub, answered.request.options[answered.answer] ?? { kind: 'decline' })}
          </p>
        )}
        {f.drift !== null && (
          <p class={f.drift.length === 0 ? 'lab-ok' : 'lab-error'}>
            {f.drift.length === 0 ? (
              <>
                <span aria-hidden="true">✔︎ </span>Board checked against the engine's projection
                here.
              </>
            ) : (
              <>
                <span aria-hidden="true">✖︎ </span>Rebuilt board differs from the engine:{' '}
                {f.drift.join(', ')}
              </>
            )}
          </p>
        )}
        <details class="lab-json">
          <summary>Raw event JSON</summary>
          <pre>{prettyJson(f.event)}</pre>
        </details>
      </div>

      <ol class="lab-chain" aria-label="All events" ref={list}>
        {starts.map((start, gi) => {
          const end = starts[gi + 1] ?? frames.length;
          const head = frames[start];
          if (!head) return null;
          return (
            <li key={start} class="lab-chain-group">
              <p class="lab-chain-head">
                {actionLabel(head.action)}
                {head.action.kind === 'move' && !head.action.scripted ? ' (lab)' : ''}
              </p>
              <ol>
                {frames.slice(start, end).map((g, k) => {
                  const idx = start + k;
                  const here = idx === cursor;
                  return (
                    <li key={idx}>
                      <button
                        ref={here ? current : undefined}
                        class={`lab-chain-item depth-${Math.min(g.event.depth, 3)}`}
                        aria-current={here ? 'step' : undefined}
                        onClick={() => onSeek(idx)}
                      >
                        <span class="lab-marker" aria-hidden="true">
                          {here ? '▶︎' : ''}
                        </span>
                        {g.event.depth > 0 && <span class="lab-depth">↳ d{g.event.depth} </span>}
                        <span class="lab-chain-kind">{eventTag(g.event)}</span> {g.text}
                        {g.promptAfter && <span class="lab-flag"> ❓︎ prompt</span>}
                        {g.drift && g.drift.length > 0 && <span class="lab-flag"> ✖︎ drift</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
