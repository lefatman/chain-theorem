/** How a BattleRoom is created (Worker or Matchmaker → BattleRoom `POST /init`). */
import type { FormatId } from '@chain-theorem/rules';

export type { BattleInit as RoomInit, SeatInit } from '../battle/index.ts';
import type { SeatInit } from '../battle/index.ts';

/** A challenge link's battle: one seat is known, the other joins through the link (`POST /join`). */
export interface LobbyInit {
  battleId: string;
  format: FormatId;
  code: string;
  creator: SeatInit & { playerId: string };
}

/** Colours for two seats: random, from the platform's CSPRNG (White is assigned by the server, 4.2). */
export function assignColours<T>(a: T, b: T): { white: T; black: T } {
  const r = new Uint8Array(1);
  crypto.getRandomValues(r);
  return ((r[0] ?? 0) & 1) === 0 ? { white: a, black: b } : { white: b, black: a };
}
