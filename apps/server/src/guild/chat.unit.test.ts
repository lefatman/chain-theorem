/**
 * Guild chat (M6 6.1; R-WORLD-004, R-SEC-011): the zone core sends a member's line out as an effect
 * for the guild's GuildRoom, the room filters it for everyone while any member is under 18
 * (recomputed from the roster at every membership change), and each member's zone core shows it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { basicChatFilter } from '../zone/chat.ts';
import { Harness, T0, effects, msgs, player } from '../zone/testing.ts';
import type { RoutedChat } from '../zone/types.ts';
import { guildFiltered, guildLine, type Roster } from './chat.ts';

const RUDE = 'well shit, visit www.example.com';
const CLEAN = basicChatFilter.clean(RUDE);
const ADULT = T0 - 1;
const MINOR = T0 + 365 * 24 * 3600_000;

let h = Harness.of();
afterEach(() => {
  expect(h.problems).toEqual([]);
});

function roster(members: [string, number][], version = 1): Roster {
  return {
    guild: 'g1',
    version,
    members: members.map(([p, adultFrom], i) => ({
      p,
      name: p.toUpperCase(),
      rank: i === 0 ? 'leader' : 'member',
      adultFrom,
    })),
  };
}

describe('guild chat in the zone core (R-WORLD-004)', () => {
  it('R-WORLD-004 a member sends a guild line out as an effect for its guild; others get no_guild', () => {
    h = Harness.of();
    h.enter(player('a', { guild: 'g1' }));
    h.enter(player('b'));
    const out = h.send('a', 'chat', { ch: 'guild', text: RUDE });
    expect(effects(out, 'guildChat')).toEqual([
      {
        kind: 'guildChat',
        guild: 'g1',
        msg: {
          ch: 'guild',
          from: 'a',
          name: 'A',
          text: RUDE,
          filtered: false,
          fromAdult: true,
          friend: true,
        },
      },
    ]);
    // Nothing is shown locally: the line comes back through the GuildRoom like everyone else's.
    expect(msgs(out, 'a', 'chatmsg')).toEqual([]);
    const none = h.send('b', 'chat', { ch: 'guild', text: 'hi' });
    expect(effects(none, 'guildChat')).toEqual([]);
    expect(msgs(none, 'b', 'err')[0]?.d.code).toBe('no_guild');
  });

  it('R-WORLD-004 setGuild follows joins and leaves; a reconnect takes the guild from the init', () => {
    h = Harness.of();
    h.enter(player('b'));
    h.core.setGuild('b', 'g2', h.tick());
    expect(h.me('b').guild).toBe('g2');
    expect(
      effects(h.send('b', 'chat', { ch: 'guild', text: 'hello' }), 'guildChat')[0]?.guild,
    ).toBe('g2');
    h.core.setGuild('b', null, h.tick());
    expect(msgs(h.send('b', 'chat', { ch: 'guild', text: 'hi' }), 'b', 'err')[0]?.d.code).toBe(
      'no_guild',
    );
    h.core.join(player('b', { guild: 'g3' }), h.tick());
    expect(h.me('b').guild).toBe('g3');
  });

  it("R-SEC-011 a minor's guild line is filtered at the source, so raw text never leaves", () => {
    h = Harness.of();
    h.enter(player('kid', { adult: false, guild: 'g1' }));
    const [e] = effects(h.send('kid', 'chat', { ch: 'guild', text: RUDE }), 'guildChat');
    expect(e?.msg).toMatchObject({ text: CLEAN, filtered: true, fromAdult: false });
  });

  it('R-SEC-011 a delivered guild line shows filtered text to viewers who filter', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('careful', { filterChat: true }));
    const line: RoutedChat = {
      ch: 'guild',
      from: 'x',
      name: 'X',
      text: RUDE,
      filtered: false,
      fromAdult: true,
      friend: true,
    };
    expect(msgs(h.core.deliverChat('a', line, h.tick()), 'a', 'chatmsg')[0]?.d).toEqual({
      ch: 'guild',
      from: 'x',
      name: 'X',
      text: RUDE,
      filtered: false,
    });
    expect(
      msgs(h.core.deliverChat('careful', line, h.tick()), 'careful', 'chatmsg')[0]?.d,
    ).toMatchObject({ text: CLEAN, filtered: true });
  });
});

describe('the GuildRoom line (R-SEC-011)', () => {
  const line = (from: string, text = RUDE, adult = true): RoutedChat => ({
    ch: 'guild',
    from,
    name: 'whoever',
    text,
    filtered: !adult,
    fromAdult: adult,
    friend: true,
  });

  it('R-SEC-011 a guild with any member under 18 is filtered for everyone; adults only is not', () => {
    const adults = roster([
      ['a', ADULT],
      ['b', ADULT],
    ]);
    expect(guildFiltered(adults, T0)).toBe(false);
    expect(guildLine(adults, line('a'), T0, basicChatFilter)).toEqual({
      ch: 'guild',
      from: 'a',
      name: 'A',
      text: RUDE,
      filtered: false,
      fromAdult: true,
      friend: true,
    });
    const mixed = roster([
      ['a', ADULT],
      ['kid', MINOR],
    ]);
    expect(guildFiltered(mixed, T0)).toBe(true);
    expect(guildLine(mixed, line('a'), T0, basicChatFilter)).toMatchObject({
      text: CLEAN,
      filtered: true,
    });
    // The minor turns 18: the guild is adults only from then on.
    expect(guildFiltered(mixed, MINOR)).toBe(false);
  });

  it('R-SEC-011 the filter is recomputed on every membership change before the next line', () => {
    let r = roster([
      ['a', ADULT],
      ['b', ADULT],
    ]);
    expect(guildLine(r, line('a'), T0, basicChatFilter)?.filtered).toBe(false);
    // A minor joins (version 2): the very next line is filtered.
    r = roster(
      [
        ['a', ADULT],
        ['b', ADULT],
        ['kid', MINOR],
      ],
      2,
    );
    expect(guildLine(r, line('a'), T0, basicChatFilter)).toMatchObject({
      text: CLEAN,
      filtered: true,
    });
    // The minor leaves (version 3): unfiltered again.
    r = roster(
      [
        ['a', ADULT],
        ['b', ADULT],
      ],
      3,
    );
    expect(guildLine(r, line('b'), T0, basicChatFilter)).toMatchObject({
      text: RUDE,
      filtered: false,
    });
  });

  it('R-SEC-011 R-WORLD-004 non-members cannot post; names come from the roster, not the line', () => {
    const r = roster([
      ['a', ADULT],
      ['kid', MINOR],
    ]);
    expect(guildLine(r, line('stranger'), T0, basicChatFilter)).toBeNull();
    const fromKid = guildLine(r, line('kid', CLEAN, false), T0, basicChatFilter);
    expect(fromKid).toMatchObject({ name: 'KID', text: CLEAN, filtered: true, fromAdult: false });
  });
});
