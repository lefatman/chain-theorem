/**
 * PvP challenges (R-WORLD-004, R-WORLD-006, 9.3, DD-04): consent challenges anywhere; inside a
 * challenge zone, a challenge to another player inside in the same slot bracket starts at once in
 * the zone's format, never against someone battling or within 60 s after a battle.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { CHALLENGE_COOLDOWN_MS, CHALLENGE_TTL_MS, slotBracket } from './core.ts';
import { Harness, effects, msgs, player } from './testing.ts';
import type { BattleOutcome } from './types.ts';

let h: Harness;
afterEach(() => {
  expect(h.problems).toEqual([]);
});

const pvp: BattleOutcome = {
  result: 'win',
  kind: 'challenge',
  format: 'first_blood',
  affinities: [],
};

/** a (L5) and b (L9) inside the challenge zone, c (L10) inside, d (L5) outside. */
function setup(): Harness {
  h = Harness.of();
  h.enter(player('a', { x: 3, y: 6, level: 5 }));
  h.enter(player('b', { x: 4, y: 6, level: 9 }));
  h.enter(player('c', { x: 5, y: 7, level: 10 }));
  h.enter(player('d', { x: 3, y: 4, level: 5 }));
  return h;
}

const chal = (from: string, to: string, format = 'full') => h.send(from, 'chal', { to, format });

describe('challenge zones (R-WORLD-006)', () => {
  it('R-WORLD-006 slot brackets: 1-2, 3-4 and 5-6 unlocked item slots (9.3)', () => {
    h = Harness.of();
    expect([1, 5, 9].map((l) => slotBracket(engine, l))).toEqual([1, 1, 1]);
    expect([10, 19].map((l) => slotBracket(engine, l))).toEqual([2, 2]);
    expect([20, 25, 100].map((l) => slotBracket(engine, l))).toEqual([3, 3, 3]);
  });

  it('R-WORLD-006 inside, same bracket: the battle starts at once in the zone format', () => {
    setup();
    const out = chal('a', 'b', 'full');
    expect(effects(out, 'battle')).toEqual([
      {
        kind: 'battle',
        ref: 'town#0:1',
        battle: { kind: 'challenge', players: ['a', 'b'], format: 'first_blood', auto: true },
      },
    ]);
    expect(msgs(out, 'b', 'chalIn')).toEqual([]);
    for (const who of ['a', 'b', 'c', 'd'])
      expect(msgs(out, who, 'zbattle').map((m) => m.d)).toEqual([
        { p: 'a', battling: true },
        { p: 'b', battling: true },
      ]);
    expect(h.me('a').battling && h.me('b').battling).toBe(true);
    // The host created the battle: each player is told where to connect.
    const enc = h.core.battleStarted(
      'b',
      { battleId: 'battle-1', url: '/ws/battle/battle-1?t=x', kind: 'challenge' },
      h.tick(),
    );
    expect(msgs(enc, 'b', 'enc')[0]?.d).toEqual({
      battleId: 'battle-1',
      url: '/ws/battle/battle-1?t=x',
      kind: 'challenge',
    });
  });

  it('R-WORLD-006 no one can be challenged while in a battle', () => {
    setup();
    chal('a', 'b');
    const busy = chal('d', 'b');
    expect(msgs(busy, 'd', 'err')[0]?.d.code).toBe('busy');
    const self = chal('b', 'd');
    expect(msgs(self, 'b', 'err')[0]?.d.code).toBe('battling');
    expect(effects(busy, 'battle')).toEqual([]);
  });

  it('R-WORLD-006 no one can be challenged for 60 seconds after a battle', () => {
    setup();
    chal('a', 'b');
    h.core.battleEnded('a', pvp, h.tick());
    h.core.battleEnded('b', { ...pvp, result: 'loss' }, h.tick());
    // b is cooling down: neither a (also cooling) nor anyone else can start a battle with b.
    h.walk('d', 'ss');
    expect(h.me('d').inChallenge).toBe(true);
    const cooling = chal('d', 'b');
    expect(msgs(cooling, 'd', 'err')[0]?.d.code).toBe('cooldown');
    // Nor may a cooling player start one.
    const own = chal('a', 'd');
    expect(msgs(own, 'a', 'err')[0]?.d.code).toBe('cooldown');
    h.t += CHALLENGE_COOLDOWN_MS;
    const later = chal('d', 'b');
    expect(effects(later, 'battle')[0]?.battle).toMatchObject({ players: ['d', 'b'], auto: true });
  });

  it('R-WORLD-006 across brackets, or with anyone outside the zone, it takes consent', () => {
    setup();
    // c is level 10 (3 slots, bracket 2): a challenge from a (bracket 1) needs consent.
    const cross = chal('a', 'c', 'vanguard');
    expect(effects(cross, 'battle')).toEqual([]);
    expect(msgs(cross, 'c', 'chalIn')[0]?.d).toMatchObject({
      from: 'a',
      name: 'A',
      format: 'vanguard',
    });
    // d is outside: no automatic battle either way.
    expect(msgs(chal('a', 'd'), 'd', 'chalIn')).toHaveLength(1);
    expect(msgs(chal('d', 'a'), 'a', 'chalIn')).toHaveLength(1);
    expect(h.me('a').battling || h.me('d').battling).toBe(false);
  });

  it('R-WORLD-006 leaving the zone ends consent', () => {
    setup();
    const out = h.walk('b', 'nn');
    expect(msgs(out, 'b', 'banner').map((m) => m.d.inside)).toEqual([false]);
    const c = chal('a', 'b');
    expect(effects(c, 'battle')).toEqual([]);
    expect(msgs(c, 'b', 'chalIn')).toHaveLength(1);
  });
});

describe('consent challenges (R-WORLD-004)', () => {
  it('R-WORLD-004 a challenge the other player accepts starts a battle in the chosen format', () => {
    setup();
    const out = chal('d', 'a', 'vanguard');
    const id = msgs(out, 'a', 'chalIn')[0]?.d.id ?? '';
    // Only the challenged player can answer.
    expect(msgs(h.send('c', 'chalReply', { id, accept: true }), 'c', 'err')[0]?.d.code).toBe(
      'no_challenge',
    );
    const yes = h.send('a', 'chalReply', { id, accept: true });
    expect(effects(yes, 'battle')[0]?.battle).toEqual({
      kind: 'challenge',
      players: ['d', 'a'],
      format: 'vanguard',
      auto: false,
    });
    // Answered challenges are gone.
    expect(msgs(h.send('a', 'chalReply', { id, accept: true }), 'a', 'err')[0]?.d.code).toBe(
      'no_challenge',
    );
  });

  it('R-WORLD-004 a declined challenge tells the challenger; nothing starts', () => {
    setup();
    const id = msgs(chal('d', 'a'), 'a', 'chalIn')[0]?.d.id ?? '';
    const no = h.send('a', 'chalReply', { id, accept: false });
    expect(msgs(no, 'd', 'err')[0]?.d.code).toBe('chal_declined');
    expect(effects(no, 'battle')).toEqual([]);
  });

  it('R-WORLD-004 challenges lapse after 60 s, and when a player leaves', () => {
    setup();
    const id = msgs(chal('d', 'a'), 'a', 'chalIn')[0]?.d.id ?? '';
    h.t += CHALLENGE_TTL_MS;
    expect(msgs(h.send('a', 'chalReply', { id, accept: true }), 'a', 'err')[0]?.d.code).toBe(
      'no_challenge',
    );
    const id2 = msgs(chal('d', 'a'), 'a', 'chalIn')[0]?.d.id ?? '';
    h.core.leave('d', h.tick());
    expect(msgs(h.send('a', 'chalReply', { id: id2, accept: true }), 'a', 'err')[0]?.d.code).toBe(
      'no_challenge',
    );
    expect(h.core.snapshot().challenges).toEqual([]);
  });

  it('R-WORLD-004 one open challenge per challenger; targets must be here and not yourself', () => {
    setup();
    const first = msgs(chal('d', 'a'), 'a', 'chalIn')[0]?.d.id ?? '';
    chal('d', 'c');
    expect(h.core.snapshot().challenges.map((c) => c.to)).toEqual(['c']);
    expect(msgs(h.send('a', 'chalReply', { id: first, accept: true }), 'a', 'err')[0]?.d.code).toBe(
      'no_challenge',
    );
    expect(msgs(chal('d', 'nobody'), 'd', 'err')[0]?.d.code).toBe('not_here');
    expect(msgs(chal('d', 'd'), 'd', 'err')[0]?.d.code).toBe('bad_target');
  });

  it('R-WORLD-004 accepting while the challenger is battling is refused', () => {
    setup();
    const id = msgs(chal('d', 'a'), 'a', 'chalIn')[0]?.d.id ?? '';
    // b and c are in the zone but in different brackets; c challenges d with consent first.
    const id2 = msgs(chal('c', 'd'), 'd', 'chalIn')[0]?.d.id ?? '';
    h.send('d', 'chalReply', { id: id2, accept: true });
    expect(h.me('d').battling).toBe(true);
    const late = h.send('a', 'chalReply', { id, accept: true });
    expect(msgs(late, 'a', 'err')[0]?.d.code).toBe('busy');
    expect(effects(late, 'battle')).toEqual([]);
  });
});
