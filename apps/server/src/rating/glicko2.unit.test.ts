/** Glicko-2 against Glickman's worked example (M6 6.2, R-FMT-004). */
import { describe, expect, it } from 'vitest';
import { bracketForSlots, DEFAULT_RATING, update } from './glicko2.ts';

describe('Glicko-2 (R-FMT-004)', () => {
  it("R-FMT-004 matches Glickman's example: 1500/200/0.06 after 1-0-0 vs 1400/30, 1550/100, 1700/300", () => {
    const r = update({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it('R-FMT-004 no games only widens RD (capped at 350); wins raise and losses lower the rating', () => {
    const idle = update({ rating: 1600, rd: 100, volatility: 0.06 }, []);
    expect(idle.rating).toBe(1600);
    expect(idle.rd).toBeGreaterThan(100);
    expect(update(DEFAULT_RATING, []).rd).toBe(350);
    const opp = { rating: 1500, rd: 50, volatility: 0.06 };
    expect(update(DEFAULT_RATING, [{ opponent: opp, score: 1 }]).rating).toBeGreaterThan(1500);
    expect(update(DEFAULT_RATING, [{ opponent: opp, score: 0 }]).rating).toBeLessThan(1500);
    expect(update(DEFAULT_RATING, [{ opponent: opp, score: 0.5 }]).rating).toBeCloseTo(1500, 5);
  });

  it('R-FMT-004 brackets use unlocked slots: 1–2, 3–4, 5–6', () => {
    expect([1, 2, 3, 4, 5, 6].map(bracketForSlots)).toEqual([
      '1-2',
      '1-2',
      '3-4',
      '3-4',
      '5-6',
      '5-6',
    ]);
  });
});
