/**
 * Redo (5.8, PLAYTEST; designer brief 2026-10-06, DD-97, DD-100; B5 brief 2026-10-11): Captured,
 * neutral, non-pawn, replay, 1 charge. When this piece is captured by a move of a piece of equal or
 * higher rank, the position returns to the start of the previous action: that action and the
 * capturing reply are undone (two plies; one when the capture was the battle's first action) and the
 * side to move there acts again. Charges spent, including this one, everything revealed and the
 * clocks are not undone; the undone positions leave the repetition history; the rewind resolves
 * before any format objective is adjudicated, and nothing queued after it in the chain resolves.
 * Effect captures do not chain (5.4), so only a capturing move triggers it. The `replay` tag puts it
 * under Warden's Stopwatch. Not on pawns (B5): every piece but a pawn outranks or equals a pawn, so a
 * Redo pawn rewound almost every capture of it; a pawn carrying it is captured without a rewind (7.3).
 */
import { defineAbility, fx } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'redo',
  name: 'Redo',
  version: 2,
  category: 'CAPTURED',
  affinity: 'neutral',
  // Every piece type but the pawn (B5): the ability does nothing on a pawn (7.3).
  eligible: ['knight', 'bishop', 'rook', 'queen', 'king'],
  tags: ['replay'],
  minLevel: 15,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ rank: { of: 'captor', cmp: '>=', to: 'victim' } }],
  effects: [fx.rewind()],
  text: {
    short: 'Taken by its equal or better, it turns back time.',
    rules:
      'When this piece is captured by a move of a piece of equal or higher rank, the position returns to before the previous action: that action and the capture are undone and play resumes from there. Charges already spent (this one included), anything revealed and the clocks stay as they are (1 charge; not on pawns).',
  },
  status: 'PLAYTEST',
});
