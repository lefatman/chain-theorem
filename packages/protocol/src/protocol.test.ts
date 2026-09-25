/**
 * Protocol schemas (R-NET-001) and rate limits (R-SEC-005). Invalid client input must be dropped,
 * never thrown on, since every socket message is untrusted (R-SEC-002).
 */
import { describe, expect, it } from 'vitest';
import {
  AuthStart,
  ClientBattle,
  ClientZone,
  CreateBattle,
  LIMITS,
  LoadoutBody,
  MAX_CLIENT_FRAME,
  MAX_STRIKES,
  ServerBattle,
  decode,
  encode,
  newBucket,
  strike,
  take,
  tooManyStrikes,
} from './index.ts';

describe('envelope and battle messages (R-NET-001)', () => {
  it('R-NET-001 decodes a valid move with its client sequence number', () => {
    const msg = decode(ClientBattle, JSON.stringify({ t: 'mv', s: 7, d: { move: 'e7e8q' } }));
    expect(msg).toEqual({ t: 'mv', s: 7, d: { move: 'e7e8q' } });
  });

  it('R-NET-001 messages without data default to an empty object', () => {
    expect(decode(ClientBattle, '{"t":"resign"}')).toEqual({ t: 'resign', d: {} });
  });

  it('R-NET-001 R-SEC-002 drops malformed, unknown, oversized and ill-typed frames', () => {
    const bad = [
      'not json',
      '{"t":"mv","d":{"move":"e2e9"}}',
      '{"t":"mv","d":{"move":"e2e4","choices":[{"kind":"piece","piece":99,"square":1}]}}',
      '{"t":"ch","d":{"promptId":"1.0","option":-1}}',
      '{"t":"ch","d":{"promptId":"x; drop","option":0}}',
      '{"t":"hack","d":{}}',
      '{"t":"__proto__","d":{}}',
      '{"t":"toString","d":{}}',
      '{"t":"mv","s":-1,"d":{"move":"e2e4"}}',
      '[1,2,3]',
      JSON.stringify({ t: 'mv', d: { move: 'e2e4', pad: 'x'.repeat(MAX_CLIENT_FRAME) } }),
    ];
    for (const raw of bad) expect(decode(ClientBattle, raw), raw.slice(0, 60)).toBeNull();
    expect(decode(ClientBattle, 42)).toBeNull();
  });

  it('R-NET-001 strips unknown keys from client data', () => {
    const msg = decode(ClientBattle, '{"t":"drawReply","d":{"accept":true,"admin":1}}');
    expect(msg).toEqual({ t: 'drawReply', d: { accept: true } });
  });

  it('R-NET-001 server messages round-trip through encode and decode', () => {
    const clocks = { white: 180_000, black: 179_000, running: 'black' as const, at: 1, inc: 2000 };
    const raw = encode(ServerBattle, {
      t: 'bev',
      d: { from: 3, to: 5, events: [{ k: 'MoveMade' }], public: { turn: 'black' }, clocks },
    });
    expect(decode(ServerBattle, raw, Infinity)).toEqual(JSON.parse(raw));
  });

  it('R-NET-001 zone steps accept only the four directions', () => {
    expect(decode(ClientZone, '{"t":"step","d":{"dir":"n"}}')).not.toBeNull();
    expect(decode(ClientZone, '{"t":"step","d":{"dir":"ne"}}')).toBeNull();
    expect(
      decode(ClientZone, JSON.stringify({ t: 'chat', d: { ch: 'zone', text: 'x'.repeat(201) } })),
    ).toBeNull();
  });
});

describe('REST bodies', () => {
  it('R-SEC-002 normalises emails and rejects malformed ones', () => {
    expect(AuthStart.parse({ email: '  Ada@Example.COM ' }).email).toBe('ada@example.com');
    expect(AuthStart.safeParse({ email: 'nope' }).success).toBe(false);
    expect(AuthStart.safeParse({ email: 'a@b.co', dob: '2010-13' }).success).toBe(false);
  });

  it('R-LOAD-004 loadout bodies are shape-checked before the rules engine validates them', () => {
    const ok = { elements: ['ember'], items: ['scouts_lens'], sets: [['cleave']] };
    expect(LoadoutBody.safeParse(ok).success).toBe(true);
    expect(LoadoutBody.safeParse({ ...ok, sets: [] }).success).toBe(false);
    expect(LoadoutBody.safeParse({ ...ok, items: ['../etc'] }).success).toBe(false);
    expect(LoadoutBody.safeParse({ ...ok, elements: ['a', 'b', 'c'] }).success).toBe(false);
  });

  it('R-FMT-005 NPC battles need a tier; challenge links do not', () => {
    expect(
      CreateBattle.safeParse({ kind: 'npc', format: 'full', loadoutId: 'x', tier: 'elite' })
        .success,
    ).toBe(true);
    expect(CreateBattle.safeParse({ kind: 'npc', format: 'full', loadoutId: 'x' }).success).toBe(
      false,
    );
    expect(
      CreateBattle.safeParse({ kind: 'challenge', format: 'blitz', loadoutId: 'x' }).success,
    ).toBe(false);
  });
});

describe('rate limits (R-SEC-005)', () => {
  it('R-SEC-005 battle sockets get a burst of 10, then 5 messages per second', () => {
    const b = newBucket(LIMITS.battle, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (take(b, LIMITS.battle, 0)) ok++;
    expect(ok).toBe(10);
    expect(b.dropped).toBe(10);
    // One second later five more are allowed.
    let later = 0;
    for (let i = 0; i < 10; i++) if (take(b, LIMITS.battle, 1000)) later++;
    expect(later).toBe(5);
  });

  it('R-SEC-005 chat allows 1 per second with a burst of 5; steps 8 per second', () => {
    const c = newBucket(LIMITS.chat, 0);
    expect([0, 0, 0, 0, 0, 0].map(() => take(c, LIMITS.chat, 0))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(take(c, LIMITS.chat, 1000)).toBe(true);
    const s = newBucket(LIMITS.step, 0);
    let steps = 0;
    for (let t = 0; t < 10_000; t += 25) if (take(s, LIMITS.step, t)) steps++;
    expect(steps).toBeLessThanOrEqual(8 + 8 * 10);
  });

  it('R-SEC-005 repeat offenders are flagged for disconnection; an accepted message resets strikes', () => {
    const b = newBucket(LIMITS.battle, 0);
    for (let i = 0; i < MAX_STRIKES - 1; i++) strike(b);
    expect(tooManyStrikes(b)).toBe(false);
    take(b, LIMITS.battle, 0);
    expect(tooManyStrikes(b)).toBe(false);
    for (let i = 0; i < MAX_STRIKES; i++) strike(b);
    expect(tooManyStrikes(b)).toBe(true);
  });
});
