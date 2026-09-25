/**
 * WebSocket tickets (R-SEC-006): a WebSocket upgrade needs a 60-second signed token bound to the
 * player and the room. Issued by an authenticated REST call, checked by the Worker before the upgrade
 * reaches a Durable Object.
 */
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.ts';

export const TICKET_TTL_MS = 60_000;

export interface Ticket {
  /** Player id. */
  p: string;
  /** Room: `battle:<id>` or `zone:<id>`. */
  r: string;
  /** Expiry, epoch ms. */
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function signTicket(
  secret: string,
  player: string,
  room: string,
  now: number,
): Promise<string> {
  const body = base64url(
    enc.encode(JSON.stringify({ p: player, r: room, exp: now + TICKET_TTL_MS })),
  );
  return `${body}.${await hmac(secret, `ticket.${body}`)}`;
}

/** The ticket's player when it is authentic, unexpired and for `room`; otherwise null. */
export async function verifyTicket(
  secret: string,
  token: string,
  room: string,
  now: number,
): Promise<string | null> {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || token.length > 1024) return null;
  if (!(await hmacVerify(secret, `ticket.${body}`, sig))) return null;
  const raw = fromBase64url(body);
  if (!raw) return null;
  let t: unknown;
  try {
    t = JSON.parse(dec.decode(raw));
  } catch {
    return null;
  }
  const v = t as Partial<Ticket>;
  if (typeof v.p !== 'string' || typeof v.r !== 'string' || typeof v.exp !== 'number') return null;
  if (v.r !== room || now > v.exp) return null;
  return v.p;
}
