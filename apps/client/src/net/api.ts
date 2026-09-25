/**
 * REST client for the Worker (ARCHITECTURE 6). Same-origin requests carry the HttpOnly session
 * cookie automatically; the client never sees or stores the session token (R-SEC-006).
 */
import type { BattleTicket, LoadoutBody } from '@chain-theorem/protocol';
import type { FormatId, Loadout, LoadoutError } from '@chain-theorem/rules';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
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
    throw new ApiError(res.status, code);
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
}

export interface ServerLoadout {
  id: string;
  name: string;
  loadout: Loadout;
  valid: boolean;
  errors: LoadoutError[];
}

export type VerifyAnswer =
  { status: 'signed_in'; me: Me } | { status: 'needs_profile'; signup: string };

export const api = {
  me: () => call<Me>('GET', '/api/me'),
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
};

/** Absolute WebSocket URL for a server-relative socket path. */
export function wsUrl(path: string): string {
  if (/^wss?:\/\//.test(path)) return path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
