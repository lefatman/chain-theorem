/**
 * Rebuild (M7 7.3, PLAYTEST): Captures, Stone, all, revive, 1 charge. After capturing a rook or
 * queen, revive the owner's most recently captured rook on its starting square (if empty). Attuned:
 * also after capturing a knight or bishop (`attuned.conditions` replace the base ones, 3.9).
 * Stone protects the army's walls (6.1); the `revive` tag puts it under Warden's Stopwatch (D-39).
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'rebuild',
  name: 'Rebuild',
  version: 1,
  category: 'CAPTURES',
  affinity: 'stone',
  eligible: 'all',
  tags: ['revive'],
  minLevel: 17,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ victimTypeIs: ['rook', 'queen'] }],
  effects: [fx.revive(target.mostRecentCaptured('friendly', 'rook'), square.start())],
  attuned: {
    mode: 'replace',
    conditions: [{ victimTypeNot: 'pawn' }],
    effects: [fx.revive(target.mostRecentCaptured('friendly', 'rook'), square.start())],
  },
  text: {
    short: 'Big captures rebuild a tower.',
    rules:
      'After capturing a rook or queen, revive your most recently captured rook on its starting square (1 charge). Attuned: also after capturing a knight or bishop.',
  },
  status: 'PLAYTEST',
});
