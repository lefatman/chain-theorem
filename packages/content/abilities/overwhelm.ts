/**
 * Overwhelm (5.7, PLAYTEST; designer brief 2026-10-09, plan item C6; DD-125): Capturing, neutral,
 * all, 2 charges. When this piece captures a piece of lower rank (5.1, DD-97: pawn 1 < knight =
 * bishop 2 < rook 3 < queen 4 < king 5), negate the victim's Captured abilities for this capture. A
 * rank-conditioned Pierce built from existing primitives: the rank trigger condition keeps it from
 * triggering against an equal or higher rank (no event, no reveal, no charge), and like Pierce a
 * charge is spent whenever it fires, whether or not the victim had anything to negate (DD-17).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'overwhelm',
  name: 'Overwhelm',
  version: 1,
  category: 'CAPTURING',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 9,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  conditions: [{ rank: { of: 'captor', cmp: '>', to: 'victim' } }],
  effects: [fx.negate('victim', ['CAPTURED'])],
  text: {
    short: 'Rank has its weight.',
    rules:
      "When capturing a piece of lower rank, negate the victim's When-captured abilities for this capture (2 charges).",
  },
  status: 'PLAYTEST',
});
