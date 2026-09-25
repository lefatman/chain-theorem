/**
 * The R-SEC-001 projection scanner used by the fuzzer must itself catch leaks (review finding #23).
 * Each case feeds it a hand-made leaky payload next to the real one.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@chain-theorem/rules';
import { engine } from '../index.ts';
import { scanPayload } from '../src/scan.ts';
import { setup } from '../src/testing.ts';

function battle(): GameState {
  return setup({
    fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
    white: {
      elements: ['ember'],
      abilities: ['momentum', 'veil'],
      items: ['masquerade_mask'],
      itemParams: { masquerade_mask: { element: 'tide' } },
    },
  }).state;
}

describe('fuzz projection scanner (R-SEC-001)', () => {
  it('R-SEC-001 the real projection passes', () => {
    const state = battle();
    expect(scanPayload(engine.project(state, 'black'), state, 'black')).toBeNull();
    expect(scanPayload(engine.project(state, 'white'), state, 'white')).toBeNull();
  });

  it('R-SEC-001 an unrevealed ability name anywhere in the payload is a leak', () => {
    const state = battle();
    const pub = engine.project(state, 'black');
    expect(scanPayload({ ...pub, note: 'momentum' }, state, 'black')).toMatch(/momentum/);
  });

  it('R-SEC-001 DD-45 a hidden activation carrying its category or attunement is a leak', () => {
    const state = battle();
    const ev = {
      k: 'AbilityTriggered',
      side: 'white',
      piece: 1,
      pieceType: 'knight',
      ability: null,
      category: 'CAPTURES',
      attuned: null,
    };
    expect(scanPayload([ev], state, 'black')).toMatch(/category or attuned/);
    expect(scanPayload([{ ...ev, category: null }], state, 'black')).toBeNull();
  });

  it('R-SEC-001 R-INFO-002 a name shown on a piece type it was not revealed for is a leak', () => {
    const state = battle();
    const known: GameState = {
      ...state,
      reveals: {
        ...state.reveals,
        white: { ...state.reveals.white, abilities: { pawn: ['momentum'] } },
      },
    };
    const ev = {
      k: 'ChargeSpent',
      side: 'white',
      piece: 1,
      pieceType: 'knight',
      ability: 'momentum',
    };
    expect(scanPayload([ev], known, 'black')).toMatch(/not revealed for that type/);
    expect(scanPayload([{ ...ev, pieceType: 'pawn' }], known, 'black')).toBeNull();
  });

  it('R-SEC-001 DD-26 a true element under an active Mask, or an opponent pending burn, is a leak', () => {
    const state = battle();
    const pub = engine.project(state, 'black');
    const knight = pub.pieces.find((p) => p.side === 'white' && p.type === 'knight');
    expect(knight?.element).toBe('tide');
    const leaky = {
      ...pub,
      pieces: pub.pieces.map((p) => (p === knight ? { ...p, element: 'ember' } : p)),
    };
    expect(scanPayload(leaky, state, 'black')).toMatch(/active Mask/);
    const pending = {
      ...pub,
      slices: {
        ...pub.slices,
        hot_foot: { burning: [], pending: [{ piece: knight?.id, sq: 35 }] },
      },
    };
    expect(scanPayload(pending, state, 'black')).toMatch(/pending/);
  });
});
