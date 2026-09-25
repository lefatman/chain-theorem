/**
 * Webhook signatures (R-SEC-007) in Paddle Billing's scheme, used by both providers so the local fake
 * provider exercises the production verification path:
 *
 *   Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>" with the secret>
 *
 * The raw body is verified before it is parsed. Several `h1` values may appear while a secret is
 * being rotated; any match passes. The comparison is constant-time (`crypto.subtle.verify`), and a
 * timestamp more than 5 minutes away from now is rejected so a captured delivery cannot be replayed
 * later (a replay inside the window is stopped by the event-id idempotency in the database).
 */
export const SIGNATURE_HEADER = 'paddle-signature';
export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export type SignatureCheck =
  { ok: true; ts: number } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keys.set(secret, k);
  }
  return k;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The hex HMAC-SHA256 of `<ts>:<body>`. */
export async function signatureHex(
  secret: string,
  tsSeconds: number,
  body: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    enc.encode(`${tsSeconds}:${body}`),
  );
  return toHex(new Uint8Array(sig));
}

/** The header value for `body` signed at `nowMs` (the fake provider and tests sign with this). */
export async function signBody(secret: string, body: string, nowMs: number): Promise<string> {
  const ts = Math.floor(nowMs / 1000);
  return `ts=${ts};h1=${await signatureHex(secret, ts, body)}`;
}

/** Checks a `Paddle-Signature` header against the raw body. */
export async function verifySignature(
  header: string | null,
  body: string,
  secret: string,
  nowMs: number,
  toleranceMs = SIGNATURE_TOLERANCE_MS,
): Promise<SignatureCheck> {
  if (!header) return { ok: false, reason: 'missing' };
  if (header.length > 1024) return { ok: false, reason: 'malformed' };
  let ts: number | null = null;
  const sigs: Uint8Array[] = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) return { ok: false, reason: 'malformed' };
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'ts') {
      if (!/^\d{1,12}$/.test(v) || ts !== null) return { ok: false, reason: 'malformed' };
      ts = Number(v);
    } else if (k === 'h1') {
      const raw = fromHex(v);
      if (!raw) return { ok: false, reason: 'malformed' };
      sigs.push(raw);
    }
    // Unknown keys (future schemes) are ignored.
  }
  if (ts === null || sigs.length === 0 || sigs.length > 4)
    return { ok: false, reason: 'malformed' };
  if (Math.abs(nowMs - ts * 1000) > toleranceMs) return { ok: false, reason: 'stale' };
  const k = await key(secret);
  const data = enc.encode(`${ts}:${body}`);
  let match = false;
  // Check every candidate (no early exit), each in constant time.
  for (const sig of sigs) {
    if (await crypto.subtle.verify('HMAC', k, sig, data)) match = true;
  }
  return match ? { ok: true, ts } : { ok: false, reason: 'mismatch' };
}
