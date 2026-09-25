/** Holds the active local battle controller between the setup and battle screens, plus rematch. */
import { signal } from '@preact/signals';
import type { FormatId } from '@chain-theorem/rules';
import type { BattleController } from '../battle/controller.ts';
import { LocalController } from '../battle/local.ts';
import type { SavedLoadout } from '../state/profile.ts';
import { settings } from '../state/settings.ts';

export const activeBattle = signal<BattleController | null>(null);
/** Increments per battle so the battle view remounts cleanly (fresh board, log and replay state). */
export const battleSerial = signal(0);
/** How the current battle was started (rematch, result screen). */
export const lastStart = signal<LocalStart | null>(null);

export type Opponent = 'wild' | 'trainer' | 'elite' | 'human';

export interface LocalStart {
  format: FormatId;
  opponent: Opponent;
  mine: SavedLoadout;
  theirs: SavedLoadout;
  side: 'white' | 'black';
  timed: boolean;
  fen?: string;
}

export function opponentName(o: Opponent): string {
  return o === 'human' ? 'Player 2' : `${o[0]?.toUpperCase()}${o.slice(1)} NPC`;
}

export function startLocalBattle(o: LocalStart): LocalController {
  activeBattle.value?.dispose();
  (globalThis as { ctPassDevice?: boolean }).ctPassDevice = settings.value.passDevice;
  const me = {
    name: 'You',
    level: o.mine.level,
    loadout: o.mine.loadout,
    control: 'human' as const,
  };
  const them = {
    name: opponentName(o.opponent),
    level: o.theirs.level,
    loadout: o.theirs.loadout,
    control: o.opponent,
  };
  const c = new LocalController({
    format: o.format,
    white: o.side === 'white' ? me : them,
    black: o.side === 'white' ? them : me,
    timed: o.timed,
    ...(o.fen ? { fen: o.fen } : {}),
  });
  lastStart.value = o;
  battleSerial.value += 1;
  activeBattle.value = c;
  return c;
}

/** Rematch (9.2): same format, loadouts and opponent, colours swapped. */
export function rematch(): boolean {
  const o = lastStart.value;
  if (!o) return false;
  startLocalBattle({ ...o, side: o.side === 'white' ? 'black' : 'white' });
  return true;
}
