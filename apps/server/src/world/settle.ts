/**
 * After a battle ends (M5 5.2, R-SEC-003): pay each human player once (grant keys make repeats
 * no-ops), raise their level, and tell the zone channel they are in so it clears the battling marker,
 * advances quests and lessons and shows the reward. A player who already left the zone gets the same
 * progress applied from storage.
 */
import type { Db } from '@chain-theorem/db';
import type { Reward } from '@chain-theorem/content/world';
import type { BattleArchive, BattleSummary } from '../battle/index.ts';
import type { Env } from '../env.ts';
import type { BattleUsage } from '../metrics.ts';
import type { BattleOrigin } from './battles.ts';
import { battleGrants, seatResults, zoneOutcome } from './outcome.ts';
import { grantOnce, offlineBattleEnd, syncLevel } from './progress.ts';
import { callPlayer } from './routing.ts';

export async function settleBattle(
  env: Env,
  db: Db,
  summary: BattleSummary,
  archive: BattleArchive,
  origin: BattleOrigin,
  now: number,
): Promise<void> {
  for (const seat of seatResults(summary, archive)) {
    const granted: Reward[] = [];
    for (const plan of battleGrants(origin, seat, summary)) {
      const r = await grantOnce(db, seat.playerId, plan, now);
      if (r) granted.push(r);
    }
    const level = await syncLevel(db, seat.playerId);
    const outcome = zoneOutcome(origin, seat, summary);
    if (!outcome && granted.length === 0) continue;
    const told = await callPlayer(env, db, seat.playerId, 'ended', {
      id: seat.playerId,
      outcome,
      rewards: granted,
      level,
    });
    if (!told && outcome) {
      await offlineBattleEnd(db, seat.playerId, outcome, now);
      await syncLevel(db, seat.playerId);
    }
  }
}

/** What the battle cost, for the cost dashboard (14.2). */
export function battleUsage(summary: BattleSummary, archive: BattleArchive): BattleUsage {
  let npcMoves = 0;
  let alarms = 0;
  for (const r of archive.records) {
    if (r.cause === 'npc') npcMoves++;
    if (r.cause !== 'player' && r.cause !== 'start') alarms++;
  }
  const humans = (['white', 'black'] as const).filter((s) => 'playerId' in archive.seats[s]).length;
  return {
    at: summary.endedAt,
    messages: (summary.stats.white.received ?? 0) + (summary.stats.black.received ?? 0),
    records: summary.records,
    npcMoves,
    alarms,
    humans,
  };
}
