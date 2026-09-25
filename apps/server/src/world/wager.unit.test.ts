/**
 * Who takes a wager's stakes (M6 6.1, 9.5 R-FMT-006, COMMITTED): the winner receives both, a draw
 * returns them, and abandonment is a loss. The battle is played by the real BattleCore, then its
 * `ended` summary is mapped exactly as `settleBattle` maps it.
 */
import { describe, expect, it } from 'vitest';
import { DISCONNECT_GRACE_MS } from '@chain-theorem/content';
import type { Loadout } from '@chain-theorem/rules';
import { BattleCore, type BattleInit, type Effect, type Outbox } from '../battle/index.ts';
import { frame } from '../battle/testing.ts';
import { wagerSettlement } from './wager.ts';

const T0 = 1_750_000_000_000;
const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };
const INIT: BattleInit = {
  battleId: 'wager-battle',
  format: 'first_blood',
  white: { playerId: 'p-white', name: 'Ada', level: 5, loadout: PLAIN },
  black: { playerId: 'p-black', name: 'Bo', level: 5, loadout: PLAIN },
};

function ended(out: Outbox): Extract<Effect, { kind: 'ended' }> {
  const e = out.effects.find((x): x is Extract<Effect, { kind: 'ended' }> => x.kind === 'ended');
  if (!e) throw new Error('the battle did not end');
  return e;
}

describe('wager settlement (9.5)', () => {
  it('R-FMT-006 abandonment is a loss: a seat that never comes back loses its stake', () => {
    const { core } = BattleCore.create(INIT, T0);
    core.connect('white', T0 + 100);
    core.message('white', frame('hello', { from: 0 }), T0 + 100);
    core.message('white', frame('mv', { move: 'd2d4' }), T0 + 200);
    const e = ended(core.alarm(T0 + DISCONNECT_GRACE_MS));
    expect(e.summary.result).toEqual({ winner: 'white', reason: 'abandon' });
    expect(wagerSettlement(e.summary, e.archive)).toEqual({
      winnerId: 'p-white',
      seats: { whiteId: 'p-white', blackId: 'p-black' },
    });
  });

  it('R-FMT-006 the winner takes both stakes; an agreed draw names nobody (the stakes return)', () => {
    const { core } = BattleCore.create(INIT, T0);
    for (const side of ['white', 'black'] as const) {
      core.connect(side, T0 + 10);
      core.message(side, frame('hello', { from: 0 }), T0 + 10);
    }
    const resign = ended(core.message('white', frame('resign'), T0 + 500));
    expect(wagerSettlement(resign.summary, resign.archive).winnerId).toBe('p-black');

    const { core: c2 } = BattleCore.create({ ...INIT, battleId: 'wager-draw' }, T0);
    for (const side of ['white', 'black'] as const) {
      c2.connect(side, T0 + 10);
      c2.message(side, frame('hello', { from: 0 }), T0 + 10);
    }
    c2.message('white', frame('draw'), T0 + 100);
    const draw = ended(c2.message('black', frame('drawReply', { accept: true }), T0 + 200));
    expect(draw.summary.result.winner).toBeNull();
    expect(wagerSettlement(draw.summary, draw.archive).winnerId).toBeNull();
  });
});
