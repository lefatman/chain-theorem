/**
 * The live world session, shared by the lazily loaded world screen, the title menu and the battle
 * result panel. Types only: importing this never pulls the world code into the first load (12.3).
 */
import { signal } from '@preact/signals';
import type { BattleController } from '../battle/controller.ts';
import type { WorldController } from './controller.ts';

/** The zone connection, alive while the player is in the world (and in a battle started there). */
export const worldSession = signal<WorldController | null>(null);

/** The battle the world handed the player to; its result panel offers "Return to the world". */
export const worldBattle = signal<BattleController | null>(null);
