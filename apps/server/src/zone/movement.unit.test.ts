/**
 * Zone presence and movement (R-WORLD-001, R-SEC-005, R-COST-002): joins, snapshots, walls, rate
 * limits, warps, challenge-zone banners, capacity and when positions are persisted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS, MAX_STRIKES } from '@chain-theorem/protocol';
import { ZONE_CAPACITY, ZoneCore } from './core.ts';
import { Harness, T0, effects, fixtureWorld, frame, msgs, player } from './testing.ts';

let h: Harness;
afterEach(() => {
  // R-NET-001: every message the core sent matched its protocol schema.
  expect(h.problems).toEqual([]);
});

describe('zone presence (R-WORLD-001)', () => {
  it('R-WORLD-001 join at the spawn or a saved position; hello answers zsnap; others see zjoin', () => {
    h = Harness.of();
    const a = h.enter(player('a'));
    const snap = msgs(a, 'a', 'zsnap')[0]?.d;
    expect(snap).toMatchObject({
      zone: 'town',
      channel: 0,
      you: { p: 'a', x: 1, y: 1, dir: 's' },
      players: [],
      challengeZone: false,
      quests: [],
    });
    expect(snap?.npcs.map((n) => n.id)).toEqual(['prof', 'kid', 'elder', 'rival', 'coach']);
    const b = h.enter(player('b', { x: 4, y: 4, dir: 'e' }));
    expect(msgs(b, 'a', 'zjoin')[0]?.d).toEqual({
      p: 'b',
      name: 'B',
      x: 4,
      y: 4,
      dir: 'e',
      battling: false,
      level: 5,
    });
    expect(msgs(b, 'b', 'zsnap')[0]?.d.players.map((p) => p.p)).toEqual(['a']);
    // A saved position on a wall (or outside the map) falls back to the spawn.
    const c = h.enter(player('c', { x: 0, y: 0 }));
    expect(msgs(c, 'c', 'zsnap')[0]?.d.you).toEqual({ p: 'c', x: 1, y: 1, dir: 's' });
  });

  it('R-WORLD-001 nothing is broadcast to a player before its hello', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.core.join(player('b'), h.tick());
    const out = h.step('a', 'e');
    expect(out.send.filter((o) => o.to === 'b')).toEqual([]);
    const hello = h.send('b', 'hello', {});
    expect(msgs(hello, 'b', 'zsnap')[0]?.d.players[0]).toMatchObject({ p: 'a', x: 2, y: 1 });
  });

  it('R-WORLD-001 a channel holds 60 players; the 61st is refused so the host opens another', () => {
    h = Harness.of();
    for (let i = 0; i < ZONE_CAPACITY; i++)
      expect(h.core.join(player(`p${i}`), h.tick()).refused).toBeNull();
    expect(h.core.full).toBe(true);
    const r = h.core.join(player('late'), h.tick());
    expect(r.refused).toBe('full');
    expect(h.core.has('late')).toBe(false);
    // A player already inside reconnecting is not refused.
    expect(h.core.join(player('p0'), h.tick()).refused).toBeNull();
    expect(h.core.size).toBe(ZONE_CAPACITY);
  });

  it('R-WORLD-001 a reconnect keeps the channel position; leave broadcasts zleave', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    h.walk('a', 'ee');
    const again = h.enter(player('a', { level: 6 }));
    expect(msgs(again, 'a', 'zsnap')[0]?.d.you).toEqual({ p: 'a', x: 3, y: 1, dir: 'e' });
    expect(msgs(again, 'b', 'zjoin')).toEqual([]);
    expect(h.me('a').level).toBe(6);
    const out = h.core.leave('a', h.tick());
    expect(msgs(out, 'b', 'zleave')[0]?.d).toEqual({ p: 'a' });
    expect(h.core.has('a')).toBe(false);
  });
});

describe('steps and walls (R-WORLD-001, R-SEC-002)', () => {
  it('R-WORLD-001 a step moves one tile and is broadcast to the others only', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    const out = h.step('a', 'e');
    expect(msgs(out, 'b', 'zstep')[0]?.d).toEqual({ p: 'a', x: 2, y: 1, dir: 'e' });
    expect(out.send.filter((o) => o.to === 'a')).toEqual([]);
    expect(h.me('a')).toMatchObject({ x: 2, y: 1, dir: 'e' });
    // Positions are not persisted per step (R-COST-002).
    expect(out.save).toBe(false);
    expect(out.effects).toEqual([]);
  });

  it('R-WORLD-001 a step into a wall or an NPC only turns and answers zpos', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.enter(player('b'));
    const wall = h.step('a', 'n');
    expect(msgs(wall, 'a', 'zpos')[0]?.d).toEqual({ x: 1, y: 1, dir: 'n' });
    expect(msgs(wall, 'b', 'zstep')[0]?.d).toEqual({ p: 'a', x: 1, y: 1, dir: 'n' });
    // Facing the same wall again: zpos only, nothing broadcast.
    const again = h.step('a', 'n');
    expect(msgs(again, 'a', 'zpos')).toHaveLength(1);
    expect(msgs(again, 'b', 'zstep')).toEqual([]);
    // The professor stands on (3,3): walk to (3,2) and step south into him.
    h.walk('a', 'eess');
    expect(h.me('a')).toMatchObject({ x: 3, y: 2, dir: 's' });
    const npc = h.step('a', 's');
    expect(msgs(npc, 'a', 'zpos')[0]?.d).toEqual({ x: 3, y: 2, dir: 's' });
  });

  it('R-WORLD-001 a player in a battle stays on the tile', () => {
    h = Harness.of();
    h.enter(player('a'));
    h.walk('a', 'ees');
    h.send('a', 'interact', { npc: 'prof' });
    h.send('a', 'choose', { npc: 'prof', option: 'lesson:ember-basics' });
    expect(h.me('a').battling).toBe(true);
    const out = h.step('a', 'w');
    expect(msgs(out, 'a', 'zpos')[0]?.d).toEqual({ x: 3, y: 2, dir: 's' });
    expect(h.me('a')).toMatchObject({ x: 3, y: 2 });
  });
});

describe('rate limits (R-SEC-005)', () => {
  it('R-SEC-005 steps are limited to 8 per second: excess is dropped, counted and snapped back', () => {
    h = Harness.of();
    h.enter(player('a', { x: 1, y: 5 }));
    const t = h.tick();
    let moved = 0;
    let snapped = 0;
    for (let i = 0; i < 12; i++) {
      const out = h.core.message('a', frame('step', { dir: i % 2 ? 'w' : 'e' }), t);
      if (msgs(out, 'a', 'zpos').length > 0) snapped++;
      else moved++;
    }
    expect(moved).toBe(LIMITS.step.burst);
    expect(snapped).toBe(12 - LIMITS.step.burst);
    // One second later the bucket has refilled 8 tokens.
    const later = t + 1000;
    for (let i = 0; i < 8; i++)
      expect(msgs(h.core.message('a', frame('step', { dir: 'e' }), later), 'a', 'zpos')).toEqual(
        [],
      );
    const report = effects(h.core.flushTelemetry(later), 'telemetry')[0]?.report;
    expect(report?.dropped.rate).toBe(4);
    expect(report?.in.step).toBe(16);
  });

  it('R-SEC-005 chat is 1 per second with a burst of 5', () => {
    h = Harness.of();
    h.enter(player('a'));
    const t = h.tick();
    const sent = Array.from({ length: 7 }, (_, i) =>
      h.core.message('a', frame('chat', { ch: 'zone', text: `hi ${i}` }), t),
    );
    expect(sent.filter((o) => msgs(o, 'a', 'chatmsg').length === 1)).toHaveLength(5);
    // The first drop in a run answers rate_limited; the next is silent.
    expect(msgs(sent[5] ?? { send: [], effects: [], save: false }, 'a', 'err')[0]?.d.code).toBe(
      'rate_limited',
    );
    expect(msgs(sent[6] ?? { send: [], effects: [], save: false }, 'a', 'err')).toEqual([]);
    const next = h.core.message('a', frame('chat', { ch: 'zone', text: 'again' }), t + 1000);
    expect(msgs(next, 'a', 'chatmsg')).toHaveLength(1);
  });

  it('R-SEC-005 invalid frames are dropped and counted; repeat offenders get a close effect', () => {
    h = Harness.of();
    h.enter(player('a'));
    const bad = ['not json', frame('warp', {}), frame('step', { dir: 'up' }), 42, 'x'.repeat(5000)];
    const first = h.core.message('a', bad[0], h.tick());
    expect(msgs(first, 'a', 'err')[0]?.d.code).toBe('bad_message');
    let closed = 0;
    for (let i = 1; i < MAX_STRIKES + 5; i++) {
      const out = h.core.message('a', bad[i % bad.length], h.tick());
      closed += effects(out, 'close').length;
      if (i < MAX_STRIKES - 1) expect(effects(out, 'close')).toEqual([]);
    }
    expect(closed).toBeGreaterThan(0);
    expect(effects(h.core.flushTelemetry(h.tick()), 'telemetry')[0]?.report.dropped.invalid).toBe(
      MAX_STRIKES + 5,
    );
  });

  it('R-SEC-005 valid messages in between do not keep a flood of invalid frames alive', () => {
    h = Harness.of();
    h.enter(player('a'));
    const t = h.tick();
    let closed = false;
    for (let i = 0; i < 4 * MAX_STRIKES && !closed; i++) {
      const out = h.core.message('a', i % 5 === 4 ? frame('hello', {}) : 'junk', t);
      closed = effects(out, 'close').length > 0;
    }
    expect(closed).toBe(true);
  });

  it('R-SEC-005 a flood of steps is closed after MAX_STRIKES drops in a row', () => {
    h = Harness.of();
    h.enter(player('a', { x: 1, y: 5 }));
    const t = h.tick();
    const outs = Array.from({ length: LIMITS.step.burst + MAX_STRIKES }, () =>
      h.core.message('a', frame('step', { dir: 'e' }), t),
    );
    expect(outs.slice(0, -1).flatMap((o) => effects(o, 'close'))).toEqual([]);
    expect(
      effects(outs.at(-1) ?? { send: [], effects: [], save: false }, 'close')[0],
    ).toMatchObject({ id: 'a', code: 1008 });
  });
});

describe('warps, banners and persistence (R-WORLD-001, R-COST-002)', () => {
  it('R-WORLD-001 a warp tile emits a warp effect and zwarp; leave then persists nothing', () => {
    h = Harness.of();
    h.enter(player('a', { x: 12, y: 7, dir: 's' }));
    const out = h.step('a', 's');
    expect(msgs(out, 'a', 'zwarp')[0]?.d).toEqual({ zone: 'route' });
    expect(effects(out, 'warp')).toEqual([
      { kind: 'warp', id: 'a', zone: 'route', x: 1, y: 1, dir: 's' },
    ]);
    expect(out.save).toBe(true);
    // Stale input after the warp is ignored.
    const stale = h.step('a', 'n');
    expect(stale.send).toEqual([]);
    expect(h.me('a')).toMatchObject({ x: 12, y: 8 });
    expect(effects(h.core.leave('a', h.tick()), 'persist')).toEqual([]);
  });

  it('R-COST-002 positions are persisted on leave (logout) only', () => {
    h = Harness.of();
    h.enter(player('a'));
    const walk = h.walk('a', 'eeesss');
    expect(effects(walk, 'persist')).toEqual([]);
    expect(walk.save).toBe(false);
    const out = h.core.leave('a', h.tick());
    expect(effects(out, 'persist')).toEqual([
      { kind: 'persist', id: 'a', zone: 'town', x: 4, y: 4, dir: 's' },
    ]);
  });

  it('R-WORLD-006 entering and leaving a challenge zone shows the banner', () => {
    h = Harness.of();
    h.enter(player('a', { x: 2, y: 5 }));
    const into = h.step('a', 's');
    expect(msgs(into, 'a', 'banner')[0]?.d).toEqual({ kind: 'challengeZone', inside: true });
    expect(msgs(h.step('a', 'e'), 'a', 'banner')).toEqual([]);
    const out = h.walk('a', 'nn');
    expect(msgs(out, 'a', 'banner').map((m) => m.d.inside)).toEqual([false]);
    // A player joining inside the zone learns it from zsnap.
    const b = h.enter(player('b', { x: 3, y: 7 }));
    expect(msgs(b, 'b', 'zsnap')[0]?.d.challengeZone).toBe(true);
  });

  it('R-WORLD-001 the core rejects an unknown zone and a malformed player', () => {
    h = Harness.of();
    expect(() => new ZoneCore(fixtureWorld(), { zone: 'nowhere', channel: 0 })).toThrow(/unknown/);
    expect(() => h.core.join(player(''), T0)).toThrow(/bad player/);
    expect(() => h.core.join(player('x', { level: 0 }), T0)).toThrow(/level/);
  });
});
