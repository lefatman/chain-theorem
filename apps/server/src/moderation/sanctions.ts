/**
 * Moderation state (M6 6.4): a suspension (for a duration or indefinitely) and a server-wide chat
 * ban, both stored on the player row (migration 0006) and checked wherever play or chat starts:
 * sign-in, the session lookup, every ticket and socket upgrade (R-SEC-006), and the zone core (chat).
 */
import type { Player } from '@chain-theorem/db';

/** Socket close code for a suspended player (zone, trade, queue and battle sockets). */
export const CLOSE_SUSPENDED = 4003;
export const SUSPENDED = 'suspended';

type Sanctions = Pick<Player, 'suspendedAt' | 'suspendedUntil' | 'chatBanUntil'>;

/** Suspended right now: set, and either indefinite or not yet over. */
export function isSuspended(p: Sanctions, now: number): boolean {
  return p.suspendedAt !== null && (p.suspendedUntil === null || now < p.suspendedUntil);
}

/** Banned from chat right now. */
export function isChatBanned(p: Sanctions, now: number): boolean {
  return p.chatBanUntil !== null && now < p.chatBanUntil;
}

/** What a suspended player is told when sign-in is refused (never the reason or the moderator). */
export function suspensionView(p: Sanctions, now: number): { until: number | null } | null {
  return isSuspended(p, now) ? { until: p.suspendedUntil } : null;
}

/**
 * R-SEC-010: a suspended player cannot sign in, but keeps the right to export and delete their data.
 * The refused sign-in (which proved the email) hands out this short-lived token, valid only for
 * `GET /api/me/export?data=` and `DELETE /api/me?data=` (DD-91).
 */
export const DATA_TOKEN_TTL_MS = 15 * 60 * 1000;
export const DATA_ROOM = 'data';
