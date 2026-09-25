/**
 * Tournament plumbing, pure (M7 7.1; spec 10.4 R-WORLD-004): the daily schedule per slot bracket, and
 * what `settleBattle` reports for a tournament battle (a side that never sent a frame before the
 * grace ended did not start the game).
 */
import { describe, expect, it } from 'vitest';
import type { BattleSummary } from '../battle/index.ts';
import { gameOutcome } from '../world/tournament.ts';
import { formatName, scheduledEvents, tournamentName } from './schedule.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOON = Date.UTC(2026, 8, 25, 12);

describe('scheduled tournaments (M7 7.1)', () => {
  const schedule = [{ system: 'swiss' as const, format: 'full', hourUtc: 19, maxPlayers: 32 }];

  it('R-WORLD-004 one daily event per slot bracket, keyed by day, within the look-ahead', () => {
    const list = scheduledEvents(NOON, schedule, ['1-2', '3-4', '5-6'], DAY, formatName);
    expect(list.map((e) => e.key)).toEqual([
      'daily:swiss:full:1-2:2026-09-25',
      'daily:swiss:full:3-4:2026-09-25',
      'daily:swiss:full:5-6:2026-09-25',
    ]);
    expect(list[0]).toMatchObject({
      name: 'Daily Full Battle Swiss · 1-2 slots',
      startsAt: Date.UTC(2026, 8, 25, 19),
      maxPlayers: 32,
    });
    // After today's start the next one is tomorrow's; beyond the look-ahead nothing is listed.
    const late = scheduledEvents(NOON + 8 * HOUR, schedule, ['1-2'], DAY, formatName);
    expect(late[0]?.key).toBe('daily:swiss:full:1-2:2026-09-26');
    expect(scheduledEvents(NOON, schedule, ['1-2'], 6 * HOUR, formatName)).toEqual([]);
    expect(tournamentName('Vanguard', 'se', '3-4')).toBe('Vanguard Knockout · 3-4 slots');
  });
});

describe('tournament results from settleBattle (M7 7.1)', () => {
  const summary = (
    reason: string,
    winner: 'white' | 'black' | null,
    received: [number, number],
  ): Pick<BattleSummary, 'result' | 'stats'> =>
    ({
      result: { winner, reason },
      stats: {
        white: { received: received[0], rateLimited: 0, invalid: 0, rejected: 0 },
        black: { received: received[1], rateLimited: 0, invalid: 0, rejected: 0 },
      },
    }) as Pick<BattleSummary, 'result' | 'stats'>;

  it('R-WORLD-004 a side that never sent a frame before abandonment did not start the game', () => {
    expect(gameOutcome(summary('abandon', 'white', [3, 0]))).toEqual({
      winner: 'white',
      reason: 'abandon',
      absent: { white: false, black: true },
    });
    expect(gameOutcome(summary('abandon', 'black', [0, 0])).absent).toEqual({
      white: true,
      black: true,
    });
    // Leaving after playing is a loss, not a game never started; a resignation is never absence.
    expect(gameOutcome(summary('abandon', 'white', [5, 4])).absent).toEqual({
      white: false,
      black: false,
    });
    expect(gameOutcome(summary('resign', 'black', [0, 2])).absent).toEqual({
      white: false,
      black: false,
    });
    expect(gameOutcome(summary('agreement', null, [9, 9]))).toMatchObject({ winner: null });
  });
});
