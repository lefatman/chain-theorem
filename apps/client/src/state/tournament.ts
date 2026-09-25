/**
 * The tournament game being played (M7 7.1): lets the battle screen offer "Back to the tournament"
 * when it ends. Set when a player opens their game from the Tournaments screen.
 */
import { signal } from '@preact/signals';
import type { BattleController } from '../battle/controller.ts';

export const tournamentBattle = signal<{
  controller: BattleController;
  tournamentId: string;
} | null>(null);
