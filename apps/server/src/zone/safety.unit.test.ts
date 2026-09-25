/**
 * Mute, block and chat bans in the zone core (M6 6.4; spec 15 R-SEC-011 "Report, mute and block
 * stay available to everyone"; 10.4 R-WORLD-004), and battles started outside the zone (wagers,
 * queues) marking the player battling. Everything is applied where lines are delivered, so a muted
 * or blocked player cannot route around it with another client; a blocked pair's refusals are the
 * ones an offline or unavailable target gets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGE_COOLDOWN_MS, ZoneCore } from './core.ts';
import { Harness, effects, fixtureWorld, msgs, player } from './testing.ts';
import type { Outbox, PartyView, RoutedChat } from './types.ts';

let h = Harness.of();
afterEach(() => {
  expect(h.problems).toEqual([]);
});

const say = (from: string, text = 'hello there') => h.send(from, 'chat', { ch: 'zone', text });
const lines = (out: Outbox, who: string) => msgs(out, who, 'chatmsg').map((m) => m.d.text);
const errs = (out: Outbox, who: string) => msgs(out, who, 'err').map((m) => m.d.code);
const whisper = (from: string, to: string, text = 'psst') =>
  h.send(from, 'chat', { ch: 'whisper', to, text });

const line = (from: string, ch: RoutedChat['ch'], text = 'routed'): RoutedChat => ({
  ch,
  from,
  name: from.toUpperCase(),
  text,
  filtered: false,
  fromAdult: true,
  friend: false,
});

describe('mute (R-SEC-011)', () => {
  it('R-SEC-011 a muter no longer receives the muted player zone lines; everyone else does', () => {
    h = Harness.of();
    h.enter(player('a', { muted: ['b'] }));
    h.enter(player('b'));
    h.enter(player('c'));
    const out = say('b', 'from b');
    expect(lines(out, 'a')).toEqual([]);
    expect(lines(out, 'b')).toEqual(['from b']);
    expect(lines(out, 'c')).toEqual(['from b']);
    // The muted player is not told: no error, and a's own lines still reach b.
    expect(errs(out, 'b')).toEqual([]);
    expect(lines(say('a', 'from a'), 'b')).toEqual(['from a']);
  });

  it('R-SEC-011 muted party, guild and whisper lines are dropped at delivery without a bounce', () => {
    h = Harness.of();
    h.enter(player('a', { muted: ['b'] }));
    for (const ch of ['party', 'guild', 'whisper'] as const) {
      const out = h.core.deliverChat('a', line('b', ch), h.tick());
      expect(msgs(out, 'a', 'chatmsg')).toEqual([]);
      expect(effects(out, 'bounce')).toEqual([]);
    }
    // A player not muted still gets through.
    expect(lines(h.core.deliverChat('a', line('c', 'guild'), h.tick()), 'a')).toEqual(['routed']);
    // In the same channel, a muted sender's whisper looks delivered to the sender.
    h.enter(player('b'));
    const out = whisper('b', 'a');
    expect(msgs(out, 'a', 'chatmsg')).toEqual([]);
    expect(errs(out, 'b')).toEqual([]);
  });

  it('R-SEC-011 setSafety applies a new mute before the next line and survives a snapshot', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    expect(lines(say('b'), 'a')).toEqual(['hello there']);
    expect(h.core.setSafety('a', { muted: ['b'], blocked: [] }, h.tick()).save).toBe(true);
    expect(lines(say('b'), 'a')).toEqual([]);
    const restored = ZoneCore.restore(fixtureWorld(), h.core.snapshot());
    const out = restored.message(
      'b',
      JSON.stringify({ t: 'chat', d: { ch: 'zone', text: 'x' } }),
      h.tick(),
    );
    expect(lines(out, 'a')).toEqual([]);
    // Unmuting brings the lines back; a reconnect refreshes the lists from the database.
    h.core.setSafety('a', { muted: [], blocked: [] }, h.tick());
    expect(lines(say('b'), 'a')).toEqual(['hello there']);
    h.core.join(player('a', { muted: ['b'] }), h.tick());
    h.send('a', 'hello', {});
    expect(lines(say('b'), 'a')).toEqual([]);
  });
});

describe('block (R-SEC-011, R-WORLD-004)', () => {
  it('R-SEC-011 a blocker gets none of the blocked player lines; the blocked still sees public lines', () => {
    h = Harness.of();
    h.enter(player('a', { blocked: ['b'] }));
    h.enter(player('b'));
    expect(lines(say('b'), 'a')).toEqual([]);
    expect(lines(say('a', 'public'), 'b')).toEqual(['public']);
    expect(msgs(h.core.deliverChat('a', line('b', 'party'), h.tick()), 'a', 'chatmsg')).toEqual([]);
  });

  it('R-SEC-011 whispers are refused both ways, exactly like an offline target', () => {
    h = Harness.of();
    h.enter(player('a', { blocked: ['b'] }));
    h.enter(player('b'));
    // The answer an offline target gets: the same code, nothing delivered.
    const offline = whisper('b', 'nobody-here');
    expect(effects(offline, 'chat')).toHaveLength(1);
    const offlineCode = msgs(h.core.chatRefused('b', h.tick()), 'b', 'err')[0]?.d.code;
    expect(offlineCode).toBe('whisper_refused');
    const toBlocker = whisper('b', 'a');
    expect(errs(toBlocker, 'b')).toEqual([offlineCode]);
    expect(msgs(toBlocker, 'a', 'chatmsg')).toEqual([]);
    const fromBlocker = whisper('a', 'b');
    expect(errs(fromBlocker, 'a')).toEqual([offlineCode]);
    expect(msgs(fromBlocker, 'b', 'chatmsg')).toEqual([]);
    // Across channels: the blocker's core bounces the routed whisper like an absent player.
    const far = Harness.of(fixtureWorld(), 'route');
    far.enter(player('x', { blocked: ['b'] }));
    const bounced = far.core.deliverChat('x', line('b', 'whisper'), far.tick());
    const absent = far.core.deliverChat('gone', line('b', 'whisper'), far.tick());
    expect(msgs(bounced, 'x', 'chatmsg')).toEqual([]);
    expect(effects(bounced, 'bounce')).toEqual(effects(absent, 'bounce'));
    expect(effects(bounced, 'bounce')).toEqual([
      { kind: 'bounce', to: 'b', code: 'whisper_refused' },
    ]);
    // And the sender's core routes it without knowing (no list of who blocked them is needed).
    h.enter(player('c'));
    expect(effects(whisper('c', 'x'), 'chat')).toHaveLength(1);
    expect(far.problems).toEqual([]);
  });

  it('R-WORLD-004 consent challenges are refused both ways like a busy target', () => {
    h = Harness.of();
    h.enter(player('a', { blocked: ['b'], x: 3, y: 4 }));
    h.enter(player('b', { x: 4, y: 4 }));
    h.enter(player('c', { x: 5, y: 4 }));
    for (const [from, to] of [
      ['b', 'a'],
      ['a', 'b'],
    ] as const) {
      const out = h.send(from, 'chal', { to, format: 'full' });
      expect(errs(out, from)).toEqual(['busy']);
      expect(msgs(out, to, 'chalIn')).toEqual([]);
      expect(effects(out, 'battle')).toEqual([]);
    }
    // Others are unaffected.
    expect(msgs(h.send('c', 'chal', { to: 'a', format: 'full' }), 'a', 'chalIn')).toHaveLength(1);
  });

  it('R-WORLD-004 challenge-zone automatic challenges are refused too', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 6, level: 5, blocked: ['b'] }));
    h.enter(player('b', { x: 4, y: 6, level: 5 }));
    const out = h.send('b', 'chal', { to: 'a', format: 'first_blood' });
    expect(effects(out, 'battle')).toEqual([]);
    expect(errs(out, 'b')).toEqual(['busy']);
    expect(h.me('a').battling || h.me('b').battling).toBe(false);
  });

  it('R-WORLD-004 a new block drops pending challenges between the pair; replies fail', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 4 }));
    h.enter(player('b', { x: 4, y: 4 }));
    h.enter(player('c', { x: 5, y: 4 }));
    const id = msgs(h.send('b', 'chal', { to: 'a', format: 'full' }), 'a', 'chalIn')[0]?.d.id;
    const other = msgs(h.send('c', 'chal', { to: 'a', format: 'full' }), 'a', 'chalIn')[0]?.d.id;
    h.core.setSafety('a', { muted: [], blocked: ['b'] }, h.tick());
    expect(h.core.snapshot().challenges.map((c) => c.from)).toEqual(['c']);
    const reply = h.send('a', 'chalReply', { id, accept: true });
    expect(errs(reply, 'a')).toEqual(['no_challenge']);
    expect(effects(reply, 'battle')).toEqual([]);
    expect(effects(h.send('a', 'chalReply', { id: other, accept: true }), 'battle')).toHaveLength(
      1,
    );
  });

  it('R-WORLD-004 a challenge sent before the block by the blocked player cannot be accepted', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 4 }));
    h.enter(player('b', { x: 4, y: 4 }));
    const id = msgs(h.send('a', 'chal', { to: 'b', format: 'full' }), 'b', 'chalIn')[0]?.d.id;
    // b blocks a from another channel's view: only a's list is here, refreshed on a reconnect.
    h.core.join(player('b', { x: 4, y: 4, blocked: ['a'] }), h.tick());
    h.send('b', 'hello', {});
    const reply = h.send('b', 'chalReply', { id, accept: true });
    expect(errs(reply, 'b')).toEqual(['no_challenge']);
    expect(effects(reply, 'battle')).toEqual([]);
  });
});

describe('chat bans (R-SEC-011)', () => {
  it('R-SEC-011 a banned player lines are dropped on every channel and they are told once', () => {
    h = Harness.of();
    const party: PartyView = {
      id: 'p1',
      leader: 'a',
      members: [
        { p: 'a', name: 'A', zone: 'town' },
        { p: 'b', name: 'B', zone: 'town' },
      ],
      minor: false,
    };
    const until = h.t + 60 * 60_000;
    h.enter(player('a', { chatBanUntil: until, party, guild: 'g1' }));
    h.enter(player('b', { party }));
    const first = say('a');
    expect(lines(first, 'b')).toEqual([]);
    expect(errs(first, 'a')).toEqual(['chat_banned']);
    expect(msgs(first, 'a', 'err')[0]?.d.msg).toContain('UTC');
    for (const ch of ['zone', 'party', 'guild'] as const) {
      const out = h.send('a', 'chat', { ch, text: 'again' });
      expect(out.send).toEqual([]);
      expect(out.effects.filter((e) => e.kind !== 'telemetry')).toEqual([]);
    }
    const w = whisper('a', 'b');
    expect(w.send).toEqual([]);
    expect(effects(w, 'chat')).toEqual([]);
  });

  it('R-SEC-011 a live ban applies at once, lifts, and a ban that ran out allows chat', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    h.core.setChatBan('a', h.t + 10_000, h.tick());
    expect(errs(say('a'), 'a')).toEqual(['chat_banned']);
    h.core.setChatBan('a', null, h.tick());
    expect(lines(say('a'), 'b')).toEqual(['hello there']);
    h.core.setChatBan('a', h.t + 1_000, h.tick());
    h.t += 5_000;
    expect(lines(say('a'), 'b')).toEqual(['hello there']);
  });
});

describe('battles outside the zone (R-WORLD-004, R-WORLD-006)', () => {
  it('R-WORLD-004 a wager or queue battle marks the player battling: no consent challenges', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 4 }));
    h.enter(player('b', { x: 4, y: 4 }));
    const on = h.core.externalBattle('a', 'wager-battle', true, h.tick());
    expect(msgs(on, 'b', 'zbattle').map((m) => m.d)).toEqual([{ p: 'a', battling: true }]);
    expect(on.save).toBe(true);
    expect(errs(h.send('b', 'chal', { to: 'a', format: 'full' }), 'b')).toEqual(['busy']);
    expect(errs(h.send('a', 'chal', { to: 'b', format: 'full' }), 'a')).toEqual(['battling']);
    // The end of another battle changes nothing; this one clears the marker and starts the
    // 60 s challenge cooldown.
    expect(h.core.externalBattle('a', 'other', false, h.tick()).send).toEqual([]);
    const off = h.core.externalBattle('a', 'wager-battle', false, h.tick());
    expect(msgs(off, 'b', 'zbattle').map((m) => m.d)).toEqual([{ p: 'a', battling: false }]);
    expect(h.me('a')).toMatchObject({ battling: false, battleId: null, battleEndedAt: h.t });
    expect(msgs(h.send('b', 'chal', { to: 'a', format: 'full' }), 'a', 'chalIn')).toHaveLength(1);
    expect(h.me('a').battleEndedAt! + CHALLENGE_COOLDOWN_MS).toBeGreaterThan(h.t);
  });

  it('R-WORLD-006 challenge-zone auto challenges skip a player in an outside battle', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 6, level: 5 }));
    h.enter(player('b', { x: 4, y: 6, level: 5 }));
    h.core.externalBattle('a', 'queue-battle', true, h.tick());
    const out = h.send('b', 'chal', { to: 'a', format: 'first_blood' });
    expect(effects(out, 'battle')).toEqual([]);
    expect(errs(out, 'b')).toEqual(['busy']);
  });

  it('R-WORLD-004 a reload mid-battle keeps the battle id so its end clears the marker', () => {
    h = Harness.of();
    h.enter(player('a', { battling: true, battleId: 'b-1' }));
    expect(h.me('a')).toMatchObject({ battling: true, battleId: 'b-1' });
    h.core.externalBattle('a', 'b-1', false, h.tick());
    expect(h.me('a').battling).toBe(false);
    // Without the id (an older host), the start of the external battle records it.
    h.enter(player('c', { battling: true }));
    h.core.externalBattle('c', 'b-2', true, h.tick());
    h.core.externalBattle('c', 'b-2', false, h.tick());
    expect(h.me('c').battling).toBe(false);
  });

  it('R-WORLD-004 a zone battle is not ended by an outside battle end, and vice versa', () => {
    h = Harness.of();
    h.enter(player('a', { x: 3, y: 4 }));
    h.core.externalBattle('a', 'ext', true, h.tick());
    // Already battling: a zone battle cannot start, and the zone end call changes the marker only
    // through battleEnded (which the host sends for zone battles only).
    expect(h.core.externalBattle('a', 'zone-battle', false, h.tick()).send).toEqual([]);
    expect(h.me('a').battling).toBe(true);
  });
});

describe('suspension (R-SEC-006)', () => {
  it('R-SEC-006 kick closes the player socket; the host then removes them', () => {
    h = Harness.of();
    h.enter(player('a'));
    expect(effects(h.core.kick('a', 4003, 'suspended', h.tick()), 'close')).toEqual([
      { kind: 'close', id: 'a', code: 4003, reason: 'suspended' },
    ]);
    expect(effects(h.core.kick('nobody', 4003, 'suspended', h.tick()), 'close')).toEqual([]);
  });
});
