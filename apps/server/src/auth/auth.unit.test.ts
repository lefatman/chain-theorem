/** Auth building blocks: socket tickets, cookies, sign-up age, OAuth state (R-SEC-006, R-SEC-011, DD-06). */
import { describe, expect, it } from 'vitest';
import { checkAge, minimumAge } from './age.ts';
import { parseCookies, serializeCookie, sessionCookieName } from './cookies.ts';
import { base64url, fromBase64url, randomToken, sha256 } from './crypto.ts';
import { ConsoleMailSender, magicLinkMail } from './mail.ts';
import { PROVIDERS, checkState, startOAuth } from './oauth.ts';
import { TICKET_TTL_MS, signTicket, verifyTicket } from './tickets.ts';

const SECRET = 'test-secret-with-enough-entropy-0123456789';

describe('socket tickets (R-SEC-006)', () => {
  it('R-SEC-006 a ticket is bound to its player and room and lasts 60 seconds', async () => {
    const t = await signTicket(SECRET, 'player-1', 'battle:abc', 1000);
    expect(await verifyTicket(SECRET, t, 'battle:abc', 1000)).toBe('player-1');
    expect(await verifyTicket(SECRET, t, 'battle:abc', 1000 + TICKET_TTL_MS)).toBe('player-1');
    expect(await verifyTicket(SECRET, t, 'battle:abc', 1001 + TICKET_TTL_MS)).toBeNull();
    expect(await verifyTicket(SECRET, t, 'battle:other', 1000)).toBeNull();
    expect(await verifyTicket('another-secret', t, 'battle:abc', 1000)).toBeNull();
  });

  it('R-SEC-006 tampered, truncated or garbage tickets are rejected', async () => {
    const t = await signTicket(SECRET, 'player-1', 'battle:abc', 1000);
    const [body, sig] = t.split('.') as [string, string];
    const forged = base64url(
      new TextEncoder().encode(JSON.stringify({ p: 'player-2', r: 'battle:abc', exp: 9e15 })),
    );
    for (const bad of [
      `${forged}.${sig}`,
      body,
      `${body}.`,
      `${body}.${sig}.x`,
      'x'.repeat(2000),
      '',
      '..',
    ]) {
      expect(await verifyTicket(SECRET, bad, 'battle:abc', 1000)).toBeNull();
    }
  });
});

describe('session cookies (R-SEC-006)', () => {
  it('R-SEC-006 session cookies are HttpOnly, SameSite and Secure over HTTPS', () => {
    const c = serializeCookie(sessionCookieName(true), 'tok', { maxAgeMs: 60_000, secure: true });
    expect(c).toBe('__Host-ct_session=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure');
    expect(serializeCookie('ct_session', 'x', { maxAgeMs: 0, secure: false })).not.toContain(
      'Secure',
    );
  });

  it('R-SEC-006 parses cookie headers, first value wins', () => {
    const m = parseCookies('a=1; ct_session=abc; a=2; junk; =x');
    expect(m.get('a')).toBe('1');
    expect(m.get('ct_session')).toBe('abc');
    expect(parseCookies(null).size).toBe(0);
  });
});

describe('crypto helpers', () => {
  it('base64url round-trips and random tokens carry 256 bits', async () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 1, 2, 3]);
    expect(fromBase64url(base64url(bytes))).toEqual(bytes);
    expect(fromBase64url('not base64!')).toBeNull();
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(await sha256('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});

describe('sign-up age (DD-06, R-SEC-011)', () => {
  const now = Date.UTC(2026, 8, 25);
  it('DD-06 the minimum is 13, or the local age of digital consent where higher', () => {
    expect(minimumAge(null)).toBe(13);
    expect(minimumAge('US')).toBe(13);
    expect(minimumAge('de')).toBe(16);
    expect(minimumAge('FR')).toBe(15);
    expect(checkAge('2013-09-25', now, 'US')).toEqual({
      ok: true,
      adultFrom: Date.UTC(2031, 8, 25),
    });
    expect(checkAge('2013-09-26', now, 'US')).toEqual({ ok: false, reason: 'too_young' });
    expect(checkAge('2011-01-01', now, 'DE')).toEqual({ ok: false, reason: 'too_young' });
  });

  it('R-SEC-011 only adult_from is derived; bad and future dates are rejected', () => {
    expect(checkAge('2008-02-29', now, null)).toEqual({
      ok: true,
      adultFrom: Date.UTC(2026, 2, 1),
    });
    expect(checkAge('2010-02-30', now, null)).toEqual({ ok: false, reason: 'bad_date' });
    expect(checkAge('1850-01-01', now, null)).toEqual({ ok: false, reason: 'bad_date' });
    expect(checkAge('2030-01-01', now, null)).toEqual({ ok: false, reason: 'future' });
  });
});

describe('magic links and OAuth', () => {
  it('prints the magic link locally instead of sending mail', async () => {
    const m = new ConsoleMailSender();
    const log = console.log;
    console.log = () => undefined;
    await m.send(magicLinkMail('ada@example.com', 'http://localhost/auth?t=x', 15));
    console.log = log;
    expect(m.sent[0]?.text).toContain('http://localhost/auth?t=x');
  });

  it('R-SEC-006 OAuth state is signed, expires, and must match the browser cookie', async () => {
    const p = PROVIDERS.github;
    const { url, cookie } = await startOAuth(
      p,
      { clientId: 'cid', clientSecret: 's' },
      'http://x/cb',
      SECRET,
      0,
    );
    const q = new URL(url).searchParams;
    expect(q.get('code_challenge_method')).toBe('S256');
    const state = q.get('state') ?? '';
    const verifier = cookie.split('.')[1];
    expect(await checkState(p, state, cookie, SECRET, 1000)).toBe(verifier);
    expect(await sha256(verifier ?? '')).toBe(q.get('code_challenge'));
    expect(await checkState(p, state, 'other.cookie', SECRET, 1000)).toBeNull();
    expect(await checkState(PROVIDERS.google, state, cookie, SECRET, 1000)).toBeNull();
    expect(await checkState(p, state, cookie, SECRET, 11 * 60_000)).toBeNull();
    const flipped = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A');
    expect(await checkState(p, flipped, cookie, SECRET, 1000)).toBeNull();
  });
});
