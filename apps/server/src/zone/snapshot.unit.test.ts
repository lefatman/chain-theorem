/**
 * Eviction safety and wire safety of the zone core (R-WORLD-001, R-SEC-005, R-COST-002, R-NET-001):
 * a seeded random session restored from a JSON snapshot mid-way behaves identically, every message
 * sent in it matches its protocol schema, and telemetry reports what happened.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../battle/testing.ts';
import { TELEMETRY_WINDOW_MS, ZoneCore } from './core.ts';
import { SeqRng, T0, effects, fixtureWorld, frame, observer, player } from './testing.ts';
import type { Outbox, ZoneSnapshot } from './types.ts';
import type { WorldRegistry } from './world.ts';

const DIRS = ['n', 's', 'e', 'w'] as const;
const TEXTS = ['hi', 'well shit', 'visit www.example.com', 'gg', 'call 555 123 4567'];
const IDS = ['a', 'b', 'kid', 'c'];

type Driver = (core: ZoneCore, t: number) => Outbox;

/** A deterministic script of inputs; decisions that need state read it from the core itself. */
function script(seed: number, n: number): Driver[] {
  const r = new Rng(seed);
  const out: Driver[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.pick(IDS);
    const roll = r.next();
    if (roll < 0.45) {
      const dir = r.pick(DIRS);
      out.push((core, t) => core.message(id, frame('step', { dir }), t));
    } else if (roll < 0.55) {
      const text = r.pick(TEXTS);
      const ch = r.chance(0.8) ? 'zone' : 'whisper';
      const to = r.pick(IDS);
      out.push((core, t) => core.message(id, frame('chat', { ch, text, to }), t));
    } else if (roll < 0.62) {
      const to = r.pick(IDS);
      out.push((core, t) => core.message(id, frame('chal', { to, format: 'first_blood' }), t));
    } else if (roll < 0.68) {
      const accept = r.chance(0.6);
      out.push((core, t) => {
        const c = core.snapshot().challenges.find((x) => x.to === id);
        return core.message(id, frame('chalReply', { id: c?.id ?? 'none', accept }), t);
      });
    } else if (roll < 0.8) {
      const result = r.pick(['win', 'loss', 'draw'] as const);
      const affinities = r.chance(0.5) ? (['tide'] as const) : (['ember'] as const);
      out.push((core, t) =>
        core.battleEnded(
          id,
          {
            result,
            kind: 'wild',
            format: 'first_blood',
            tier: 'wild',
            affinities: [...affinities],
          },
          t,
        ),
      );
    } else if (roll < 0.84) {
      const raw = r.chance(0.5) ? 'garbage' : frame('hello', {});
      out.push((core, t) => core.message(id, raw, t));
    } else if (roll < 0.87) {
      const filterChat = r.chance(0.5);
      out.push((core, t) => core.message(id, frame('prefs', { filterChat }), t));
    } else if (roll < 0.9) {
      out.push((core, t) => core.leave(id, t));
    } else {
      const x = 1 + r.int(10);
      const y = 1 + r.int(5);
      out.push((core, t) => {
        const o = core.join(player(id, { adult: id !== 'kid', x, y, friends: ['a', 'kid'] }), t);
        return core.has(id)
          ? { ...o, send: [...o.send, ...core.message(id, frame('hello', {}), t).send] }
          : o;
      });
    }
  }
  return out;
}

function times(seed: number, n: number): number[] {
  const r = new Rng(seed);
  let t = T0;
  return Array.from({ length: n }, () => (t += 20 + r.int(400)));
}

function session(world: WorldRegistry, rng: SeqRng, problems: string[]): ZoneCore {
  const core = new ZoneCore(
    world,
    { zone: 'route', channel: 2 },
    {
      rng: rng.next,
      observe: observer(problems),
    },
  );
  for (const id of IDS) {
    core.join(player(id, { adult: id !== 'kid', friends: ['a', 'kid'] }), T0);
    core.message(id, frame('hello', {}), T0);
  }
  return core;
}

describe('snapshot and restore (R-WORLD-001, R-COST-002)', () => {
  for (const seed of [1, 2, 3]) {
    it(`R-WORLD-001 R-SEC-005 a session restored mid-way behaves identically (seed ${seed})`, () => {
      const world = fixtureWorld({ routeRate: 0.3, routeGrace: 2 });
      const n = 1500;
      const steps = script(seed, n);
      const clock = times(seed + 100, n);
      const problems: string[] = [];
      const rng = new SeqRng(seed);
      const a = session(world, rng, problems);
      const cut = 700;
      for (let i = 0; i < cut; i++) steps[i]?.(a, clock[i] ?? T0);
      // Evicted: the host stored the snapshot as JSON; the RNG continues from where it was.
      const stored = JSON.stringify(a.snapshot());
      const snap = JSON.parse(stored) as ZoneSnapshot;
      expect(snap).toEqual(a.snapshot());
      const rngB = rng.clone();
      const problemsB: string[] = [];
      const b = ZoneCore.restore(world, snap, { rng: rngB.next, observe: observer(problemsB) });
      let battles = 0;
      for (let i = cut; i < n; i++) {
        const step = steps[i];
        if (!step) continue;
        const outA = step(a, clock[i] ?? T0);
        const outB = step(b, clock[i] ?? T0);
        expect(outB).toEqual(outA);
        battles += effects(outA, 'battle').length;
      }
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(rngB.calls).toBe(rng.calls);
      // The session exercised encounters and challenges, and every message matched its schema.
      expect(battles).toBeGreaterThan(0);
      expect(problems).toEqual([]);
      expect(problemsB).toEqual([]);
    });
  }

  it('R-WORLD-001 restore refuses an unknown snapshot version or zone', () => {
    const world = fixtureWorld();
    const core = new ZoneCore(world, { zone: 'town', channel: 0 });
    const snap = core.snapshot();
    expect(() => ZoneCore.restore(world, { ...snap, v: 2 as 1 })).toThrow(/version/);
    expect(() => ZoneCore.restore(world, { ...snap, zone: 'gone' })).toThrow(/unknown zone/);
  });
});

describe('telemetry (R-COST-002, 14.2)', () => {
  it('R-COST-002 counters by message type, drops and player time, reported once per window', () => {
    const world = fixtureWorld();
    const core = new ZoneCore(world, { zone: 'town', channel: 1 });
    core.join(player('a'), T0);
    core.join(player('b'), T0);
    core.message('a', frame('hello', {}), T0);
    core.message('a', frame('step', { dir: 'e' }), T0 + 100);
    core.message('a', 'junk', T0 + 200);
    core.message('a', frame('step', { dir: 'n' }), T0 + 300);
    const quiet = core.message('b', frame('hello', {}), T0 + 30_000);
    expect(effects(quiet, 'telemetry')).toEqual([]);
    const out = core.message(
      'b',
      frame('chat', { ch: 'zone', text: 'hi' }),
      T0 + TELEMETRY_WINDOW_MS,
    );
    const report = effects(out, 'telemetry')[0]?.report;
    expect(report).toMatchObject({
      zone: 'town',
      channel: 1,
      from: T0,
      to: T0 + TELEMETRY_WINDOW_MS,
      players: 2,
      playerMs: 2 * TELEMETRY_WINDOW_MS,
      in: { hello: 2, step: 2, chat: 1 },
      dropped: { rate: 0, invalid: 1, refused: 0 },
      encounters: 0,
      battles: 0,
    });
    // zsnap x2, zpos (the wall turn), err (junk), chatmsg x2; nothing is counted twice.
    expect(report?.out).toEqual({ zsnap: 2, zpos: 1, err: 1, chatmsg: 2 });
    // The next window starts empty.
    const next = effects(core.flushTelemetry(T0 + TELEMETRY_WINDOW_MS + 10), 'telemetry')[0]
      ?.report;
    expect(next).toMatchObject({ in: {}, out: {}, playerMs: 20 });
  });
});
