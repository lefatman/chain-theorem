/**
 * Rating a finished ranked battle (M6 6.2; spec 9.3 R-FMT-004, 15 R-SEC-008). Reads both stored
 * ratings for the battle's format and bracket and the pair's rated games of the last 24 hours, plans
 * the Glicko-2 updates (`planRatedGame`) and records the battle with both updates in one atomic list.
 * A battle is rated once (a repeat is a no-op); a rating that changed meanwhile makes the list abort,
 * and the settlement reads again and retries. Past the same-opponent cap the battle is recorded
 * unrated, and the repeated pairing is flagged in the audit log and counted in telemetry.
 */
import type { Db } from '@chain-theorem/db';
import type { BattleArchive, BattleSummary } from '../battle/index.ts';
import type { TelemetrySink } from '../telemetry.ts';
import { DAY_MS, planRatedGame, type Bracket, type RatedPlan } from './ranked.ts';

/** Audit kind of a repeated ranked pairing (R-SEC-008). */
export const REPEAT_PAIRING = 'ranked.repeat_pairing';
/** Telemetry counters. */
export const RANKED_COUNTERS = { rated: 'ranked_games', flagged: 'ranked_repeat_pairing' } as const;

const ATTEMPTS = 4;

export interface RankedResult {
  battleId: string;
  plan: RatedPlan;
  white: string;
  black: string;
}

/**
 * Rate a ranked battle between two human seats. Resolves to the plan that was recorded, or null when
 * the battle was rated before (or is not a human-vs-human battle).
 */
export async function settleRanked(
  db: Db,
  summary: BattleSummary,
  archive: Pick<BattleArchive, 'seats'>,
  bracket: Bracket,
  now: number,
  sink: TelemetrySink,
): Promise<RankedResult | null> {
  const ws = archive.seats.white;
  const bs = archive.seats.black;
  if (!('playerId' in ws) || !('playerId' in bs) || ws.playerId === bs.playerId) return null;
  const white = ws.playerId;
  const black = bs.playerId;
  const w = summary.result.winner;
  const scoreWhite = w === null ? 0.5 : w === 'white' ? 1 : 0;
  const format = summary.format;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const [wr, br, pair] = await Promise.all([
      db.ratings.get(white, format, bracket),
      db.ratings.get(black, format, bracket),
      db.ranked.pairGamesSince(white, black, now - DAY_MS),
    ]);
    const plan = planRatedGame({
      white: wr,
      black: br,
      scoreWhite,
      pairRatedToday: pair.rated,
      now,
    });
    const flag = (playerId: string, opponent: string) => ({
      playerId,
      kind: REPEAT_PAIRING,
      payload: {
        opponent,
        battleId: summary.battleId,
        format,
        bracket,
        gamesToday: pair.total + 1,
      },
    });
    const res = await db.ranked.record({
      battleId: summary.battleId,
      format,
      bracket,
      white: {
        playerId: white,
        before: wr ? { games: wr.games } : null,
        after: plan.white.after,
        delta: plan.white.delta,
      },
      black: {
        playerId: black,
        before: br ? { games: br.games } : null,
        after: plan.black.after,
        delta: plan.black.delta,
      },
      scoreWhite,
      rated: plan.rated,
      ...(plan.flagged ? { audit: [flag(white, black), flag(black, white)] } : {}),
      at: now,
    });
    if (res === 'duplicate') return null;
    if (res === 'conflict') continue;
    sink.count(RANKED_COUNTERS.rated, 1, { format, bracket });
    if (plan.flagged) sink.count(RANKED_COUNTERS.flagged, 1, { format, bracket });
    sink.flush();
    return { battleId: summary.battleId, plan, white, black };
  }
  throw new Error(`ranked ${summary.battleId}: ratings kept changing; not rated`);
}
