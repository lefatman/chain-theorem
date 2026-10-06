/**
 * Rebuild (M7 7.3, PLAYTEST; neutral since DD-98): Captures, neutral, all, revive, 1 charge. After
 * capturing a rook or queen, revive the owner's most recently captured rook on its starting square
 * (if empty). The attuned extension to knight and bishop victims was dropped by DD-98; the card has
 * no affinity and no attuned version. The `revive` tag puts it under Warden's Stopwatch (D-39).
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'rebuild',
  name: 'Rebuild',
  version: 2,
  category: 'CAPTURES',
  affinity: 'neutral',
  eligible: 'all',
  tags: ['revive'],
  minLevel: 17,
  slotCost: 1,
  limits: { perAction: 1, charges: 1 },
  conditions: [{ victimTypeIs: ['rook', 'queen'] }],
  effects: [fx.revive(target.mostRecentCaptured('friendly', 'rook'), square.start())],
  text: {
    short: 'Big captures rebuild a tower.',
    rules:
      'After capturing a rook or queen, revive your most recently captured rook on its starting square (1 charge).',
  },
  status: 'PLAYTEST',
});
