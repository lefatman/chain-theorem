/**
 * Hot-seat play on the loaded position (both sides are played here): click a piece and a
 * destination on the board, or type a UCI move; answer prompts for whichever side must choose; undo
 * the last action; export the session as a scenario() spec for a golden or module test.
 */
import { useState } from 'preact/hooks';
import { moveToUci, type Move } from '@chain-theorem/rules';
import { abilityName } from '../battle/describe.ts';
import type { LabFrame } from './frames.ts';
import { type LabSession, exportSpec, openPrompt } from './session.ts';
import { optionText, prettyJson, sideName } from './text.ts';

export interface PlayPanelProps {
  session: LabSession;
  live: LabFrame | undefined;
  atLive: boolean;
  legal: Move[];
  promo: Move[] | null;
  followChains: boolean;
  error: string | null;
  onFollowChains(on: boolean): void;
  onMove(uci: string): void;
  onAnswer(option: number): void;
  onPromo(m: Move | null): void;
  onUndo(): void;
  onGoLive(): void;
  onEditExport(): void;
}

export function PlayPanel(p: PlayPanelProps) {
  const [uci, setUci] = useState('');
  const state = p.session.state;
  const prompt = openPrompt(p.session);
  const pub = p.live?.pub;
  let status: string;
  if (state.result) {
    const r = state.result;
    status = `Battle over: ${r.winner ? `${sideName(r.winner)} wins` : 'draw'} (${r.reason.replace(/_/g, ' ')}).`;
  } else if (prompt) status = `${sideName(prompt.request.chooser)} must answer a prompt.`;
  else status = `${sideName(state.turn)} to move (${p.legal.length} legal moves).`;

  const submit = (e: Event) => {
    e.preventDefault();
    const m = uci.trim().toLowerCase();
    if (m === '') return;
    p.onMove(m);
    setUci('');
  };

  return (
    <section class="lab-play panel" aria-labelledby="lab-play-h">
      <h3 id="lab-play-h">Play from here (hot-seat)</h3>
      <p class="lab-status" role="status">
        {status}
      </p>
      {!p.atLive && (
        <p class="lab-hint">
          You are viewing an earlier step; a board click jumps to the live position.{' '}
          <button class="small" onClick={p.onGoLive}>
            Go to live
          </button>
        </p>
      )}
      {prompt && pub && (
        <div class="lab-prompt" role="group" aria-labelledby="lab-prompt-h">
          <p id="lab-prompt-h">
            <strong>
              <span aria-hidden="true">❓︎ </span>
              {sideName(prompt.request.chooser)}: {abilityName(prompt.request.source.ability)}
            </strong>{' '}
            (
            {prompt.request.kind === 'bonusMove'
              ? 'optional bonus move'
              : `choose a ${prompt.request.kind}`}
            ). Option squares are highlighted on the board.
          </p>
          <div class="lab-options">
            {prompt.request.options.map((o, i) => (
              <button key={i} class="small" onClick={() => p.onAnswer(i)}>
                {optionText(pub, o)}
                {i === prompt.request.defaultOption ? ' (default)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.promo && (
        <div class="lab-options" role="group" aria-label="Choose a promotion">
          <span>Promote to:</span>
          {p.promo.map((m) => (
            <button key={m.promotion} class="small" onClick={() => p.onPromo(m)}>
              {m.promotion}
            </button>
          ))}
          <button class="small ghost" onClick={() => p.onPromo(null)}>
            Cancel
          </button>
        </div>
      )}
      <form class="lab-uci" onSubmit={submit}>
        <label for="lab-uci-input">Move (UCI)</label>
        <input
          id="lab-uci-input"
          type="text"
          list="lab-legal"
          spellcheck={false}
          autocomplete="off"
          placeholder={p.legal[0] ? moveToUci(p.legal[0]) : ''}
          value={uci}
          disabled={!!prompt || !!state.result}
          onInput={(e) => setUci(e.currentTarget.value)}
        />
        <datalist id="lab-legal">
          {p.legal.map((m) => (
            <option key={moveToUci(m)} value={moveToUci(m)} />
          ))}
        </datalist>
        <button type="submit" disabled={!!prompt || !!state.result || uci.trim() === ''}>
          Play
        </button>
      </form>
      {p.error && (
        <p class="lab-error" role="alert">
          <span aria-hidden="true">✖︎ </span>
          {p.error}
        </p>
      )}
      <div class="lab-row">
        <button class="small" onClick={p.onUndo} disabled={p.session.actions.length <= 1}>
          <span aria-hidden="true">↶</span> Undo last action
        </button>
        <label class="check">
          <input
            type="checkbox"
            checked={p.followChains}
            onChange={(e) => p.onFollowChains(e.currentTarget.checked)}
          />
          After a move, start at its first event
        </label>
      </div>
      <details class="lab-json">
        <summary>Export as a scenario() spec</summary>
        <p class="lab-hint">
          Paste into a golden or module test (packages/content/src/testing.ts). Manual moves and
          answers are included.
        </p>
        <pre>{prettyJson(exportSpec(p.session))}</pre>
        <button class="small" onClick={p.onEditExport}>
          Open in the editor
        </button>
      </details>
    </section>
  );
}
