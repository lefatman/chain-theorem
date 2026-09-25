/**
 * Event log with step-through replay (11.2, R-ART-002): every chain step has a plain-language line;
 * the controls step backward and forward through the latest action's reaction chain or any earlier
 * one, the current line is marked (icon, outline and aria-current, not colour alone) and the board
 * shows that step's position (BattleView renders the frame). New lines are announced politely.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LogEntry } from '../battle/controller.ts';
import { PIECE_GLYPH, sideName } from './labels.ts';
import { groupActions, navigate, type ActionGroup, type ReplayNav } from './replay.ts';

const SHOWN_GROUPS = 30;

export interface EventLogProps {
  log: LogEntry[];
  /** Event index shown on the board, or null for the live board. */
  at: number | null;
  playing: boolean;
  onSeek(at: number | null): void;
  onPlay(on: boolean): void;
}

function groupTitle(g: ActionGroup, n: number): string {
  const first = g.steps[0]?.event;
  if (first?.k !== 'ActionStarted') return g.title;
  return `${n}. ${g.title}`;
}

export function EventLog({ log, at, playing, onSeek, onPlay }: EventLogProps) {
  const groups = useMemo(() => groupActions(log), [log]);
  const [more, setMore] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const steps = groups.flatMap((g) => g.steps);
  const lastI = steps[steps.length - 1]?.i ?? -1;
  const cur = at ?? lastI;
  const gIndex = groups.findIndex((g) => g.steps.some((s) => s.i === cur));
  const group = groups[gIndex];
  const stepNo = group ? group.steps.findIndex((s) => s.i === cur) + 1 : 0;
  const curText = steps.find((s) => s.i === cur)?.text ?? '';
  const actionNo = (g: ActionGroup) =>
    groups.slice(0, g.n + 1).filter((x) => x.steps[0]?.event.k === 'ActionStarted').length;

  // Keep the replayed group rendered even when it is older than the default window.
  const from = Math.max(
    0,
    Math.min(groups.length - SHOWN_GROUPS - more, gIndex < 0 ? Infinity : gIndex),
  );
  const shown = groups.slice(from);

  const go = (nav: ReplayNav) => {
    onPlay(false);
    onSeek(navigate(groups, at, nav));
  };

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (at === null) {
      // Follow new lines unless the reader scrolled up.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
      return;
    }
    // Scroll only the list (scrollIntoView would also move the HUD and hide the clocks).
    const node = el.querySelector<HTMLElement>('.step.current');
    if (!node) return;
    const top = node.offsetTop; // the list is the offset parent (position: relative)
    if (top < el.scrollTop || top + node.offsetHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [at, log.length]);

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, ReplayNav | 'live'> = {
      ArrowLeft: 'back',
      ArrowRight: 'forward',
      PageUp: 'prevAction',
      PageDown: 'nextAction',
      End: 'live',
    };
    const nav = map[e.key];
    if (!nav) return;
    e.preventDefault();
    if (nav === 'live') {
      onPlay(false);
      onSeek(null);
    } else go(nav);
  };

  const atStart = steps[0]?.i === cur;
  return (
    <section class="log" aria-labelledby="log-h" onKeyDown={onKey}>
      <div class="log-head">
        <h3 id="log-h">Log</h3>
        <span class={`mode ${at === null ? 'live' : 'replay'}`}>
          {at === null ? (
            <>
              <span aria-hidden="true">{'●'}</span> Live
            </>
          ) : (
            <>
              <span aria-hidden="true">{'↺'}</span> Replay
              {group ? ` · step ${stepNo} of ${group.steps.length}` : ''}
            </>
          )}
        </span>
      </div>
      <div class="replay-controls" role="toolbar" aria-label="Replay controls">
        <button
          aria-label="Previous action (Page Up)"
          title="Previous action (Page Up)"
          disabled={atStart}
          onClick={() => go('prevAction')}
        >
          {'⏮︎'}
        </button>
        <button
          aria-label="Step back (Left arrow)"
          title="Step back (Left arrow)"
          disabled={atStart}
          onClick={() => go('back')}
        >
          {'◀︎'}
        </button>
        <button
          aria-label={playing ? 'Pause replay' : 'Play the chain step by step'}
          title={playing ? 'Pause' : 'Play step by step'}
          aria-pressed={playing}
          disabled={steps.length < 2}
          onClick={() => {
            if (playing) onPlay(false);
            else {
              // From live, replay the latest action from its start.
              if (at === null) onSeek(navigate(groups, null, 'prevAction'));
              onPlay(true);
            }
          }}
        >
          {playing ? '⏸︎' : '▶︎'}
        </button>
        <button
          aria-label="Step forward (Right arrow)"
          title="Step forward (Right arrow)"
          disabled={at === null}
          onClick={() => go('forward')}
        >
          {'▶︎|'}
        </button>
        <button
          aria-label="Next action (Page Down)"
          title="Next action (Page Down)"
          disabled={at === null}
          onClick={() => go('nextAction')}
        >
          {'⏭︎'}
        </button>
        <button
          class="live-btn"
          disabled={at === null}
          onClick={() => {
            onPlay(false);
            onSeek(null);
          }}
        >
          Live (End)
        </button>
      </div>
      <p class="sr-only" aria-live="polite">
        {at === null ? '' : `Step ${stepNo} of ${group?.steps.length ?? 0}: ${curText}`}
      </p>
      {from > 0 && (
        <button class="small more" onClick={() => setMore((m) => m + SHOWN_GROUPS)}>
          Show {Math.min(from, SHOWN_GROUPS)} earlier action{from === 1 ? '' : 's'}
        </button>
      )}
      <ol
        class="log-groups"
        ref={list}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Battle log. Use the arrow keys to step through a chain."
        tabIndex={0}
      >
        {shown.map((g) => (
          <li
            key={g.steps[0]?.i ?? g.n}
            class={`group ${g.n === gIndex && at !== null ? 'replaying' : ''}`}
          >
            <ol class="steps">
              {g.steps.map((e) => {
                const isCur = at !== null && e.i === at;
                const head = e.event.k === 'ActionStarted';
                const side = e.event.k === 'ActionStarted' ? e.event.side : null;
                return (
                  <li
                    key={e.i}
                    class={`step depth-${e.depth} kind-${e.event.k} ${isCur ? 'current' : ''} ${head ? 'head' : ''}`}
                    aria-current={isCur ? 'step' : undefined}
                    onClick={() => {
                      onPlay(false);
                      onSeek(e.i === lastI ? null : e.i);
                    }}
                  >
                    <span class="marker" aria-hidden="true">
                      {isCur ? '▶︎' : e.depth > 0 ? '↳' : ''}
                    </span>
                    {head && side ? (
                      <strong>
                        <span class={`glyph glyph-${side}`} aria-hidden="true">
                          {PIECE_GLYPH.pawn}
                        </span>{' '}
                        {groupTitle(g, actionNo(g))}
                        <span class="sr-only"> ({sideName(side)})</span>
                      </strong>
                    ) : (
                      e.text
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}
