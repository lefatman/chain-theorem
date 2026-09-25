/**
 * REST client for the Worker (ARCHITECTURE 6). Same-origin requests carry the HttpOnly session
 * cookie automatically; the client never sees or stores the session token (R-SEC-006).
 */
import type {
  AccessView,
  BattleTicket,
  BillingPlans,
  LoadoutBody,
  PlanId,
  ReportBody,
  SafetyLists,
  SubscriptionView,
  TradeAccess,
  TradeMode,
  TradeTicket,
  WorldTicket,
} from '@chain-theorem/protocol';
import type { FormatId, Loadout, LoadoutError } from '@chain-theorem/rules';
import type {
  Bracket,
  GuildLeaderboard,
  GuildRank,
  Leaderboard,
  MyGuild,
  MyRatings,
  RankedTicket,
} from '@chain-theorem/protocol';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The error body's other fields (e.g. a suspension's `until` and data token). */
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Called when the server refuses online play because the trial or subscription ended (402). */
let subscriptionRequired: (() => void) | null = null;
export function onSubscriptionRequired(fn: (() => void) | null): void {
  subscriptionRequired = fn;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON (static hosting without the server) */
  }
  if (!res.ok) {
    // A non-JSON error (static hosting, a dev proxy with no Worker behind it) means no API server.
    const code = data === null ? 'no_server' : ((data as { error?: string }).error ?? 'error');
    if (res.status === 402 && code === 'subscription_required') subscriptionRequired?.();
    throw new ApiError(
      res.status,
      code,
      data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    );
  }
  if (data === null) throw new ApiError(res.status, 'no_server');
  return data as T;
}

export interface Me {
  id: string;
  name: string;
  level: number;
  xp: number;
  adult: boolean;
  /** Trial or subscription, decided on the server (M6 6.3, R-SEC-007). */
  access: AccessView;
}

export interface ServerLoadout {
  id: string;
  name: string;
  loadout: Loadout;
  valid: boolean;
  errors: LoadoutError[];
}

/** A friend or a pending friend request (10.4); `zone` is where they are, null when offline. */
export interface Friend {
  id: string;
  name: string;
  status: 'friends' | 'incoming' | 'outgoing';
  zone: string | null;
}

/** The player's progress for the world HUD (`GET /api/progress`). */
export interface Progress {
  level: number;
  xp: number;
  xpToNext: number;
  coins: number;
  keyItems: string[];
  quests: { id: string; step: number; done: boolean }[];
  lessonsDone: string[];
}

export type VerifyAnswer =
  { status: 'signed_in'; me: Me } | { status: 'needs_profile'; signup: string };

export const api = {
  me: () => call<{ me: Me | null }>('GET', '/api/me'),
  providers: () => call<{ providers: string[] }>('GET', '/api/auth/providers'),
  startSignIn: (email: string) => call<{ ok: true }>('POST', '/api/auth/start', { email }),
  verify: (token: string) => call<VerifyAnswer>('POST', '/api/auth/verify', { token }),
  complete: (signup: string, name: string, dob: string) =>
    call<{ status: 'signed_in'; me: Me }>('POST', '/api/auth/complete', { signup, name, dob }),
  signOut: () => call<void>('POST', '/api/auth/signout'),
  inventory: () =>
    call<{ items: { id: string; qty: number }[]; cards: { id: string; qty: number }[] }>(
      'GET',
      '/api/inventory',
    ),
  loadouts: () => call<{ loadouts: ServerLoadout[] }>('GET', '/api/loadouts'),
  saveLoadout: (name: string, loadout: LoadoutBody, id?: string) =>
    call<ServerLoadout>('PUT', '/api/loadouts', id ? { id, name, loadout } : { name, loadout }),
  deleteLoadout: (id: string) => call<void>('DELETE', `/api/loadouts/${encodeURIComponent(id)}`),
  npcBattle: (format: FormatId, loadoutId: string, tier: 'wild' | 'trainer' | 'elite') =>
    call<BattleTicket>('POST', '/api/battles', { kind: 'npc', format, loadoutId, tier }),
  challenge: (format: FormatId, loadoutId: string) =>
    call<{ code: string; url: string; ticket: BattleTicket }>('POST', '/api/battles', {
      kind: 'challenge',
      format,
      loadoutId,
    }),
  challengeInfo: (code: string) =>
    call<{ format: FormatId; from: { name: string; level: number }; open: boolean }>(
      'GET',
      `/api/challenges/${encodeURIComponent(code)}`,
    ),
  acceptChallenge: (code: string, loadoutId: string) =>
    call<BattleTicket>('POST', `/api/challenges/${encodeURIComponent(code)}/accept`, { loadoutId }),
  queueTicket: (format: FormatId, loadoutId: string) =>
    call<{ url: string }>('POST', '/api/queue/ticket', { format, loadoutId }),
  battleTicket: (battleId: string) =>
    call<BattleTicket>('POST', `/api/battles/${encodeURIComponent(battleId)}/ticket`),
  activeBattles: () =>
    call<{ battles: { id: string; format: FormatId; opponent: string }[] }>(
      'GET',
      '/api/battles/active',
    ),
  // M5 overworld (ARCHITECTURE 6).
  worldTicket: () => call<WorldTicket>('POST', '/api/world/ticket'),
  friends: () => call<{ friends: Friend[] }>('GET', '/api/friends'),
  addFriend: (to: string) =>
    call<{ status: 'requested' | 'friends' }>('POST', '/api/friends', { to }),
  removeFriend: (id: string) => call<void>('DELETE', `/api/friends/${encodeURIComponent(id)}`),
  progress: () => call<Progress>('GET', '/api/progress'),
  // M6 6.1 trades and item wagers (10.4, 9.5; subscribers only, 14.4).
  tradeAccess: () => call<TradeAccess>('GET', '/api/trades/access'),
  startTrade: (to: string, mode: TradeMode, format?: FormatId) =>
    call<TradeTicket>('POST', '/api/trades', { with: to, mode, ...(format ? { format } : {}) }),
  tradeTicket: (id: string) =>
    call<TradeTicket>('POST', `/api/trades/${encodeURIComponent(id)}/ticket`),
  declineTrade: (id: string) => call<void>('POST', `/api/trades/${encodeURIComponent(id)}/decline`),
  // M6 6.3 billing (ARCHITECTURE 6).
  billingPlans: () => call<BillingPlans>('GET', '/api/billing/plans'),
  subscription: () => call<SubscriptionView>('GET', '/api/billing/subscription'),
  checkout: (plan: PlanId) => call<{ url: string }>('POST', '/api/billing/checkout', { plan }),
  cancelSubscription: () => call<SubscriptionView>('POST', '/api/billing/cancel'),
  resumeSubscription: () => call<SubscriptionView>('POST', '/api/billing/resume'),
  billingPortal: () => call<{ url: string }>('POST', '/api/billing/portal'),
  deleteAccount: () => call<void>('DELETE', '/api/me'),
  /** R-SEC-010 for a suspended account: delete with the token its refused sign-in gave. */
  deleteWithDataToken: (data: string) =>
    call<void>('DELETE', `/api/me?data=${encodeURIComponent(data)}`),
  // M6 6.2 ranked queues and 6.1 leaderboards and guilds (9.3, 10.4).
  rankedTicket: (format: FormatId, loadoutId: string) =>
    call<RankedTicket>('POST', '/api/ranked/ticket', { format, loadoutId }),
  myRatings: () => call<MyRatings>('GET', '/api/ratings/me'),
  leaderboard: (format: FormatId, bracket: Bracket) =>
    call<Leaderboard>('GET', `/api/leaderboards?${new URLSearchParams({ format, bracket })}`),
  guildLeaderboard: (format: FormatId, bracket: Bracket) =>
    call<GuildLeaderboard>(
      'GET',
      `/api/leaderboards/guilds?${new URLSearchParams({ format, bracket })}`,
    ),
  myGuild: () => call<MyGuild>('GET', '/api/guilds/me'),
  createGuild: (name: string, tag: string) => call<MyGuild>('POST', '/api/guilds', { name, tag }),
  guildInvite: (to: string) => call<MyGuild>('POST', '/api/guilds/invites', { to }),
  acceptGuildInvite: (guildId: string) =>
    call<MyGuild>('POST', `/api/guilds/invites/${encodeURIComponent(guildId)}/accept`),
  declineGuildInvite: (guildId: string) =>
    call<MyGuild>('DELETE', `/api/guilds/invites/${encodeURIComponent(guildId)}`),
  revokeGuildInvite: (guildId: string, playerId: string) =>
    call<MyGuild>(
      'DELETE',
      `/api/guilds/invites/${encodeURIComponent(guildId)}/${encodeURIComponent(playerId)}`,
    ),
  setGuildRank: (playerId: string, rank: GuildRank) =>
    call<MyGuild>('PUT', `/api/guilds/members/${encodeURIComponent(playerId)}`, { rank }),
  kickFromGuild: (playerId: string) =>
    call<MyGuild>('DELETE', `/api/guilds/members/${encodeURIComponent(playerId)}`),
  leaveGuild: () => call<MyGuild>('POST', '/api/guilds/leave'),
  disbandGuild: (guildId: string) =>
    call<MyGuild>('DELETE', `/api/guilds/${encodeURIComponent(guildId)}`),
  // M6 6.4 report, mute and block (R-SEC-011: available to everyone).
  safety: () => call<SafetyLists>('GET', '/api/safety'),
  mute: (id: string) => call<SafetyLists>('POST', '/api/mutes', { id }),
  unmute: (id: string) => call<SafetyLists>('DELETE', `/api/mutes/${encodeURIComponent(id)}`),
  block: (id: string) => call<SafetyLists>('POST', '/api/blocks', { id }),
  unblock: (id: string) => call<SafetyLists>('DELETE', `/api/blocks/${encodeURIComponent(id)}`),
  report: (body: ReportBody) => call<{ id: string }>('POST', '/api/reports', body),
};

/** Absolute WebSocket URL for a server-relative socket path. */
export function wsUrl(path: string): string {
  if (/^wss?:\/\//.test(path)) return path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
