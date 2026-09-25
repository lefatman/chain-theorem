/**
 * Tournament games (M7 7.1; spec 10.4 R-WORLD-004): what a finished battle means for its
 * TournamentRoom, and the host calls that reach the room. The room records each battle once, so a
 * repeated report (a retry, the watchdog) changes nothing.
 */
import type { BattleArchive, BattleSummary } from '../battle/index.ts';
import type { Env } from '../env.ts';
import type { GameOutcome } from '../tournament/index.ts';

export function tournamentStub(env: Env, id: string): DurableObjectStub {
  return env.TOURNAMENT_ROOM.get(env.TOURNAMENT_ROOM.idFromName(id));
}

/**
 * The outcome of a tournament battle. A side that never sent a single frame before the battle ended
 * by abandonment never started the game (the battle core abandons a seat that does not connect
 * within the grace, 9.2): a forfeit for that player, and a double loss when neither came.
 */
export function gameOutcome(summary: Pick<BattleSummary, 'result' | 'stats'>): GameOutcome {
  const abandoned = summary.result.reason === 'abandon';
  const never = (side: 'white' | 'black') => abandoned && (summary.stats[side].received ?? 0) === 0;
  return {
    winner: summary.result.winner,
    reason: summary.result.reason,
    absent: { white: never('white'), black: never('black') },
  };
}

/** Tell the TournamentRoom a battle ended; true when the room took it. */
export async function reportTournamentResult(
  env: Env,
  tournamentId: string,
  battleId: string,
  outcome: GameOutcome,
): Promise<boolean> {
  const res = await tournamentStub(env, tournamentId).fetch('https://tournament/result', {
    method: 'POST',
    body: JSON.stringify({ battleId, outcome }),
  });
  return res.ok;
}

/** The archived battle's outcome (the watchdog's read of a battle whose report was lost). */
export async function archivedOutcome(
  env: Env,
  row: { result: string | null; reason: string | null; logKey: string | null },
): Promise<GameOutcome | null> {
  if (row.result === null) return null;
  if (row.logKey) {
    const obj = await env.BATTLE_LOGS.get(row.logKey);
    if (obj) {
      const archive = (await obj.json()) as BattleArchive;
      return gameOutcome(archive.summary);
    }
  }
  const winner = row.result === 'white' || row.result === 'black' ? row.result : null;
  return { winner, reason: row.reason ?? 'unknown', absent: { white: false, black: false } };
}

/** Account deletion (R-SEC-010): each event the player was in forgets them. Never throws. */
export async function forgetInTournaments(
  env: Env,
  ids: readonly string[],
  playerId: string,
): Promise<void> {
  for (const id of ids) {
    try {
      await tournamentStub(env, id).fetch('https://tournament/forget', {
        method: 'POST',
        body: JSON.stringify({ playerId }),
      });
    } catch (err) {
      console.error(`tournament ${id}: forgetting ${playerId} failed: ${String(err)}`);
    }
  }
}
