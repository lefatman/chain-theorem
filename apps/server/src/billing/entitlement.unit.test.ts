/** Entitlement rules (R-COST-005, R-SEC-007, R-FMT-006): trial, subscription, expiry. */
import { describe, expect, it } from 'vitest';
import { TRIAL_MS, access, canPlay, canTrade, trialEndsAt } from './entitlement.ts';

const T0 = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const fresh = {
  subStatus: 'none',
  subExpiresAt: null,
  trialEndsAt: T0 + TRIAL_MS,
  createdAt: T0,
};

describe('entitlement (R-COST-005)', () => {
  it('R-COST-005 a new account plays for 7 days on the trial but cannot trade or wager', () => {
    expect(access(fresh, T0 + DAY)).toBe('trial');
    expect(canPlay(fresh, T0 + 6 * DAY)).toBe(true);
    expect(canTrade(fresh, T0 + DAY)).toBe(false);
    expect(access(fresh, T0 + TRIAL_MS)).toBe('expired');
    expect(canPlay(fresh, T0 + TRIAL_MS + 1)).toBe(false);
  });

  it('R-COST-005 accounts from before M6 get their trial from the sign-up date', () => {
    const old = { ...fresh, trialEndsAt: null };
    expect(trialEndsAt(old)).toBe(T0 + TRIAL_MS);
  });

  it('R-SEC-007 R-FMT-006 a subscription unlocks play and trading until its paid period ends', () => {
    for (const subStatus of ['active', 'past_due', 'canceled']) {
      const p = { ...fresh, subStatus, subExpiresAt: T0 + 40 * DAY };
      expect(access(p, T0 + 30 * DAY)).toBe('subscriber');
      expect(canTrade(p, T0 + DAY)).toBe(true);
      expect(access(p, T0 + 40 * DAY)).toBe('expired');
    }
    const paused = { ...fresh, subStatus: 'paused', subExpiresAt: T0 + 40 * DAY };
    expect(access(paused, T0 + 30 * DAY)).toBe('expired');
    expect(access({ ...fresh, subStatus: 'active' }, T0 + DAY)).toBe('trial');
  });
});
