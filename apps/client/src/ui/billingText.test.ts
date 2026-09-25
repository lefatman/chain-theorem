/** Account and plan wording (M6 6.3; R-COST-005, R-COST-004). */
import type { AccessView } from '@chain-theorem/protocol';
import { describe, expect, it } from 'vitest';
import { accessText, daysLeft, lockedTitle, perMonthText, priceText } from './billingText.ts';

const NOW = Date.UTC(2026, 8, 25, 12);
const DAY = 24 * 60 * 60 * 1000;
const base: AccessView = {
  status: 'trial',
  subStatus: 'none',
  trialEndsAt: NOW + 7 * DAY,
  subExpiresAt: null,
  canPlay: true,
  canTrade: false,
};

describe('billing text', () => {
  it('R-COST-005 the trial shows the days left; an ended trial says so plainly', () => {
    expect(daysLeft(NOW + 7 * DAY, NOW)).toBe(7);
    expect(daysLeft(NOW + 1, NOW)).toBe(1);
    expect(daysLeft(NOW - DAY, NOW)).toBe(0);
    expect(accessText(base, NOW).text).toMatch(/^Free trial: 7 days left/);
    expect(accessText(base, NOW).text).toContain('trading and wagers need a subscription');
    expect(accessText({ ...base, trialEndsAt: NOW + DAY }, NOW)).toMatchObject({ tone: 'warn' });
    expect(accessText({ ...base, trialEndsAt: NOW + 1 }, NOW).text).toMatch(/1 day left/);
    const ended = { ...base, status: 'expired' as const, canPlay: false };
    expect(accessText(ended, NOW)).toEqual({
      tone: 'alert',
      text: 'Your trial has ended. Subscribe to keep playing online.',
    });
    expect(lockedTitle(ended)).toBe('Your trial has ended');
    expect(lockedTitle({ ...ended, subStatus: 'canceled' })).toBe('Your subscription has ended');
  });

  it('R-COST-005 subscription states: renewing, ending, canceled, payment failed', () => {
    const sub = {
      ...base,
      status: 'subscriber' as const,
      subStatus: 'active',
      subExpiresAt: NOW + 30 * DAY,
      canTrade: true,
    };
    expect(accessText(sub, NOW, { planName: 'Monthly' }).text).toMatch(
      /^Subscribed \(monthly plan\)\. Renews on /,
    );
    expect(accessText(sub, NOW, { cancelAt: NOW + 30 * DAY }).text).toMatch(/It ends on/);
    expect(accessText({ ...sub, subStatus: 'canceled' }, NOW).text).toMatch(/canceled/);
    expect(accessText({ ...sub, subStatus: 'past_due' }, NOW)).toMatchObject({ tone: 'warn' });
  });

  it('R-COST-004 plan prices read as spec 14.3 sets them', () => {
    const plan = (months: number, priceCents: number) => ({
      id: 'monthly' as const,
      name: 'x',
      months,
      priceCents,
    });
    expect(priceText(plan(1, 400))).toBe('$4.00 a month');
    expect(priceText(plan(3, 1100))).toBe('$11.00 every 3 months');
    expect(priceText(plan(12, 4000))).toBe('$40.00 a year');
    expect(perMonthText(plan(1, 400))).toBeNull();
    expect(perMonthText(plan(3, 1100))).toBe('About $3.67 a month');
    expect(perMonthText(plan(12, 4000))).toBe('About $3.33 a month');
  });
});
