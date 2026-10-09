/**
 * `--caps` overrides for the simulator and the fuzzer (R-TEST-002): a JSON object of CAPS entries for
 * a variant run, such as `{"ELECTRIC_SLIDE":{"turners":["rook"]}}`. Object-valued caps merge one
 * level deep onto the configured defaults, so a variant names only the fields it changes.
 */
import { CAPS } from '@chain-theorem/content';
import type { Caps } from '@chain-theorem/rules/sdk';

export function capsOverrides(json: string): Partial<Caps> {
  if (json === '') return {};
  const raw = JSON.parse(json) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const base = (CAPS as Record<string, unknown>)[k];
    out[k] =
      v !== null && typeof v === 'object' && !Array.isArray(v) && base && typeof base === 'object'
        ? { ...(base as object), ...(v as object) }
        : v;
  }
  return out as Partial<Caps>;
}
