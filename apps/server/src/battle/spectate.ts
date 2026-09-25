/**
 * Which battles spectators may watch (M7 7.2, spec 10.4). Public by default: ranked battles,
 * tournament games and challenge-zone battles (entering a challenge zone is consent to be challenged
 * in public, R-WORLD-006). Not listed: NPC, lesson and wild battles, consent challenges, challenge
 * links, casual queue pairings and item wagers (both players chose to play each other privately, or
 * no second person is involved). A public battle is listed only when both players allow spectators
 * (`spectatingAllowed`: their own setting, default on for adults and off under 18, R-SEC-011).
 */
import type { LiveKind } from '@chain-theorem/protocol';
import type { BattleOrigin } from '../world/battles.ts';

/** Why a battle of this origin is public, or null when it is not listed. */
export function liveKind(origin: BattleOrigin): LiveKind | null {
  switch (origin.kind) {
    case 'ranked':
      return 'ranked';
    case 'challenge':
      return origin.auto ? 'challenge_zone' : null;
    default:
      // M7 7.1 tournament games (origin kind `tournament`) are public too.
      return (origin.kind as string) === 'tournament' ? 'tournament' : null;
  }
}

/** Listing details of a public origin: the ranked bracket or the tournament's name or id. */
export function liveDetails(origin: BattleOrigin): { bracket?: string; tournament?: string } {
  if (origin.kind === 'ranked') return { bracket: origin.bracket };
  const o = origin as { kind: string; name?: unknown; tournamentId?: unknown; id?: unknown };
  if (o.kind !== 'tournament') return {};
  const label = [o.name, o.tournamentId, o.id].find((x) => typeof x === 'string');
  return typeof label === 'string' ? { tournament: label.slice(0, 80) } : {};
}
