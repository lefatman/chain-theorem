/**
 * Scenario picker and editor: the worked examples E1 to E9 of spec 5.5 (with the spec's expected
 * result next to them, for BUILD_PROMPT section 8's "compare each with spec 5.5"), or a custom
 * position with one JSON army per side, scripted moves and prompt answers.
 */
import type { ComponentChildren } from 'preact';
import type { FormatId } from '@chain-theorem/rules';
import { WORKED_EXAMPLES, type WorkedExample } from '../../../../packages/content/src/examples.ts';
import {
  FORMATS,
  type CustomDraft,
  type DraftField,
  type Issue,
  type ParsedDraft,
} from './parse.ts';

export type LabSource =
  { kind: 'example'; id: string; variant: number | null } | { kind: 'custom' };

const FORMAT_NAME: Record<FormatId, string> = {
  first_blood: 'First Blood',
  vanguard: 'Vanguard',
  full: 'Full Battle',
};

function Issues({ list, id }: { list: Issue[]; id: string }) {
  if (list.length === 0) return null;
  return (
    <ul class="lab-issues" id={id}>
      {list.map((i, n) => (
        <li key={n} class={i.level === 'error' ? 'lab-error' : 'lab-warning'}>
          <span aria-hidden="true">{i.level === 'error' ? '✖︎ ' : '⚠︎ '}</span>
          <strong>{i.level === 'error' ? 'Error' : 'Warning'}:</strong> {i.text}
        </li>
      ))}
    </ul>
  );
}

function Field({
  field,
  label,
  hint,
  issues,
  children,
}: {
  field: DraftField;
  label: string;
  hint?: string;
  issues: ParsedDraft['issues'];
  children: ComponentChildren;
}) {
  return (
    <div class={`lab-field lab-field-${field}`}>
      <label for={`lab-${field}`}>{label}</label>
      {hint && (
        <p class="lab-hint" id={`lab-${field}-hint`}>
          {hint}
        </p>
      )}
      {children}
      <Issues list={issues[field]} id={`lab-${field}-issues`} />
    </div>
  );
}

function describedBy(field: DraftField, issues: ParsedDraft['issues'], hint: boolean): string {
  return [hint ? `lab-${field}-hint` : '', issues[field].length > 0 ? `lab-${field}-issues` : '']
    .filter(Boolean)
    .join(' ');
}

export interface SetupPanelProps {
  source: LabSource;
  draft: CustomDraft;
  parsed: ParsedDraft;
  editorOpen: boolean;
  onEditorOpen(open: boolean): void;
  onExample(ex: WorkedExample, variant: number | null): void;
  onDraft(field: DraftField, value: string): void;
  onCustom(): void;
  onRun(scripted: boolean): void;
}

export function SetupPanel(p: SetupPanelProps) {
  const src = p.source;
  const current = src.kind === 'example' ? WORKED_EXAMPLES.find((e) => e.id === src.id) : undefined;
  const variant =
    current && src.kind === 'example' && src.variant !== null
      ? current.variants?.[src.variant]
      : undefined;
  const { issues } = p.parsed;
  const errors = Object.values(issues).reduce(
    (n, list) => n + list.filter((i) => i.level === 'error').length,
    0,
  );
  const area = (field: 'white' | 'black' | 'answers', rows: number, hint: boolean) => (
    <textarea
      id={`lab-${field}`}
      rows={rows}
      spellcheck={false}
      value={p.draft[field]}
      aria-invalid={issues[field].some((i) => i.level === 'error')}
      aria-describedby={describedBy(field, issues, hint) || undefined}
      onInput={(e) => p.onDraft(field, e.currentTarget.value)}
    />
  );

  return (
    <section class="lab-setup panel" aria-labelledby="lab-setup-h">
      <h3 id="lab-setup-h">Scenario</h3>
      <div class="lab-examples" role="group" aria-label="Worked examples (spec 5.5)">
        {WORKED_EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            class="small"
            aria-pressed={p.source.kind === 'example' && p.source.id === ex.id}
            title={ex.title}
            onClick={() => p.onExample(ex, null)}
          >
            {ex.id}
          </button>
        ))}
        <button class="small" aria-pressed={p.source.kind === 'custom'} onClick={p.onCustom}>
          Custom
        </button>
      </div>

      {current && (
        <div class="lab-example">
          <h4>
            {current.id}: {current.title}
            {variant ? ` (${variant.label})` : ''}
          </h4>
          <dl>
            <dt>Setup (spec 5.5)</dt>
            <dd>{current.setupText}</dd>
            <dt>Expected result (spec 5.5)</dt>
            <dd class="lab-expected">{current.specText}</dd>
            {current.note && (
              <>
                <dt>Staging</dt>
                <dd>{current.note}</dd>
              </>
            )}
          </dl>
          {current.variants && current.variants.length > 0 && (
            <div class="lab-variants" role="group" aria-label={`${current.id} variants`}>
              <button
                class="small"
                aria-pressed={p.source.kind === 'example' && p.source.variant === null}
                onClick={() => p.onExample(current, null)}
              >
                Main setup
              </button>
              {current.variants.map((v, i) => (
                <button
                  key={v.label}
                  class="small"
                  aria-pressed={p.source.kind === 'example' && p.source.variant === i}
                  onClick={() => p.onExample(current, i)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <details
        class="lab-editor"
        open={p.editorOpen}
        onToggle={(e) => p.onEditorOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          {p.source.kind === 'custom' ? 'Custom position' : 'Edit this position and loadouts'}
          {errors > 0 ? ` (${errors} error${errors === 1 ? '' : 's'})` : ''}
        </summary>
        <div class="lab-editor-grid">
          <Field
            field="fen"
            label="Position (FEN)"
            hint="Piece ids are assigned a1..h8 in square order. Empty = the standard start."
            issues={issues}
          >
            <input
              id="lab-fen"
              type="text"
              spellcheck={false}
              value={p.draft.fen}
              aria-invalid={issues.fen.some((i) => i.level === 'error')}
              aria-describedby={describedBy('fen', issues, true) || undefined}
              onInput={(e) => p.onDraft('fen', e.currentTarget.value)}
            />
          </Field>
          <Field field="format" label="Format" issues={issues}>
            <select
              id="lab-format"
              value={p.draft.format}
              onChange={(e) => p.onDraft('format', e.currentTarget.value)}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_NAME[f]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            field="white"
            label="White army (JSON)"
            hint='{"level", "elements", "items", "itemParams", "sets"}: sets holds 1 army-wide set or 6 (pawn..king). "abilities" is shorthand for one set.'
            issues={issues}
          >
            {area('white', 7, true)}
          </Field>
          <Field field="black" label="Black army (JSON)" issues={issues}>
            {area('black', 7, false)}
          </Field>
          <Field
            field="moves"
            label="Scripted moves (UCI)"
            hint="Played in order by the side to move, e.g. c3d5 e8e7 (promotion: e7e8q)."
            issues={issues}
          >
            <input
              id="lab-moves"
              type="text"
              spellcheck={false}
              value={p.draft.moves}
              aria-invalid={issues.moves.some((i) => i.level === 'error')}
              aria-describedby={describedBy('moves', issues, true) || undefined}
              onInput={(e) => p.onDraft('moves', e.currentTarget.value)}
            />
          </Field>
          <Field
            field="answers"
            label="Prompt answers (JSON array)"
            hint='Used in order; each is an option index or the option, e.g. {"kind":"square","square":"c1"} or {"kind":"move","from":"h7","to":"g6"}. Missing answers take the default option.'
            issues={issues}
          >
            {area('answers', 3, true)}
          </Field>
        </div>
        <div class="lab-run">
          <button class="primary" disabled={!p.parsed.spec} onClick={() => p.onRun(true)}>
            Run scripted moves
          </button>
          <button disabled={!p.parsed.spec} onClick={() => p.onRun(false)}>
            Load position only
          </button>
          {!p.parsed.spec && (
            <span class="lab-error" role="status">
              <span aria-hidden="true">✖︎ </span>Fix the errors above to run.
            </span>
          )}
        </div>
      </details>
    </section>
  );
}
