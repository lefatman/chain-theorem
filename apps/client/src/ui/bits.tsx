/**
 * Small presentational pieces shared by the loadout builder and the battle HUD. Every coloured
 * badge carries an icon and a text label (R-ART-002), and meters always print their numbers.
 */
import type { ComponentChildren, JSX } from 'preact';
import type { Category, ElementId, PieceType, Side } from '@chain-theorem/rules';
import { CATEGORY_ICON, CATEGORY_LABEL, ELEMENT_NAME, PIECE_GLYPH, cap } from './labels.ts';

/**
 * Element icon shapes matching the board's (flame, wave, leaf, bolt, rock, snowflake, hollow
 * circle), so an element reads by shape as well as colour (R-ART-002).
 */
const ELEMENT_SVG: Record<ElementId, JSX.Element> = {
  ember: (
    <path d="M8 1c1 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.6 0 2 .8 3.1 1.8 3.4C6.4 5.8 7 3.4 8 1z" />
  ),
  tide: (
    <path
      d="M1 6.5c2.3-2.4 4.7-2.4 7 0s4.7 2.4 7 0M1 11.5c2.3-2.4 4.7-2.4 7 0s4.7 2.4 7 0"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
  ),
  grove: <path d="M2.5 14C2 6.5 7 2 14 2c.3 7-4 12-11.5 12zm.5-.5 6-6.5" />,
  storm: <path d="M9.5 1 3 9h4.2L6 15l7-8.5H8.7L9.5 1z" />,
  stone: <path d="M1.5 13 4.5 5 9 2.5l4.5 4 1 6.5z" />,
  frost: (
    <path
      d="M8 1v14M1.9 4.5l12.2 7M1.9 11.5l12.2-7"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  ),
  neutral: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />,
};

export function ElementIcon({ el }: { el: ElementId }) {
  return (
    <svg
      class="el-icon"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      {ELEMENT_SVG[el]}
    </svg>
  );
}

export function ElementBadge({ el, suffix }: { el: ElementId; suffix?: string }) {
  return (
    <span class={`el el-${el}`}>
      <ElementIcon el={el} /> {ELEMENT_NAME[el]}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}

export function CategoryTag({ cat }: { cat: Category }) {
  return (
    <span class={`cat cat-${cat.toLowerCase()}`}>
      <span aria-hidden="true">{CATEGORY_ICON[cat]}</span> {CATEGORY_LABEL[cat]}
    </span>
  );
}

export function PieceGlyph({ type, side }: { type: PieceType; side?: Side }) {
  return (
    <span class={`glyph ${side ? `glyph-${side}` : ''}`} aria-hidden="true">
      {PIECE_GLYPH[type]}
    </span>
  );
}

export function TypeLabel({ type, side }: { type: PieceType; side?: Side }) {
  return (
    <span class="type-label">
      <PieceGlyph type={type} {...(side ? { side } : {})} /> {cap(type)}
    </span>
  );
}

/** Charge pips: filled = left, hollow = spent. The accessible name states the numbers. */
export function Pips({ left, total, label }: { left: number; total: number; label: string }) {
  const shown = Math.max(0, Math.min(total, 12));
  return (
    <span class="pips" role="img" aria-label={`${label}: ${left} of ${total} left`}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} class={i < left ? 'pip on' : 'pip off'} aria-hidden="true">
          {i < left ? '●' : '○'}
        </span>
      ))}
      <span class="pips-num" aria-hidden="true">
        {left}/{total}
      </span>
    </span>
  );
}

export interface MeterCell {
  state: 'used' | 'free' | 'locked' | 'over';
  label?: string;
}

/**
 * A row of cells with a printed summary (item slots, set capacity). Shape differs per state
 * (filled, hollow, lock, warning) so the meter reads without colour.
 */
export function Meter({
  cells,
  summary,
  label,
}: {
  cells: MeterCell[];
  summary: ComponentChildren;
  label: string;
}) {
  // Shape per state: filled square, hollow square, dashed cross (locked), exclamation (over).
  const icon = { used: '■', free: '□', locked: '×', over: '!' };
  return (
    <div class="meter" role="group" aria-label={label}>
      <span class="meter-cells" aria-hidden="true">
        {cells.map((c, i) => (
          <span key={i} class={`cell ${c.state}`} title={c.label}>
            {icon[c.state]}
          </span>
        ))}
      </span>
      <span class="meter-summary">{summary}</span>
    </div>
  );
}

/** Visually hidden text for screen readers. */
export function Sr({ children }: { children: ComponentChildren }) {
  return <span class="sr-only">{children}</span>;
}
