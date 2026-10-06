/**
 * Quantum Kill (5.8, PLAYTEST; designer brief 2026-10-06, DD-97, DD-103): Captures, neutral, all,
 * replay, 2 charges. After capturing a victim of higher rank than this piece, effect-capture one
 * enemy piece of rank at most this piece's (the owner chooses; never a king, R-RULES-004). When no
 * such piece exists, this piece may make one non-capturing move instead (a declinable bonus action,
 * INV-01; the `replay` tag puts it under Warden's Stopwatch).
 */
import {
  cond,
  defineAbility,
  fx,
  NON_KING,
  target,
  type PieceFilter,
} from '@chain-theorem/rules/sdk';

/** Enemy pieces of rank at most the captor's. */
const LESSER: PieceFilter = { side: 'enemy', types: NON_KING, rank: { cmp: '<=', to: 'captor' } };

export default defineAbility({
  id: 'quantum_kill',
  name: 'Quantum Kill',
  version: 1,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['replay'],
  minLevel: 13,
  slotCost: 1,
  limits: { perAction: 1, charges: 2 },
  conditions: [{ rank: { of: 'victim', cmp: '>', to: 'captor' } }],
  effects: [
    fx.when(cond.noneMatch(LESSER), [
      fx.bonusAction({ movers: 'self', capture: 'none', optional: true }),
    ]),
    fx.when(cond.not(cond.noneMatch(LESSER)), [fx.effectCapture(target.chosen(LESSER))]),
  ],
  text: {
    short: 'Punching up takes a second piece with it.',
    rules:
      'After capturing a piece of higher rank than this piece, effect-capture one enemy piece of equal or lower rank than this piece (you choose). If there is none, this piece may make one move that does not capture instead (2 charges).',
  },
  status: 'PLAYTEST',
});
