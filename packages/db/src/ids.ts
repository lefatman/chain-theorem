/**
 * Ids and secrets. Uses Web Crypto (`globalThis.crypto`), which Node 22 and Workers both provide, so
 * this module is safe in the Worker bundle.
 *
 * UUIDv7 (RFC 9562): 48-bit Unix epoch milliseconds, version 7, 12-bit rand_a used as a monotonic
 * sequence within one millisecond (method 1 of RFC 9562 6.2), variant 10, 62 random bits. Ids made
 * by one process are strictly increasing, so they sort by creation time (spec 13.6).
 */

let lastMs = -1;
let seq = 0;

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A new UUIDv7 string. `now` is epoch milliseconds (defaults to the clock). */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = Math.max(0, Math.floor(now));
  if (ms > lastMs) {
    lastMs = ms;
    // Random start with the top bit clear leaves at least 2048 increments before rollover.
    seq = ((bytes[6]! & 0x07) << 8) | bytes[7]!;
  } else {
    // Same millisecond (or the clock went back): keep the last timestamp and count up.
    seq++;
    if (seq > 0xfff) {
      lastMs++;
      seq = 0;
    }
    ms = lastMs;
  }
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The epoch-millisecond timestamp encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/** A random URL-safe token of `bytes` random bytes (base64url, no padding). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lower-case hex SHA-256 of a UTF-8 string. Only token hashes are stored (R-SEC-006). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}
