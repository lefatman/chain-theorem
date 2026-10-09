/** Alpha guest identities and the guest-creation limiter (spec 9.6, R-FMT-007, DD-107). */
import { describe, expect, it } from 'vitest';
import {
  GUEST_TTL_MS,
  WindowLimiter,
  alphaCookieName,
  alphaEnabled,
  guestName,
  isAlphaBattleId,
  isGuestId,
  newGuestId,
  signGuest,
  verifyGuest,
} from './guest.ts';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef';

describe('alpha guests (9.6, R-FMT-007, DD-107)', () => {
  it('R-FMT-007 the mode is on only when ALPHA_GUEST_PLAY is exactly "on"', () => {
    expect(alphaEnabled({ ALPHA_GUEST_PLAY: 'on' })).toBe(true);
    expect(alphaEnabled({ ALPHA_GUEST_PLAY: 'true' })).toBe(false);
    expect(alphaEnabled({ ALPHA_GUEST_PLAY: undefined })).toBe(false);
    expect(alphaEnabled({})).toBe(false);
  });

  it('R-FMT-007 a guest id carries four digits for its name and ten random characters, and is told apart from player ids', () => {
    const id = newGuestId(() => new Uint8Array([0x30, 0x39]));
    expect(id).toMatch(/^g-2345-[A-Za-z0-9]{10}$/);
    expect(guestName(id)).toBe('Guest 2345');
    expect(isGuestId(id)).toBe(true);
    expect(newGuestId(() => new Uint8Array([0xff, 0xff]))).toMatch(/^g-5535-/);
    for (const bad of ['01J0ABCDEF', 'g-12-abcdef', 'g-1234', 'g-1234-x', 'G-1234-abcdefghij'])
      expect(isGuestId(bad), bad).toBe(false);
    expect(guestName('01J0ABCDEF')).toBe('Guest');
    // Two draws differ in their random part.
    expect(newGuestId(() => new Uint8Array([0, 7]))).not.toBe(
      newGuestId(() => new Uint8Array([0, 7])),
    );
  });

  it('R-FMT-007 alpha battle ids are a-<code>; challenge links (c-) and uuids are not', () => {
    expect(isAlphaBattleId('a-Ab12Cd34Ef')).toBe(true);
    expect(isAlphaBattleId('c-Ab12Cd34Ef')).toBe(false);
    expect(isAlphaBattleId('a-x')).toBe(false);
    expect(isAlphaBattleId(crypto.randomUUID())).toBe(false);
  });

  it('R-SEC-006 R-FMT-007 a guest token is a 24-hour ticket for the guest room: it verifies until it expires and never as another room or id', async () => {
    const id = newGuestId();
    const now = 1_700_000_000_000;
    const token = await signGuest(SECRET, id, now);
    expect(await verifyGuest(SECRET, token, now + GUEST_TTL_MS - 1)).toBe(id);
    expect(await verifyGuest(SECRET, token, now + GUEST_TTL_MS + 1)).toBeNull();
    expect(
      await verifyGuest('other-secret-0123456789abcdef0123456789abcdef', token, now),
    ).toBeNull();
    expect(await verifyGuest(SECRET, `${token}x`, now)).toBeNull();
    // A ticket for a player id in the guest room is refused: only guest ids live there.
    const { signTicket } = await import('../auth/tickets.ts');
    const forged = await signTicket(SECRET, '01J0PLAYER', 'alpha:guest', now, GUEST_TTL_MS);
    expect(await verifyGuest(SECRET, forged, now)).toBeNull();
  });

  it('R-FMT-007 the guest limiter allows `limit` hits per key per window and forgets old ones', () => {
    const l = new WindowLimiter(3, 1000);
    expect(l.hit('ip1', 0)).toBe(true);
    expect(l.hit('ip1', 100)).toBe(true);
    expect(l.hit('ip1', 200)).toBe(true);
    expect(l.hit('ip1', 300)).toBe(false);
    expect(l.hit('ip2', 300)).toBe(true);
    // The first hit leaves the window at t=1000.
    expect(l.hit('ip1', 1001)).toBe(true);
    expect(l.hit('ip1', 1002)).toBe(false);
  });

  it('R-SEC-006 the alpha cookie is host-only over HTTPS like the session cookie', () => {
    expect(alphaCookieName(true)).toBe('__Host-ct_alpha');
    expect(alphaCookieName(false)).toBe('ct_alpha');
  });
});
