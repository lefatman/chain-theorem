/**
 * Snowdrift scenario tests (R-ABIL-005, M7 7.3): Captures, Frost, all. After capturing, the owner
 * moves one enemy knight, bishop, rook or queen adjacent to the landing square to another empty
 * square adjacent to it. Attuned (Frost bearer): the captor's origin square is offered too.
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 5.2 (MOVE, CHOSEN), 5.4, 6.1 (Stillness), 6.3 and
 * DD-18, DD-19, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// Knight c3 takes d5. Next to d5: a black knight e6 (can drift) and a black pawn c6 (cannot).
const FEN = '4k3/8/2p1n3/3p4/8/2N5/8/4K3 w - - 0 1';
const squares = (opts: readonly { kind: string; square?: number }[]) =>
  opts.map((o) => (o.kind === 'square' ? o.square : -1));

describe('snowdrift (R-ABIL-005)', () => {
  it('R-ABIL-005 snowdrift is a level-9, 1-slot Frost After-capturing card', () => {
    expect(abilityById.get('snowdrift')).toMatchObject({
      category: 'CAPTURES',
      affinity: 'frost',
      eligible: 'all',
      tags: [],
      minLevel: 9,
      slotCost: 1,
    });
  });

  it('R-ABIL-002 DD-18 the only candidate is chosen without a prompt, then the owner picks its new square in square order', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['snowdrift'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('e4') }],
    });
    const knight = idAt(r.initial, 'e6');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.kind).toBe('square');
    expect(r.prompts[0]?.chooser).toBe('white');
    expect(squares(r.prompts[0]?.options ?? [])).toEqual(
      ['c4', 'd4', 'e4', 'c5', 'e5', 'd6'].map(sq),
    );
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('e6'), to: sq('e4') }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(knight);
    expect(pieceAt(r.state, 'c6')?.type).toBe('pawn');
  });

  it('R-ABIL-004 pawns and kings never drift: with only those next to the landing square it fizzles (no target)', () => {
    const r = scenario({
      fen: '8/8/2p5/3pk3/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['snowdrift'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'snowdrift', effect: 'move', reason: 'no_target' }),
    ]);
  });

  it('R-ELEM-003 attuned (Frost bearer): the captor’s origin is offered too', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['frost'], abilities: ['snowdrift'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('c3') }],
    });
    expect(squares(r.prompts[0]?.options ?? [])).toContain(sq('c3'));
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
    expect(pieceAt(r.state, 'c3')?.side).toBe('black');
  });

  it('INV-03 DD-19 a square that would check the acting player’s king is never offered', () => {
    // The black rook c6 could land on e4 or e5, checking the white king e1 down the e-file.
    const r = scenario({
      fen: '4k3/8/2r5/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['snowdrift'] },
      moves: ['c3d5'],
      answers: [0],
    });
    const offered = squares(r.prompts[0]?.options ?? []);
    expect(offered).not.toContain(sq('e4'));
    expect(offered).not.toContain(sq('e5'));
    expect(offered).toContain(sq('d6'));
  });

  it('R-ELEM-001 Stillness negates it when the victim is a Frost piece', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['snowdrift'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['snowdrift']);
    expect(pieceAt(r.state, 'e6')?.type).toBe('knight');
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Snowdrift', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['snowdrift'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('snowdrift');
  });
});
