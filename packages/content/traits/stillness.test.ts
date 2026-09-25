/**
 * Stillness scenario tests (Frost trait, R-ELEM-001, R-ELEM-002, DD-30, DD-36). The engine supports
 * all six elements (6.5); tests use Frost directly.
 *
 * Expected behaviour comes from spec 5.1, 5.3, 6.1 (Stillness), 6.2, 6.4, 8.2 and DD-30 and DD-36,
 * not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ElementId } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';
import type { ResonanceState } from '../items/resonance_crystal.ts';

const sq = parseSquare;
const STILLNESS = { kind: 'trait', id: 'stillness', element: 'frost' };
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('stillness (R-ELEM-001)', () => {
  it('R-ELEM-001 a piece that captures a Frost piece has its Captures abilities negated (revealed as negated)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'white',
        piece: knight,
        ability: 'hit_and_run',
        category: 'CAPTURES',
        source: STILLNESS,
      }),
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'knight', ability: 'hit_and_run' },
        cause: 'negated',
      }),
    );
    expect(r.state.reveals.white.abilities.knight).toContain('hit_and_run');
  });

  it("R-ELEM-001 Stillness negates only the captor's Captures abilities: its Capturing abilities and the victim's Captured abilities still fire", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['scout', 'hit_and_run'] },
      black: { elements: ['frost'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'scout',
      'last_word',
    ]);
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['hit_and_run']);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
  });

  it('R-ELEM-001 R-ELEM-004 Stillness lasts only for that capture and follows the victim piece element (Blended Family)', () => {
    // Black: Frost pawns (group A), Ember rook (group B). 1. Nxd5 (Frost) ... 2. Nxf6 (Ember).
    const r = scenario({
      fen: '4k3/8/5r2/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['frost', 'ember'], items: ['blended_family'] },
      moves: ['c3d5', 'e8d8', 'd5f6'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.steps[0]?.events ?? [], 'AbilityNegated').map((e) => e.ability)).toEqual([
      'hit_and_run',
    ]);
    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'AbilityNegated')).toEqual([]);
    expect(eventsOf(third, 'AbilityTriggered').map((e) => e.ability)).toEqual(['hit_and_run']);
    expect(eventsOf(third, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('f6'), to: sq('d5') }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });

  it("R-ELEM-001 a Frost captor's own Captures abilities are not negated by Stillness", () => {
    // Stone is beaten by Frost (only the victim could be silenced); the others are unrelated.
    const victims: ElementId[] = ['neutral', 'ember', 'tide', 'stone'];
    for (const victim of victims) {
      const r = scenario({
        fen: FEN,
        white: { elements: ['frost'], abilities: ['hit_and_run'] },
        black: { elements: [victim] },
        moves: ['c3d5'],
      });
      expect(eventsOf(r.events, 'AbilityNegated'), victim).toEqual([]);
      expect(
        eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability),
        victim,
      ).toEqual(['hit_and_run']);
      expect(pieceAt(r.state, 'c3')?.type, victim).toBe('knight');
    }
  });

  it('R-ELEM-002 DD-36 negation takes precedence over silence: a Stone captor of a Frost piece has Capturing silenced and Captures negated', () => {
    // Frost beats Stone, so the Stone captor is disadvantaged (6.2).
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['scout', 'hit_and_run'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    const pawn = idAt(r.initial, 'd5');
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ ability: 'scout', category: 'CAPTURING', by: pawn }),
    ]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', source: STILLNESS }),
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
  });

  it('R-ELEM-001 DD-30 a trigger negated by Stillness is not silenced, so it does not consume a Resonance Crystal', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['hit_and_run'], items: ['resonance_crystal'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['hit_and_run']);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect((r.state.slices.resonance_crystal as ResonanceState).used.white).toBeNull();
    expect(r.state.reveals.white.items).not.toContain('resonance_crystal');
  });

  it('R-ELEM-001 R-ABIL-003 Stillness also applies to a bonus-action capture of a Frost piece (Riposte, depth 1)', () => {
    const run = (white: ElementId) =>
      scenario({
        fen: '4k3/5b2/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { elements: [white] },
        black: { elements: ['neutral'], abilities: ['riposte', 'hit_and_run'] },
        moves: ['c3d5'],
        answers: [{ kind: 'move', from: sq('f7'), to: sq('d5') }],
      });
    const frost = run('frost');
    const bishop = idAt(frost.initial, 'f7');
    expect(eventsOf(frost.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        side: 'black',
        piece: bishop,
        ability: 'hit_and_run',
        source: STILLNESS,
        depth: 1,
      }),
    ]);
    expect(pieceAt(frost.state, 'd5')?.id).toBe(bishop);

    const plain = run('neutral');
    expect(eventsOf(plain.events, 'AbilityNegated')).toEqual([]);
    expect(
      eventsOf(plain.events, 'AbilityTriggered').map((e) => [e.ability, e.piece, e.depth]),
    ).toEqual([
      ['riposte', idAt(plain.initial, 'd5'), 0],
      ['hit_and_run', bishop, 1],
    ]);
    expect(pieceAt(plain.state, 'f7')?.id).toBe(bishop);
    expect(pieceAt(plain.state, 'd5')).toBeUndefined();
  });
});
