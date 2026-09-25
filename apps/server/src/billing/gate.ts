/**
 * Entitlement gates (14.4, R-COST-005, R-SEC-007). Online play (the world, NPC and PvP battles,
 * challenge links, queues) needs the trial or a subscription; an expired account can still sign in,
 * see its account, export or delete its data and subscribe. Refusals are `402
 * { error: 'subscription_required' }`. Battles already started may be finished (rejoin tickets are
 * not gated).
 */
import type { Player } from '@chain-theorem/db';
import type { Ctx } from '../api/context.ts';
import { HttpError, json } from '../http.ts';
import { canPlay } from './entitlement.ts';

export const SUBSCRIPTION_REQUIRED = 'subscription_required';

/** The signed-in player when they may play online; 401 signed out, 402 when the trial has ended. */
export async function requirePlay(ctx: Ctx): Promise<Player> {
  const me = await ctx.requireMe();
  if (!canPlay(me, ctx.now)) throw new HttpError(402, SUBSCRIPTION_REQUIRED);
  return me;
}

/** The same check at a socket upgrade (tickets live 60 s; entitlement is re-read at connect). */
export function refusePlay(p: Player, now: number): Response | null {
  return canPlay(p, now) ? null : json({ error: SUBSCRIPTION_REQUIRED }, 402);
}
