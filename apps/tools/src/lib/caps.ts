/**
 * `--caps` overrides for the simulator and the fuzzer (R-TEST-002): a JSON object of CAPS entries for
 * a variant run, such as `{"ELECTRIC_SLIDE":{"turners":["rook"]}}`. Object-valued caps merge one
 * level deep onto the configured defaults, so a variant names only the fields it changes.
 */
import { CAPS } from '@chain-theorem/content';
import type { Caps } from '@chain-theorem/rules/sdk';

const CORNERS = ['pieces', 'no_knights', 'moved'];
const TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

export function capsOverrides(json: string): Partial<Caps> {
  if (json === '') return {};
  const raw = JSON.parse(json) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const base = (CAPS as Record<string, unknown>)[k];
    if (!(k in CAPS)) throw new Error(`--caps: unknown cap ${k}`);
    out[k] =
      v !== null && typeof v === 'object' && !Array.isArray(v) && base && typeof base === 'object'
        ? { ...(base as object), ...(v as object) }
        : v;
  }
  // A misspelt Electric Slide value would silently measure another rule (no corner conducts).
  const slide = out.ELECTRIC_SLIDE as Caps['ELECTRIC_SLIDE'] | undefined;
  if (slide) {
    if (!CORNERS.includes(slide.corners))
      throw new Error(`--caps: ELECTRIC_SLIDE.corners must be one of ${CORNERS.join(', ')}`);
    if (!Array.isArray(slide.turners) || slide.turners.some((t) => !TYPES.includes(t)))
      throw new Error(`--caps: ELECTRIC_SLIDE.turners must list piece types`);
  }
  return out as Partial<Caps>;
}
