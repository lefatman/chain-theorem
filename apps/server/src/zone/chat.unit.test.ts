/**
 * Chat safety (R-SEC-011, COMMITTED) and chat routing (R-WORLD-004): filtered by the youngest
 * participant, recomputed when membership changes, adults may opt in, whispers to or from minors
 * only between friends; party and whisper lines are routed through the host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  basicChatFilter,
  conversationFiltered,
  isBlocked,
  sanitizeText,
  viewFiltered,
  whisperAllowed,
} from './chat.ts';
import { Harness, effects, fixtureWorld, msgs, player } from './testing.ts';
import type { Outbox, PartyView } from './types.ts';

let h = Harness.of();
afterEach(() => {
  expect(h.problems).toEqual([]);
});

const RUDE = 'well shit, visit www.example.com';
const CLEAN = basicChatFilter.clean(RUDE);
const say = (from: string, text = RUDE) => h.send(from, 'chat', { ch: 'zone', text });
const seen = (out: Outbox, who: string) => msgs(out, who, 'chatmsg')[0]?.d;

describe('the default filter (R-SEC-011)', () => {
  it('R-SEC-011 masks blocked words, links, emails and phone numbers', () => {
    expect(CLEAN).toBe('well ****, visit ***');
    expect(basicChatFilter.clean('mail me at kid.name@example.org ok')).toBe('mail me at *** ok');
    expect(basicChatFilter.clean('call 555-123-4567 now')).toBe('call *** now');
    expect(basicChatFilter.clean('call +1 (555) 123 4567')).toBe('call ***');
    expect(basicChatFilter.clean('go to https://evil.test/x?y=1 now')).toBe('go to *** now');
    expect(basicChatFilter.clean('see example dot com or example(dot)com')).toContain('***');
    expect(basicChatFilter.clean('add me on snapchat')).toBe('add me on ********');
  });

  it('R-SEC-011 catches look-alike spellings but not innocent words', () => {
    for (const w of ['sh1t', 'SHIT!', 'shiiiit', 'b1tch', 'fuuuck', 'asshole', 'sexy'])
      expect(isBlocked(w)).toBe(true);
    for (const w of [
      'Scunthorpe',
      'class',
      'assist',
      'title',
      'Essex',
      'passage',
      'grape',
      'knight',
      'checkmate',
    ])
      expect(isBlocked(w)).toBe(false);
    expect(basicChatFilter.clean('Good game, nice checkmate!')).toBe('Good game, nice checkmate!');
    expect(basicChatFilter.clean(CLEAN)).toBe(CLEAN);
  });

  it('R-SEC-011 strips control, zero-width and bidi characters that hide words', () => {
    expect(sanitizeText('sh\u200bit  \u202eok\n\tthere')).toBe('shit ok there');
    expect(basicChatFilter.clean(sanitizeText('s\u200bh\u200bi\u200bt!'))).toBe('****!');
    // Spelled out one letter at a time.
    expect(basicChatFilter.clean('you s h i t')).toBe('you * * * *');
    expect(basicChatFilter.clean('s.h.i.t')).toBe('*.*.*.*');
    expect(basicChatFilter.clean('a b c d e')).toBe('a b c d e');
  });

  it('R-SEC-011 policy: youngest participant, opt-in for adults, whispers with minors need friendship', () => {
    expect(conversationFiltered([{ adult: true }, { adult: true }])).toBe(false);
    expect(conversationFiltered([{ adult: true }, { adult: false }])).toBe(true);
    expect(viewFiltered(false, { adult: true, filterChat: false })).toBe(false);
    expect(viewFiltered(false, { adult: true, filterChat: true })).toBe(true);
    expect(viewFiltered(false, { adult: false, filterChat: false })).toBe(true);
    const adult = { id: 'a', adult: true, friends: [] };
    const kid = { id: 'k', adult: false, friends: ['f'] };
    const friend = { id: 'f', adult: true, friends: ['k'] };
    const oneWay = { id: 'o', adult: true, friends: ['k'] };
    expect(whisperAllowed(adult, { ...adult, id: 'b' })).toBe(true);
    expect(whisperAllowed(adult, kid)).toBe(false);
    expect(whisperAllowed(kid, adult)).toBe(false);
    expect(whisperAllowed(kid, friend)).toBe(true);
    expect(whisperAllowed(friend, kid)).toBe(true);
    // Friendship must be mutual.
    expect(whisperAllowed(oneWay, kid)).toBe(false);
    expect(whisperAllowed(adult, adult)).toBe(false);
  });
});

describe('zone chat filtering (R-SEC-011)', () => {
  it('R-SEC-011 adults only: unfiltered for everyone', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    const out = say('a');
    for (const who of ['a', 'b'])
      expect(seen(out, who)).toEqual({
        ch: 'zone',
        from: 'a',
        name: 'A',
        text: RUDE,
        filtered: false,
      });
  });

  it('R-SEC-011 one minor in the channel filters the conversation for everyone', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    h.enter(player('kid', { adult: false }));
    const out = say('a');
    for (const who of ['a', 'b', 'kid'])
      expect(seen(out, who)).toMatchObject({ text: CLEAN, filtered: true });
  });

  it('R-SEC-011 the level is recomputed when membership changes, before the next message', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    expect(seen(say('a'), 'b')?.filtered).toBe(false);
    // A minor joins (not even said hello yet): the very next line is filtered.
    h.core.join(player('kid', { adult: false }), h.tick());
    const during = say('a');
    expect(seen(during, 'b')).toMatchObject({ text: CLEAN, filtered: true });
    expect(msgs(during, 'kid', 'chatmsg')).toEqual([]);
    h.core.leave('kid', h.tick());
    expect(seen(say('a'), 'b')).toMatchObject({ text: RUDE, filtered: false });
  });

  it('R-SEC-011 an adult may turn the filter on for themselves only; a minor cannot turn it off', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b', { filterChat: true }));
    let out = say('a');
    expect(seen(out, 'a')?.filtered).toBe(false);
    expect(seen(out, 'b')).toMatchObject({ text: CLEAN, filtered: true });
    const prefs = h.send('a', 'prefs', { filterChat: true });
    expect(effects(prefs, 'prefs')).toEqual([{ kind: 'prefs', id: 'a', filterChat: true }]);
    out = say('b');
    expect(seen(out, 'a')?.filtered).toBe(true);
    h.send('a', 'prefs', { filterChat: false });
    h.send('b', 'prefs', { filterChat: false });
    expect(seen(say('b'), 'a')?.filtered).toBe(false);
    // A minor's own preference never unfilters (and their presence filters the others too).
    h.enter(player('kid', { adult: false }));
    h.send('kid', 'prefs', { filterChat: false });
    expect(seen(say('a'), 'kid')?.filtered).toBe(true);
  });

  it('R-SEC-011 guild chat is not available before guilds exist (M6)', () => {
    h = Harness.of();
    h.enter(player('a'));
    const out = h.send('a', 'chat', { ch: 'guild', text: 'hello' });
    expect(msgs(out, 'a', 'err')[0]?.d.code).toBe('no_guild');
  });
});

describe('whispers (R-SEC-011)', () => {
  it('R-SEC-011 adults whisper freely; the line reaches only the recipient', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    h.enter(player('c'));
    const out = h.send('a', 'chat', { ch: 'whisper', to: 'b', text: RUDE });
    expect(seen(out, 'b')).toEqual({
      ch: 'whisper',
      from: 'a',
      name: 'A',
      text: RUDE,
      filtered: false,
    });
    expect(msgs(out, 'c', 'chatmsg')).toEqual([]);
    expect(msgs(out, 'a', 'chatmsg')).toEqual([]);
  });

  it('R-SEC-011 whispers to or from a minor need friendship both ways, and are filtered', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('kid', { adult: false, friends: ['pal', 'fan'] }));
    h.enter(player('pal', { friends: ['kid'] }));
    h.enter(player('fan'));
    const toKid = h.send('a', 'chat', { ch: 'whisper', to: 'kid', text: 'hi' });
    expect(msgs(toKid, 'a', 'err')[0]?.d.code).toBe('whisper_refused');
    expect(msgs(toKid, 'kid', 'chatmsg')).toEqual([]);
    const fromKid = h.send('kid', 'chat', { ch: 'whisper', to: 'a', text: 'hi' });
    expect(msgs(fromKid, 'kid', 'err')[0]?.d.code).toBe('friends_only');
    // The kid lists "fan", but "fan" does not list the kid.
    const oneWay = h.send('kid', 'chat', { ch: 'whisper', to: 'fan', text: 'hi' });
    expect(msgs(oneWay, 'kid', 'err')[0]?.d.code).toBe('whisper_refused');
    const ok = h.send('pal', 'chat', { ch: 'whisper', to: 'kid', text: RUDE });
    expect(seen(ok, 'kid')).toMatchObject({ from: 'pal', text: CLEAN, filtered: true });
    const back = h.send('kid', 'chat', { ch: 'whisper', to: 'pal', text: RUDE });
    expect(seen(back, 'pal')).toMatchObject({ from: 'kid', text: CLEAN, filtered: true });
  });

  it('R-SEC-011 a whisper to another channel is routed; the far side enforces the minor rule', () => {
    const world = fixtureWorld();
    h = Harness.of(world);
    h.enter(player('a'));
    h.enter(player('kid', { adult: false, friends: ['pal'] }));
    const far = Harness.of(world, 'route');
    far.enter(player('b'));
    far.enter(player('pal', { adult: false, friends: ['kid'] }));
    // Adult a -> adult b elsewhere: routed with raw text, delivered unfiltered.
    const out = h.send('a', 'chat', { ch: 'whisper', to: 'b', text: RUDE });
    const route = effects(out, 'chat')[0];
    expect(route).toMatchObject({ from: 'a', to: ['b'], msg: { ch: 'whisper', filtered: false } });
    const got = far.core.deliverChat('b', route?.msg ?? ({} as never), far.tick());
    expect(seen(got, 'b')).toMatchObject({ text: RUDE, filtered: false });
    // Adult a -> minor pal elsewhere (not friends): the far core refuses and bounces.
    const toKid = effects(h.send('a', 'chat', { ch: 'whisper', to: 'pal', text: 'hi' }), 'chat')[0];
    const refused = far.core.deliverChat('pal', toKid?.msg ?? ({} as never), far.tick());
    expect(msgs(refused, 'pal', 'chatmsg')).toEqual([]);
    expect(effects(refused, 'bounce')).toEqual([
      { kind: 'bounce', to: 'a', code: 'whisper_refused' },
    ]);
    expect(msgs(h.core.chatRefused('a', h.tick()), 'a', 'err')[0]?.d.code).toBe('whisper_refused');
    // Minor kid -> minor friend pal elsewhere: filtered at the source, delivered.
    const kidOut = effects(
      h.send('kid', 'chat', { ch: 'whisper', to: 'pal', text: RUDE }),
      'chat',
    )[0];
    expect(kidOut?.msg).toMatchObject({
      text: CLEAN,
      filtered: true,
      fromAdult: false,
      friend: true,
    });
    expect(
      seen(far.core.deliverChat('pal', kidOut?.msg ?? ({} as never), far.tick()), 'pal'),
    ).toMatchObject({
      text: CLEAN,
      filtered: true,
    });
    // Nobody there: bounced.
    const gone = far.core.deliverChat('nobody', kidOut?.msg ?? ({} as never), far.tick());
    expect(effects(gone, 'bounce')).toHaveLength(1);
    expect(far.problems).toEqual([]);
  });
});

describe('party chat and party operations (R-WORLD-004, R-SEC-011)', () => {
  const party = (minor: boolean): PartyView => ({
    id: 'party-1',
    leader: 'a',
    members: [
      { p: 'a', name: 'A', zone: 'town' },
      { p: 'b', name: 'B', zone: 'route' },
    ],
    minor,
  });

  it('R-SEC-011 party lines are routed to every member; a party with a minor is filtered', () => {
    h = Harness.of();
    h.enter(player('a', { party: party(false) }));
    const out = h.send('a', 'chat', { ch: 'party', text: RUDE });
    expect(effects(out, 'chat')[0]).toMatchObject({
      from: 'a',
      to: ['a', 'b'],
      msg: { ch: 'party', text: RUDE, filtered: false },
    });
    // The host recomputes `minor` on a membership change and calls setParty for every member.
    const set = h.core.setParty('a', party(true), h.tick());
    expect(msgs(set, 'a', 'party')[0]?.d).toEqual({
      id: 'party-1',
      leader: 'a',
      members: [
        { p: 'a', name: 'A', zone: 'town' },
        { p: 'b', name: 'B', zone: 'route' },
      ],
    });
    const after = h.send('a', 'chat', { ch: 'party', text: RUDE });
    expect(effects(after, 'chat')[0]?.msg).toMatchObject({ text: CLEAN, filtered: true });
    // Delivery applies the recipient's own view: an opted-in adult sees the filtered line.
    h.enter(player('c', { filterChat: true }));
    const line = effects(out, 'chat')[0]?.msg ?? ({} as never);
    expect(seen(h.core.deliverChat('c', line, h.tick()), 'c')).toMatchObject({
      text: CLEAN,
      filtered: true,
    });
    expect(seen(h.core.deliverChat('a', line, h.tick()), 'a')).toMatchObject({
      text: RUDE,
      filtered: false,
    });
    // Without a party there is nothing to route.
    expect(msgs(h.send('c', 'chat', { ch: 'party', text: 'hi' }), 'c', 'err')[0]?.d.code).toBe(
      'no_party',
    );
  });

  it('R-WORLD-004 invites, replies and leaving become host effects; hello resends the party', () => {
    h = Harness.of();
    h.enter(player('a', { party: party(false) }));
    h.enter(player('b'));
    expect(effects(h.send('a', 'party', { op: 'invite', to: 'b' }), 'party')).toEqual([
      { kind: 'party', party: { op: 'invite', from: 'a', name: 'A', to: 'b' } },
    ]);
    const inv = h.core.partyInvite('b', { id: 'inv-1', from: 'a', name: 'A' }, h.tick());
    expect(msgs(inv, 'b', 'partyInvite')[0]?.d).toEqual({ id: 'inv-1', from: 'a', name: 'A' });
    expect(
      effects(h.send('b', 'party', { op: 'reply', id: 'inv-1', accept: true }), 'party'),
    ).toEqual([
      { kind: 'party', party: { op: 'reply', from: 'b', invite: 'inv-1', accept: true } },
    ]);
    expect(msgs(h.send('b', 'party', { op: 'leave' }), 'b', 'err')[0]?.d.code).toBe('no_party');
    expect(effects(h.send('a', 'party', { op: 'leave' }), 'party')).toHaveLength(1);
    const hello = h.send('a', 'hello', {});
    expect(msgs(hello, 'a', 'party')[0]?.d.id).toBe('party-1');
    const none = h.core.setParty('a', null, h.tick());
    expect(msgs(none, 'a', 'party')[0]?.d).toEqual({ id: null, leader: null, members: [] });
  });
});
