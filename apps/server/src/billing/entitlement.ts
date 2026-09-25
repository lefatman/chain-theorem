/**
 * Entitlement (14.4 R-COST-005, R-SEC-007): decided on the server from the player row only, never
 * from the client. A new account has a 7-day free trial with full play (COMMITTED); trial accounts
 * cannot trade or wager, so they cannot farm items for other accounts. A paid subscription (kept up
 * to date by verified provider webhooks, M6 6.3) unlocks everything that affects play.
 */
import type { Player } from '@chain-theorem/db';

/** 14.4: the free trial lasts 7 days (COMMITTED). */
export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Subscription states stored in `players.sub_status` (provider webhooks set them). */
export const SUB_STATUSES = ['none', 'active', 'past_due', 'canceled', 'paused'] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export type Access = 'trial' | 'subscriber' | 'expired';

type Facts = Pick<Player, 'subStatus' | 'subExpiresAt' | 'trialEndsAt' | 'createdAt'>;

/** When the trial ends: the stored date, or 7 days after sign-up for accounts made before M6. */
export function trialEndsAt(p: Facts): number {
  return p.trialEndsAt ?? p.createdAt + TRIAL_MS;
}

/**
 * A subscription counts until its paid period ends: `active` and `past_due` (the provider is still
 * retrying the payment) and `canceled` (paid up to the end of the period) all hold access until
 * `subExpiresAt`.
 */
export function subscribed(p: Facts, now: number): boolean {
  const live = p.subStatus === 'active' || p.subStatus === 'past_due' || p.subStatus === 'canceled';
  return live && p.subExpiresAt !== null && now < p.subExpiresAt;
}

export function access(p: Facts, now: number): Access {
  if (subscribed(p, now)) return 'subscriber';
  return now < trialEndsAt(p) ? 'trial' : 'expired';
}

/** Online play (the world, battles, queues): trial or subscription. */
export function canPlay(p: Facts, now: number): boolean {
  return access(p, now) !== 'expired';
}

/** Trading and item wagers: paying subscribers only (14.4, 9.5). */
export function canTrade(p: Facts, now: number): boolean {
  return access(p, now) === 'subscriber';
}
