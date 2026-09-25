/** Tournament screen words (M7 7.1, R-WORLD-004): round names, results spelled out, places. */
import { describe, expect, it } from 'vitest';
import { ServerZone, decode, type TournamentPairing } from '@chain-theorem/protocol';
import { tourneyText } from '../world/controller.ts';
import {
  advancing,
  cannotText,
  countdown,
  ordinal,
  resultText,
  roundName,
} from './tournamentText.ts';

const pairing = (over: Partial<TournamentPairing>): TournamentPairing => ({
  board: 1,
  white: { id: 'w', name: 'Wes' },
  black: { id: 'b', name: 'Bea' },
  result: null,
  absent: [],
  ...over,
});

describe('tournament text (M7 7.1)', () => {
  it('R-WORLD-004 knockout rounds are named from the final back; Swiss rounds are numbered', () => {
    expect([1, 2, 3, 4].map((n) => roundName('se', n, 4))).toEqual([
      'Round of 16',
      'Quarter-finals',
      'Semi-finals',
      'Final',
    ]);
    expect(roundName('swiss', 3, 5)).toBe('Round 3');
  });

  it('R-WORLD-004 results are spelled out, forfeits and double losses included', () => {
    expect(resultText(pairing({ result: 'white' }), true)).toBe('1–0');
    expect(resultText(pairing({ result: 'black', absent: ['w'] }), true)).toBe('0–1 (forfeit)');
    expect(resultText(pairing({ result: 'draw' }), true)).toBe('½–½');
    expect(resultText(pairing({ result: 'none', absent: ['w', 'b'] }), true)).toBe(
      '0–0 (neither played)',
    );
    expect(resultText(pairing({ black: null, result: 'bye' }), true)).toBe('bye');
    expect(resultText(pairing({}), true)).toBe('playing');
    expect(resultText(pairing({}), false)).toBe('not started');
  });

  it('R-WORLD-004 a knockout draw sends Black through; a double loss sends nobody', () => {
    expect(advancing(pairing({ result: 'draw' }))).toBe('b');
    expect(advancing(pairing({ result: 'white' }))).toBe('w');
    expect(advancing(pairing({ result: 'none' }))).toBeNull();
    expect(advancing(pairing({ black: null, result: 'bye' }))).toBe('w');
  });

  it('R-WORLD-004 places, countdowns and refusals read naturally', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
    expect(countdown(0)).toBe('now');
    expect(countdown(12_100)).toBe('in 13 s');
    expect(countdown(125_000)).toBe('in 2 min 5 s');
    expect(countdown(3 * 3_600_000 + 60_000)).toBe('in 3 h 1 min');
    expect(cannotText('wrong_bracket')).toMatch(/slot bracket/);
    expect(cannotText(null)).toBeNull();
  });

  it('R-WORLD-004 the world shows a tournament notice as one line (zone `tourney`)', () => {
    const raw = JSON.stringify({
      t: 'tourney',
      d: { id: 't1', name: 'Daily Cup', kind: 'game', round: 2, opponent: 'Bea' },
    });
    const msg = decode(ServerZone, raw, Number.POSITIVE_INFINITY);
    expect(msg?.t).toBe('tourney');
    if (msg?.t !== 'tourney') return;
    expect(tourneyText(msg.d)).toMatch(/Daily Cup: your round 2 game against Bea is ready/);
    expect(
      tourneyText({ id: 't1', name: 'Daily Cup', kind: 'paired', round: 3, opponent: null }),
    ).toMatch(/you have a bye/);
    expect(tourneyText({ id: 't1', name: 'Daily Cup', kind: 'finished', place: 2 })).toBe(
      'Daily Cup is over: you finished in place 2.',
    );
  });
});
