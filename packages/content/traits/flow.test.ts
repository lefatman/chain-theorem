/**
 * Flow scenario tests (Tide trait, R-ELEM-001, R-ELEM-006, E8, DD-24).
 *
 * Expected behaviour comes from spec 6.1 (Flow rules), 5.5 E8, 6.4 and DD-24, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type ElementId,
  type Engine,
  type GameState,
  type Side,
  moveToUci,
  squareName,
} from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, play, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;

function legal(engine: Engine, state: GameState, side: Side): string[] {
  return engine.legalMoves(state, side).map(moveToUci);
}

/** Destination square names of the legal moves of the piece on `from`, sorted. */
function dests(engine: Engine, state: GameState, side: Side, from: string): string[] {
  return engine
    .legalMoves(state, side)
    .filter((m) => m.from === sq(from))
    .map((m) => squareName(m.to))
    .sort();
}

const sorted = (xs: string[]) => [...xs].sort();

function start(fen: string, white: ElementId[], black: ElementId[] = ['neutral']) {
  return setup({
    fen,
    white: { elements: white, ...(white.length === 2 ? { items: ['blended_family'] } : {}) },
    black: { elements: black },
  });
}

describe('flow (R-ELEM-006)', () => {
  it('R-ELEM-006 E8 a Tide rook behind its own pawn checks the enemy king along the file', () => {
    const s = start('k7/8/8/8/8/8/P6K/R7 b - - 0 1', ['tide']);
    expect(s.state.inCheck).toBe('black');
    expect(eventsOf(s.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'black', square: sq('a8') }),
    ]);
    // The king must leave the a-file.
    expect(sorted(legal(s.engine, s.state, 'black'))).toEqual(['a8b7', 'a8b8']);

    // Giving check with a move: Rb1-a1 opens the file through the a2 pawn.
    const r = scenario({
      fen: 'k7/8/8/8/8/8/P6K/1R6 w - - 0 1',
      white: { elements: ['tide'] },
      moves: ['b1a1'],
    });
    expect(r.state.inCheck).toBe('black');
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'black', square: sq('a8') }),
    ]);
    const plain = scenario({
      fen: 'k7/8/8/8/8/8/P6K/1R6 w - - 0 1',
      white: { elements: ['neutral'] },
      moves: ['b1a1'],
    });
    expect(plain.state.inCheck).toBeNull();
  });

  it('R-ELEM-006 E8 a Tide rook moves through its own pawn but cannot stop on it; a non-Tide rook cannot pass', () => {
    const fen = 'k7/8/8/8/8/8/P6K/R7 w - - 0 1';
    const tide = start(fen, ['tide']);
    expect(dests(tide.engine, tide.state, 'white', 'a1')).toEqual(
      sorted(['a3', 'a4', 'a5', 'a6', 'a7', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']),
    );
    const r = play(tide.engine, tide.state, 'a1a5');
    expect(pieceAt(r.state, 'a5')?.type).toBe('rook');
    expect(pieceAt(r.state, 'a2')?.type).toBe('pawn');
    expect(eventsOf(r.step.events, 'MoveMade')).toEqual([
      expect.objectContaining({ from: sq('a1'), to: sq('a5'), capture: false }),
    ]);

    const ember = start(fen, ['ember']);
    expect(dests(ember.engine, ember.state, 'white', 'a1')).toEqual(
      sorted(['b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']),
    );
  });

  it('R-ELEM-006 Flow passes several allies in a row but never lands on one', () => {
    const s = start('4k3/8/8/N7/8/P7/P6K/R7 w - - 0 1', ['tide']);
    expect(dests(s.engine, s.state, 'white', 'a1')).toEqual(
      sorted(['a4', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']),
    );
  });

  it('R-ELEM-006 Flow does not pass enemy pieces: the enemy piece can be captured and blocks the line', () => {
    const s = start('k7/8/8/p7/8/8/P6K/R7 w - - 0 1', ['tide']);
    expect(dests(s.engine, s.state, 'white', 'a1')).toEqual(
      sorted(['a3', 'a4', 'a5', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']),
    );
    // The black pawn on a5 also blocks the attack on a8.
    const b = start('k7/8/8/p7/8/8/P6K/R7 b - - 0 1', ['tide']);
    expect(b.state.inCheck).toBeNull();
  });

  it('R-ELEM-006 Tide bishops and queens slide through their own pieces too', () => {
    const fen = '4k3/8/8/8/8/8/2PPP2K/3Q4 w - - 0 1';
    const tide = start(fen, ['tide']);
    expect(dests(tide.engine, tide.state, 'white', 'd1')).toEqual(
      sorted([
        ...['a1', 'b1', 'c1', 'e1', 'f1', 'g1', 'h1'],
        ...['d3', 'd4', 'd5', 'd6', 'd7', 'd8'],
        ...['f3', 'g4', 'h5'],
        ...['b3', 'a4'],
      ]),
    );
    const ember = start(fen, ['ember']);
    expect(dests(ember.engine, ember.state, 'white', 'd1')).toEqual(
      sorted(['a1', 'b1', 'c1', 'e1', 'f1', 'g1', 'h1']),
    );
    const bishop = start('4k3/8/8/8/8/8/3P4/2B1K3 w - - 0 1', ['tide']);
    expect(dests(bishop.engine, bishop.state, 'white', 'c1')).toEqual(
      sorted(['b2', 'a3', 'e3', 'f4', 'g5', 'h6']),
    );
  });

  it('R-ELEM-006 a Tide army has 50 legal moves in the start position; knights, king and pawns move as usual', () => {
    // Pawns 16, knights 4, king 0, rooks 5 + 5 (up to the capture on a7/h7), bishops 5 + 5,
    // queen 10 (d3-d7, b3, a4, f3, g4, h5): sliders pass their own pieces.
    const tide = setup({ white: { elements: ['tide'] } });
    const moves = legal(tide.engine, tide.state, 'white');
    expect(moves).toHaveLength(50);
    expect(dests(tide.engine, tide.state, 'white', 'a1')).toEqual(
      sorted(['a3', 'a4', 'a5', 'a6', 'a7']),
    );
    expect(dests(tide.engine, tide.state, 'white', 'f1')).toEqual(
      sorted(['d3', 'c4', 'b5', 'a6', 'h3']),
    );
    expect(dests(tide.engine, tide.state, 'white', 'd1')).toEqual(
      sorted(['d3', 'd4', 'd5', 'd6', 'd7', 'b3', 'a4', 'f3', 'g4', 'h5']),
    );
    const plain = setup({ white: { elements: ['neutral'] } });
    for (const from of ['b1', 'g1', 'e1', 'a2', 'e2', 'h2'])
      expect(dests(tide.engine, tide.state, 'white', from), from).toEqual(
        dests(plain.engine, plain.state, 'white', from),
      );
    expect(dests(tide.engine, tide.state, 'white', 'b1')).toEqual(['a3', 'c3']);
    expect(dests(tide.engine, tide.state, 'white', 'e1')).toEqual([]);
  });

  it('R-ELEM-006 knights and single king steps are unaffected and castling is unchanged', () => {
    // King e1 boxed in by its own pieces, knight g1 next to its own pawns, bishop f1 between the
    // king and the h1 rook.
    const fen = '4k3/8/8/8/8/8/3PPPPP/R3KBNR w KQ - 0 1';
    const tide = start(fen, ['tide']);
    const plain = start(fen, ['neutral']);
    for (const from of ['e1', 'g1'])
      expect(dests(tide.engine, tide.state, 'white', from), from).toEqual(
        dests(plain.engine, plain.state, 'white', from),
      );
    // King: d1 step and queen-side castling only; no king-side castling through the bishop.
    expect(dests(tide.engine, tide.state, 'white', 'e1')).toEqual(['c1', 'd1']);
    expect(dests(tide.engine, tide.state, 'white', 'g1')).toEqual(['f3', 'h3']);
    expect(legal(tide.engine, tide.state, 'white')).not.toContain('e1g1');
  });

  it('R-ELEM-006 a Tide rook slides through every own piece on its line, the king included', () => {
    // "Squares held by its own side's pieces" count as empty for the slide (6.1 Flow rules).
    const s = start('4k3/8/8/8/8/8/8/3NKB1R w - - 0 1', ['tide']);
    expect(dests(s.engine, s.state, 'white', 'h1')).toEqual(
      sorted(['g1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'c1', 'b1', 'a1']),
    );
  });

  it('R-ELEM-006 DD-24 a Tide pawn double-pushes through its own piece (no en passant square), not through an enemy', () => {
    const own = start('4k3/8/8/8/8/4N3/4P3/4K3 w - - 0 1', ['tide']);
    expect(dests(own.engine, own.state, 'white', 'e2')).toEqual(['e4']);
    const r = play(own.engine, own.state, 'e2e4');
    expect(pieceAt(r.state, 'e4')?.type).toBe('pawn');
    expect(pieceAt(r.state, 'e3')?.type).toBe('knight');
    expect(r.state.ep).toBe(-1);

    const plain = start('4k3/8/8/8/8/4N3/4P3/4K3 w - - 0 1', ['ember']);
    expect(dests(plain.engine, plain.state, 'white', 'e2')).toEqual([]);

    const enemy = start('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1', ['tide']);
    expect(dests(enemy.engine, enemy.state, 'white', 'e2')).toEqual([]);

    // Cannot end on an ally: e4 is held by its own knight.
    const blocked = start('4k3/8/8/8/4N3/8/4P3/4K3 w - - 0 1', ['tide']);
    expect(dests(blocked.engine, blocked.state, 'white', 'e2')).toEqual(['e3']);
  });

  it('R-ELEM-006 DD-24 after a Flow double push over its own knight, a capture on the passed square takes the knight, not the pawn', () => {
    const r = scenario({
      fen: '4k3/8/8/8/3p4/4N3/4P3/4K3 w - - 0 1',
      white: { elements: ['tide'] },
      moves: ['e2e4', 'd4e3'],
    });
    const knight = idAt(r.initial, 'e3');
    const step = r.steps[1]?.events ?? [];
    expect(eventsOf(step, 'Captured')).toEqual([
      expect.objectContaining({ victim: knight, square: sq('e3'), by: 'move' }),
    ]);
    expect(eventsOf(step, 'MoveMade')[0]?.enPassant).toBeUndefined();
    expect(pieceAt(r.state, 'e4')).toMatchObject({ side: 'white', type: 'pawn' });

    // An ordinary double push over an empty square still sets the en passant square.
    const normal = start('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['tide']);
    const pushed = play(normal.engine, normal.state, 'e2e4');
    expect(pushed.state.ep).toBe(sq('e3'));
    const ep = play(normal.engine, pushed.state, 'd4e3');
    expect(eventsOf(ep.step.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('e4'), victimType: 'pawn' }),
    ]);
  });

  it('R-ELEM-006 attacks pass through allies: the enemy king may not step onto a file a Tide rook covers through its pawn', () => {
    const fen = '8/1k6/8/8/8/8/P6K/R7 b - - 0 1';
    const tide = start(fen, ['tide']);
    expect(dests(tide.engine, tide.state, 'black', 'b7')).toEqual(
      sorted(['b6', 'b8', 'c6', 'c7', 'c8']),
    );
    const plain = start(fen, ['neutral']);
    expect(dests(plain.engine, plain.state, 'black', 'b7')).toEqual(
      sorted(['a6', 'a7', 'a8', 'b6', 'b8', 'c6', 'c7', 'c8']),
    );
  });

  it('R-ELEM-006 an attack through an ally pins: a Tide rook behind its own pawn pins the enemy bishop to its king', () => {
    const fen = 'r6k/p7/8/8/B7/8/8/K7 w - - 0 1';
    const tide = setup({ fen, white: { elements: ['neutral'] }, black: { elements: ['tide'] } });
    expect(tide.state.inCheck).toBeNull();
    expect(sorted(legal(tide.engine, tide.state, 'white'))).toEqual(['a1a2', 'a1b1', 'a1b2']);
    const plain = setup({
      fen,
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'] },
    });
    expect(dests(plain.engine, plain.state, 'white', 'a4')).toEqual(
      sorted(['b5', 'c6', 'd7', 'e8', 'b3', 'c2', 'd1']),
    );
  });

  it('R-ELEM-006 a check through an ally can be blocked by an enemy piece, because Flow never passes enemies', () => {
    // Black Tide rook a8 checks the white king a1 through its own a7 pawn.
    const s = setup({
      fen: 'r3k3/p7/8/8/8/1R6/8/K7 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['tide'] },
    });
    expect(s.state.inCheck).toBe('white');
    expect(sorted(legal(s.engine, s.state, 'white'))).toEqual(['a1b1', 'a1b2', 'b3a3']);
    const r = play(s.engine, s.state, 'b3a3');
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ELEM-006 R-ELEM-004 Flow applies per piece under Blended Family', () => {
    // Tide bishop (group A) passes its pawn; the Ember rook (group B) does not.
    const fen = '4k3/8/8/8/8/8/P2P3K/R1B5 w - - 0 1';
    const s = start(fen, ['tide', 'ember']);
    expect(dests(s.engine, s.state, 'white', 'c1')).toEqual(
      sorted(['b2', 'a3', 'e3', 'f4', 'g5', 'h6']),
    );
    expect(dests(s.engine, s.state, 'white', 'a1')).toEqual(['b1']);
    const swapped = start(fen, ['ember', 'tide']);
    expect(dests(swapped.engine, swapped.state, 'white', 'c1')).toEqual(['b2', 'a3'].sort());
    expect(dests(swapped.engine, swapped.state, 'white', 'a1')).toEqual(
      sorted(['a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'd1', 'e1', 'f1', 'g1', 'h1']),
    );
  });
});
