/**
 * Small WebCrypto helpers shared by sessions, magic links and socket tickets. Web-standard APIs only
 * (they run in Workers and in Node 22 tests).
 */
const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  try {
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    // Only the canonical encoding: unused trailing bits must be zero, so a signature has one spelling.
    return base64url(out) === s ? out : null;
  } catch {
    return null;
  }
}

/** A random URL-safe token with `bytes` bytes of entropy (32 = 256 bits). */
export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return base64url(new Uint8Array(digest));
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
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

export async function hmac(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return base64url(new Uint8Array(sig));
}

/** Constant-time check of an HMAC signature (crypto.subtle.verify compares in constant time). */
export async function hmacVerify(secret: string, data: string, sig: string): Promise<boolean> {
  const raw = fromBase64url(sig);
  if (!raw) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), raw, enc.encode(data));
}
