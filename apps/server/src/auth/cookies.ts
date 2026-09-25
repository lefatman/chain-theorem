/**
 * Session cookies (R-SEC-006): HttpOnly, Secure, SameSite=Lax, host-only (`__Host-` prefix when
 * served over HTTPS). Local development over plain http drops `Secure` and the prefix, which
 * browsers require.
 */
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-ct_session' : 'ct_session';
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeMs: number; secure: boolean; path?: string },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeMs / 1000))}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !out.has(k)) out.set(k, v);
  }
  return out;
}
