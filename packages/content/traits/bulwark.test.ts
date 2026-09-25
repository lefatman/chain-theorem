/**
 * Bulwark scenario tests (Stone trait, R-ELEM-001, DD-19, DD-35). The engine supports all six
 * elements (6.5); tests use Stone directly.
 *
 * Expected behaviour comes from spec 5.1, 5.4, 5.5 E3/E5, 6.1 (Bulwark), 6.4 and DD-19 and DD-35,
 * not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';
import type { BulwarkState } from './bulwark.ts';

const sq = parseSquare;
const BULWARK = { kind: 'trait', id: 'bulwark', element: 'stone' };
const spent = (s: { slices: Record<string, unknown> }) => (s.slices.bulwark as BulwarkState).spent;

describe('bulwark (R-ELEM-001)', () => {
  it('R-ELEM-001 the first effect capture targeting a Stone piece fizzles (bulwark); the second one lands', () => {
    // 1. Nc3xd5 (Poisoned Meat fizzles) 1... Kd8 2. Nd5xb4 (Poisoned Meat removes the knight).
    const r = scenario({
      fen: '4k3/8/8/3p4/1p6/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5b4'],
    });
    const knight = idAt(r.initial, 'c3');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'AbilityTriggered').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(eventsOf(first, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        side: 'black',
        ability: 'poisoned_meat',
        reason: 'bulwark',
        target: knight,
        source: BULWARK,
      }),
    ]);
    expect(eventsOf(first, 'Captured')).toHaveLength(1);
    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(third, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('b4'), by: 'move' }),
      expect.objectContaining({ victim: knight, square: sq('b4'), by: 'effect' }),
    ]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(spent(r.state)).toEqual([knight]);
  });

  it('R-ELEM-001 Bulwark is per piece: each Stone piece blocks its own first effect capture', () => {
    const r = scenario({
      fen: '4k3/8/8/3pp3/8/2N2N2/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'f3e5'],
    });
    const a = idAt(r.initial, 'c3');
    const b = idAt(r.initial, 'f3');
    expect(eventsOf(r.events, 'EffectFizzled').map((e) => [e.reason, e.target])).toEqual([
      ['bulwark', a],
      ['bulwark', b],
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(a);
    expect(pieceAt(r.state, 'e5')?.id).toBe(b);
    expect([...spent(r.state)].sort()).toEqual([a, b].sort());
  });

  it('R-ELEM-001 R-ABIL-001 Bulwark does not stop a move capture and is not spent by one', () => {
    const r = scenario({
      fen: '4k3/8/8/3n4/8/2N5/8/4K3 b - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'] },
      moves: ['d5c3'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ victim: knight, by: 'move' }),
    ]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(spent(r.state)).toEqual([]);
  });

  it('R-ELEM-001 R-ELEM-004 Bulwark protects only Stone pieces (per piece under Blended Family)', () => {
    // Stone knight (group A) survives Poisoned Meat; the Ember rook (group B) does not.
    const r = scenario({
      fen: '4k3/8/8/p2p4/8/2N5/8/R3K3 w - - 0 1',
      white: { elements: ['stone', 'ember'], items: ['blended_family'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8f8', 'a1a5'],
    });
    const knight = idAt(r.initial, 'c3');
    const rook = idAt(r.initial, 'a1');
    expect(eventsOf(r.steps[0]?.events ?? [], 'EffectFizzled')).toEqual([
      expect.objectContaining({ reason: 'bulwark', target: knight }),
    ]);
    expect(eventsOf(r.steps[2]?.events ?? [], 'EffectFizzled')).toEqual([]);
    expect(eventsOf(r.steps[2]?.events ?? [], 'Captured')).toEqual([
      expect.objectContaining({ square: sq('a5'), by: 'move' }),
      expect.objectContaining({ victim: rook, by: 'effect' }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(spent(r.state)).toEqual([knight]);
  });

  it('R-ELEM-001 DD-35 Bulwark is spent before Antidote: the first retaliation fizzles as bulwark, the next as protected', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/1p6/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5b4'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.steps[0]?.events ?? [], 'EffectFizzled')).toEqual([
      expect.objectContaining({ reason: 'bulwark', target: knight, source: BULWARK }),
    ]);
    expect(eventsOf(r.steps[2]?.events ?? [], 'EffectFizzled')).toEqual([
      expect.objectContaining({
        reason: 'protected',
        target: knight,
        source: expect.objectContaining({ kind: 'ability', id: 'antidote' }),
      }),
    ]);
    expect(pieceAt(r.state, 'b4')?.id).toBe(knight);
  });

  it('R-ELEM-001 DD-35 R-RULES-004 Royal Immunity comes first: an effect capture against a Stone king does not spend Bulwark', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'royal_immunity' }),
    ]);
    expect(spent(r.state)).toEqual([]);
  });

  it('R-ELEM-001 DD-35 E5 INV-03 comes before Bulwark: a fizzle for king safety does not spend it', () => {
    const r = scenario({
      fen: '4q2k/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'inv03' }),
    ]);
    expect(pieceAt(r.state, 'e5')?.type).toBe('rook');
    expect(spent(r.state)).toEqual([]);
  });

  it('R-ELEM-001 DD-19 protected Stone pawns are still offered as targets, and the chosen effect fizzles', () => {
    // A neutral knight with Cleave takes the Stone pawn d5; both c6 and e6 are offered.
    const r = scenario({
      fen: '4k3/8/2p1p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['cleave'] },
      black: { elements: ['stone'] },
      moves: ['c3d5'],
      answers: [(req) => req.options.findIndex((o) => o.kind === 'piece' && o.square === sq('c6'))],
    });
    const pc6 = idAt(r.initial, 'c6');
    const pe6 = idAt(r.initial, 'e6');
    expect(r.prompts[0]?.options).toEqual([
      { kind: 'piece', piece: pc6, square: sq('c6') },
      { kind: 'piece', piece: pe6, square: sq('e6') },
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'cleave', reason: 'bulwark', target: pc6 }),
    ]);
    expect(pieceAt(r.state, 'c6')?.id).toBe(pc6);
    expect(spent(r.state)).toEqual([pc6]);
  });

  it('R-ELEM-001 R-INFO-005 Bulwark state is public: both players see which pieces have spent it', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    for (const viewer of ['white', 'black'] as const)
      expect(r.engine.project(r.state, viewer).slices.bulwark, viewer).toEqual({ spent: [knight] });
  });
});
