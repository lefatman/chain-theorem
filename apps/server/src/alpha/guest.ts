/**
 * Alpha guest play (spec 9.6, R-FMT-007; DD-107). A guest is a signed, 24-hour identity carried in
 * an HttpOnly cookie: id `g-NNNN-<ten random characters>`, shown as "Guest NNNN". Guests exist only
 * for the alpha routes (`/api/alpha/*`) and the battle sockets of alpha battles (`a-<code>`); every
 * other route sees them as signed out, and nothing they do is recorded. The Worker variable
 * `ALPHA_GUEST_PLAY=on` enables the mode; production leaves it unset.
 */
import { randomToken } from '../auth/crypto.ts';
import { signTicket, verifyTicket } from '../auth/tickets.ts';
import type { Env } from '../env.ts';

export const GUEST_TTL_MS = 24 * 3600 * 1000;
/** The ticket room of a guest token (tickets are bound to a room, R-SEC-006). */
export const GUEST_ROOM = 'alpha:guest';
/** An alpha lobby nobody joined closes after this long (DD-107). */
export const ALPHA_LOBBY_TTL_MS = 30 * 60_000;
/** Guest creations allowed per address per window (counted per Worker isolate, best effort). */
export const GUESTS_PER_WINDOW = 10;
export const GUEST_WINDOW_MS = 10 * 60_000;

export function alphaEnabled(env: Pick<Env, 'ALPHA_GUEST_PLAY'>): boolean {
  return env.ALPHA_GUEST_PLAY === 'on';
}

/** Host-only like the session cookie (`__Host-` needs HTTPS, which local development lacks). */
export function alphaCookieName(secure: boolean): string {
  return secure ? '__Host-ct_alpha' : 'ct_alpha';
}

export function isGuestId(id: string): boolean {
  return /^g-\d{4}-[A-Za-z0-9]{6,16}$/.test(id);
}

export function isAlphaBattleId(id: string): boolean {
  return /^a-[A-Za-z0-9]{6,16}$/.test(id);
}

/** The display name a guest id carries: its four digits. */
export function guestName(id: string): string {
  const m = /^g-(\d{4})-/.exec(id);
  return m ? `Guest ${m[1]}` : 'Guest';
}

/** A new guest id: four digits for the name and ten characters of entropy, both from the CSPRNG. */
export function newGuestId(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const b = random(2);
  const digits = String((((b[0] ?? 0) << 8) | (b[1] ?? 0)) % 10_000).padStart(4, '0');
  return `g-${digits}-${randomToken(8).replace(/[-_]/g, 'x').slice(0, 10)}`;
}

export function signGuest(secret: string, id: string, now: number): Promise<string> {
  return signTicket(secret, id, GUEST_ROOM, now, GUEST_TTL_MS);
}

/** The guest id of an authentic, unexpired guest token; null otherwise. */
export async function verifyGuest(
  secret: string,
  token: string,
  now: number,
): Promise<string | null> {
  const id = await verifyTicket(secret, token, GUEST_ROOM, now);
  return id !== null && isGuestId(id) ? id : null;
}

/**
 * Sliding-window hit counter per key, pure given `now` so tests drive the clock. One instance lives
 * per Worker isolate: enough to stop a script from minting guests in a loop, not a global quota.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a hit at `now` and says whether it was within the limit. */
  hit(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // Bound memory in a long-lived isolate: forget everyone once the table grows large.
    if (this.hits.size > 10_000) this.hits.clear();
    this.hits.set(key, recent);
    return true;
  }
}
