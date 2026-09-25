/**
 * The zone core's `notify` host input (M6 6.1): trade and wager invitations and wager results reach a
 * player through the zone channel they are in (10.4, 9.5). It sends exactly one message to that
 * player, only when they are here, and changes nothing else.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Harness, msgs, player } from './testing.ts';

let h = Harness.of();
afterEach(() => {
  expect(h.problems).toEqual([]);
});

describe('notify (M6)', () => {
  it('R-WORLD-004 R-FMT-006 delivers one host message to a player in the channel and nobody else', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    const before = h.core.snapshot();
    const out = h.core.notify(
      'b',
      { t: 'tradeIn', d: { id: 'trade-1', from: 'a', name: 'A', mode: 'wager' } },
      h.tick(),
    );
    expect(out.send).toEqual([
      { to: 'b', msg: { t: 'tradeIn', d: { id: 'trade-1', from: 'a', name: 'A', mode: 'wager' } } },
    ]);
    expect(out.effects).toEqual([]);
    expect(out.save).toBe(false);
    expect(h.core.snapshot().players).toEqual(before.players);
    const end = h.core.notify(
      'a',
      {
        t: 'wagerEnd',
        d: {
          id: 'w1',
          result: 'won',
          items: [{ id: 'quick_boots', qty: 1 }],
          cards: [],
          invalid: [],
        },
      },
      h.tick(),
    );
    expect(msgs(end, 'a', 'wagerEnd')[0]?.d.result).toBe('won');
  });

  it('R-WORLD-004 sends nothing for a player who is not in this channel', () => {
    h = Harness.of();
    h.enter(player('a'));
    const out = h.core.notify(
      'ghost',
      { t: 'tradeIn', d: { id: 't', from: 'a', name: 'A', mode: 'trade' } },
      h.tick(),
    );
    expect(out.send).toEqual([]);
    expect(out.effects).toEqual([]);
  });
});
