/**
 * NPC dialog (M5, spec 10.3–10.5): the NPC's lines one at a time, handheld style, then the options
 * the zone offers (battle, lessons, quests, skip). E, space or Enter advances; Escape closes.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { WorldController } from '../../world/controller.ts';

export function DialogBox({ c }: { c: WorldController }) {
  const d = c.dialog.value;
  const [page, setPage] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setPage(0), [d]);
  useEffect(() => {
    // Focus the first button so E / space / Enter act on the dialog, not the map.
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [d, page]);
  if (!d) return null;
  const last = Math.max(0, d.lines.length - 1);
  const atEnd = page >= last;
  const line = d.lines[Math.min(page, last)] ?? '';
  return (
    <div
      class="world-dialog"
      role="dialog"
      aria-labelledby="world-dialog-name"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          c.closeDialog();
        } else if ((e.key === 'e' || e.key === 'E') && !atEnd) {
          e.preventDefault();
          setPage(page + 1);
        }
      }}
    >
      <p class="world-dialog-name" id="world-dialog-name">
        {d.name}
      </p>
      <p class="world-dialog-line" aria-live="polite">
        {line}
      </p>
      {!atEnd ? (
        <div class="row">
          <span class="muted small-text">
            {page + 1}/{d.lines.length}
          </span>
          <button type="button" class="primary" onClick={() => setPage(page + 1)}>
            Next <span aria-hidden="true">▸</span>
          </button>
        </div>
      ) : (
        <div class="row">
          {d.options.map((o) => (
            <button
              type="button"
              key={o.id}
              class={o.id.startsWith('skip:') ? '' : 'primary'}
              onClick={() => c.choose(o.id)}
            >
              {o.label}
            </button>
          ))}
          <button type="button" onClick={() => c.closeDialog()}>
            {d.options.length > 0 ? 'Not now' : 'Close'}
          </button>
        </div>
      )}
    </div>
  );
}
