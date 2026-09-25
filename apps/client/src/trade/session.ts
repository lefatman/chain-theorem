/**
 * The open trade or wager window (M6 6.1) and the player's trading access (14.4). A wager that both
 * players confirmed hands over to the battle screen like any world battle; its result panel then
 * offers "Return to the world".
 */
import { signal } from '@preact/signals';
import type { TradeAccess, TradeTicket } from '@chain-theorem/protocol';
import { go } from '../app/router.ts';
import { ApiError, api, wsUrl } from '../net/api.ts';
import { startOnlineBattle } from '../ui/battleSession.ts';
import { worldBattle } from '../world/session.ts';
import { TradeController, type TradeDone } from './controller.ts';

/** The trade window's session (one at a time). */
export const activeTrade = signal<TradeController | null>(null);

/** Whether this account may trade and wager (null until loaded). */
export const tradeAccess = signal<TradeAccess | null>(null);

export async function loadTradeAccess(): Promise<void> {
  try {
    tradeAccess.value = await api.tradeAccess();
  } catch {
    tradeAccess.value = null;
  }
}

/** Why the Trade and Wager buttons are off, as text (null when they are on). */
export function accessReason(a: TradeAccess | null): string | null {
  if (!a) return 'Checking whether you can trade…';
  if (a.allowed) return null;
  return a.reason === 'trial'
    ? 'Trading and wagers are for subscribers: free-trial accounts cannot trade or wager.'
    : 'Trading and wagers need an active subscription.';
}

/** Open the window for a ticket (a new invitation, or accepting one). */
export function openTrade(t: TradeTicket): TradeController {
  activeTrade.value?.dispose();
  const c = new TradeController({
    id: t.id,
    mode: t.mode,
    url: t.url,
    ticket: () => api.tradeTicket(t.id),
    socketUrl: wsUrl,
  });
  activeTrade.value = c;
  return c;
}

export function closeTrade(): void {
  activeTrade.value?.dispose();
  activeTrade.value = null;
}

/** Both confirmed a wager: open its battle (the ticket came with the result, R-SEC-006). */
export function startWagerBattle(done: Extract<TradeDone, { mode: 'wager' }>): void {
  const battle = startOnlineBattle(done.battleId, {
    battleId: done.battleId,
    token: '',
    url: done.url,
  });
  worldBattle.value = battle;
  closeTrade();
  go('battle');
}

/** Friendly text for REST errors of the trade routes. */
export function tradeApiError(e: unknown, name: string): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    trial_account: 'Free-trial accounts cannot trade or wager.',
    no_subscription: 'Trading and wagers need an active subscription.',
    partner_cannot_trade: `${name} cannot trade or wager right now (subscribers only).`,
    not_online: `${name} is not in the world any more.`,
    not_found: 'That trade is no longer open.',
    closed: 'That invitation has expired or was withdrawn.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}
