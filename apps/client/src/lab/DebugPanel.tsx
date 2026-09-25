/**
 * Debug view of the full GameState (dev-only lab; the battle UI never sees this, R-INFO-005): both
 * armies' hidden loadouts and expanded sets, reveal logs, usage counters with charges left, module
 * state slices, the pending prompt record and every piece identity.
 */
import { useState } from 'preact/hooks';
import { PIECE_TYPES, squareName, type GameState, type Side } from '@chain-theorem/rules';
import type { LabFrame } from './frames.ts';
import type { LabSession } from './session.ts';
import { actionLabel, prettyJson, sideName } from './text.ts';

type Which = 'before' | 'after' | 'prompt';

const sq = (s: number) => (s >= 0 ? squareName(s) : 'off board');

function Army({ state, side }: { state: GameState; side: Side }) {
  const a = state.armies[side];
  const l = a.loadout;
  return (
    <div class="lab-army">
      <h5>{sideName(side)}</h5>
      <dl class="lab-kv">
        <dt>Level</dt>
        <dd>{a.level}</dd>
        <dt>Elements</dt>
        <dd>{l.elements.join(' + ')}</dd>
        <dt>Items</dt>
        <dd>
          {l.items.length === 0
            ? 'none'
            : l.items
                .map((id) => {
                  const el = l.itemParams?.[id]?.element;
                  return el ? `${id} (${el})` : id;
                })
                .join(', ')}
        </dd>
        <dt>Consumed slots</dt>
        <dd>{a.consumedSlots}</dd>
        <dt>Loadout sets</dt>
        <dd>{l.sets.length === 1 ? 'one army-wide set' : 'six per-type sets'}</dd>
      </dl>
      <table class="lab-table">
        <caption>Expanded ability sets (loadout order)</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Abilities</th>
            <th scope="col">Revealed to the opponent</th>
          </tr>
        </thead>
        <tbody>
          {PIECE_TYPES.map((t) => {
            const log = state.reveals[side];
            const known = log.abilities[t] ?? [];
            const flags = [
              log.complete.includes(t) ? 'set complete' : '',
              log.veiled.includes(t) ? 'veiled' : '',
            ].filter(Boolean);
            return (
              <tr key={t}>
                <th scope="row">{t}</th>
                <td>{a.sets[t].join(', ') || '—'}</td>
                <td>
                  {known.join(', ') || '—'}
                  {flags.length > 0 ? ` (${flags.join(', ')})` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="lab-hint">
        Items revealed: {state.reveals[side].items.join(', ') || 'none'}
        {state.reveals[side].allItems ? ' (full list known)' : ''}
      </p>
    </div>
  );
}

export function DebugPanel({ session, frame }: { session: LabSession; frame: LabFrame }) {
  const [which, setWhich] = useState<Which>('after');
  const [showFull, setShowFull] = useState(false);
  const action = frame.action;
  const prompt = frame.promptAfter;
  const mode: Which = which === 'prompt' && !prompt ? 'after' : which;
  const state =
    mode === 'before' ? action.before : mode === 'prompt' && prompt ? prompt.state : action.after;
  const engine = session.engine;
  const usage = Object.entries(state.usage).sort(([a], [b]) => a.localeCompare(b));
  const { pre: _pre, ...pendingShown } = state.pending ?? { pre: null };

  return (
    <section class="lab-debug panel" aria-labelledby="lab-debug-h">
      <h3 id="lab-debug-h">Debug: full game state (hidden information included)</h3>
      <div class="seg" role="group" aria-label="Which state">
        <button class="small" aria-pressed={mode === 'before'} onClick={() => setWhich('before')}>
          Before this action
        </button>
        {prompt && (
          <button class="small" aria-pressed={mode === 'prompt'} onClick={() => setWhich('prompt')}>
            At this prompt
          </button>
        )}
        <button class="small" aria-pressed={mode === 'after'} onClick={() => setWhich('after')}>
          {action.after.pending ? 'Now (prompt open)' : 'After this action'}
        </button>
      </div>
      <p class="lab-hint">
        {actionLabel(action)}. The engine exposes full states between actions and at prompts; the
        board above shows every event in between.
      </p>
      <dl class="lab-kv lab-summary">
        <dt>FEN</dt>
        <dd>
          <code>{engine.toFen(state)}</code>
        </dd>
        <dt>Turn / ply</dt>
        <dd>
          {state.turn} / {state.ply} (move {state.fullmove}, 50-move counter {state.halfmove})
        </dd>
        <dt>In check</dt>
        <dd>{state.inCheck ?? 'no'}</dd>
        <dt>Result</dt>
        <dd>
          {state.result ? `${state.result.winner ?? 'draw'} (${state.result.reason})` : 'none'}
        </dd>
        <dt>Format / objective</dt>
        <dd>
          {state.format} · white {state.objective.white}, black {state.objective.black}
        </dd>
        <dt>Capture counter / events</dt>
        <dd>
          {state.captureSeq} / {state.eventSeq}
        </dd>
        <dt>State hash</dt>
        <dd>
          <code>{engine.stateHash(state)}</code>
        </dd>
      </dl>
      <div class="lab-armies">
        <Army state={state} side="white" />
        <Army state={state} side="black" />
      </div>
      <table class="lab-table">
        <caption>Usage counters (charges spent per piece and ability)</caption>
        <thead>
          <tr>
            <th scope="col">Piece</th>
            <th scope="col">Ability</th>
            <th scope="col">Spent</th>
            <th scope="col">Left</th>
          </tr>
        </thead>
        <tbody>
          {usage.length === 0 && (
            <tr>
              <td colSpan={4}>No charges spent yet.</td>
            </tr>
          )}
          {usage.map(([key, n]) => {
            const [id, ability] = key.split(':') as [string, string];
            const p = state.pieces[Number(id)];
            return (
              <tr key={key}>
                <td>
                  #{id} {p ? `${p.side} ${p.type} (${sq(p.square)})` : ''}
                </td>
                <td>{ability}</td>
                <td>{n}</td>
                <td>{engine.remainingCharges(state, Number(id), ability)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details class="lab-json">
        <summary>State slices ({Object.keys(state.slices).length})</summary>
        <pre>{prettyJson(state.slices)}</pre>
      </details>
      <details class="lab-json">
        <summary>Pending prompt record{state.pending ? '' : ' (none)'}</summary>
        <pre>
          {state.pending ? prettyJson({ ...pendingShown, pre: '(pre-action snapshot)' }) : 'null'}
        </pre>
      </details>
      <details class="lab-json">
        <summary>Pieces ({state.pieces.length})</summary>
        <table class="lab-table">
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Side</th>
              <th scope="col">Type</th>
              <th scope="col">Element</th>
              <th scope="col">Square</th>
              <th scope="col">Start</th>
              <th scope="col">Captured at</th>
            </tr>
          </thead>
          <tbody>
            {state.pieces.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.side}</td>
                <td>{p.type}</td>
                <td>{p.element}</td>
                <td>{sq(p.square)}</td>
                <td>{sq(p.start)}</td>
                <td>{p.capturedSeq < 0 ? '—' : p.capturedSeq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details
        class="lab-json"
        onToggle={(e) => setShowFull((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Full GameState JSON</summary>
        {showFull && <pre>{prettyJson(state)}</pre>}
      </details>
    </section>
  );
}
