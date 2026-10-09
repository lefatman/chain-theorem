/**
 * Electric Slide (5.8, Storm signature): "Base: a pawn may move straight over one adjacent allied
 * piece to the empty square beyond. Attuned (Storm pieces): a sliding piece that meets an allied
 * piece other than a pawn may continue from that square in a new direction once per move, the queen
 * twice; it still cannot stop on the ally. Attacks and checks follow the same paths."
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 5.6, 6.3 (attunement, the Attunement Charm),
 * 8.2 (DD-32 reveal on observation), R-ELEM-006 (checks follow movement), DD-104 and DD-106 (pawns
 * are not corners), not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type Engine,
  type GameState,
  type Side,
  moveToUci,
  squareName,
} from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { type ArmySpec, eventsOf, parseSquare, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
const legal = (engine: Engine, state: GameState, side: Side): string[] =>
  engine.legalMoves(state, side).map(moveToUci);
/** Destination names of the piece on `from`, sorted. */
const dests = (engine: Engine, state: GameState, side: Side, from: string): string[] =>
  engine
    .legalMoves(state, side)
    .filter((m) => m.from === sq(from))
    .map((m) => squareName(m.to) + (m.promotion ? m.promotion[0] : ''))
    .sort();

const STORM: ArmySpec = { elements: ['storm'], abilities: ['electric_slide'] };
const PLAIN: ArmySpec = { elements: ['neutral'], abilities: ['electric_slide'] };

describe('Electric Slide (5.8, DD-104)', () => {
  it('R-ABIL-005 R-ELEM-003 module data: Passive, Storm signature with an attuned version, all, level 4, pawnLeap and redirects hooks', () => {
    const def = abilityById.get('electric_slide');
    expect(def).toMatchObject({
      category: 'PASSIVE',
      affinity: 'storm',
      eligible: 'all',
      tags: [],
      minLevel: 3,
      slotCost: 1,
    });
    expect(def?.attuned).toBeDefined();
    expect(def?.hooks?.moveFilter?.pawnLeap).toBeTypeOf('function');
    expect(def?.hooks?.moveFilter?.redirects).toBeTypeOf('function');
    // Squall handed the signature over (DD-98, DD-104).
    expect(abilityById.get('squall')).toMatchObject({ affinity: 'neutral', version: 2 });
    expect(abilityById.get('squall')?.attuned).toBeUndefined();
  });

  it('R-RULES-001 base: a pawn leaps over one adjacent ally to the empty square beyond, never over an enemy or onto an occupied square', () => {
    // d2 P with N d3 ahead; e2 P with the enemy knight e3 ahead; f2 P with f3 empty.
    const { engine, state } = setup({ fen: '4k3/8/8/8/8/3Nn3/3PPP2/4K3 w - - 0 1', white: PLAIN });
    // d2: the leap to d4, and the ordinary capture of the knight e3.
    expect(dests(engine, state, 'white', 'd2')).toEqual(['d4', 'e3']);
    expect(dests(engine, state, 'white', 'e2')).toEqual([]);
    expect(dests(engine, state, 'white', 'f2')).toEqual(['e3', 'f3', 'f4']);
    // The square beyond is occupied: no leap.
    const blocked = setup({ fen: '4k3/8/8/8/3p4/3N4/3P4/4K3 w - - 0 1', white: PLAIN });
    expect(dests(blocked.engine, blocked.state, 'white', 'd2')).toEqual([]);
    // Control: without the ability the pawn behind its knight has no move.
    const plain = setup({ fen: '4k3/8/8/8/8/3Nn3/3PPP2/4K3 w - - 0 1' });
    expect(dests(plain.engine, plain.state, 'white', 'd2')).toEqual(['e3']);
  });

  it('R-RULES-001 R-RULES-002 a leap works from any rank and promotes on the last one; Black leaps towards rank 1', () => {
    const w = setup({ fen: '4k3/3N4/3P4/8/8/8/8/4K3 w - - 0 1', white: PLAIN });
    expect(dests(w.engine, w.state, 'white', 'd6')).toEqual(['d8b', 'd8k', 'd8q', 'd8r']);
    const b = setup({ fen: '4k3/8/8/8/3p4/3n4/8/4K3 b - - 0 1', black: PLAIN });
    expect(dests(b.engine, b.state, 'black', 'd4')).toEqual(['d2']);
  });

  it('R-RULES-001 a leap from the second rank grants no en passant (the jumped square is occupied); a normal double push does', () => {
    const leap = scenario({
      fen: '4k3/8/8/8/8/4N3/4P3/4K3 w - - 0 1',
      white: PLAIN,
      moves: ['e2e4'],
    });
    expect(leap.state.ep).toBe(-1);
    const push = scenario({
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      white: PLAIN,
      moves: ['e2e4'],
    });
    expect(push.state.ep).toBe(sq('e3'));
  });

  it('R-INFO-002 DD-32 the leap itself is observable: Electric Slide is revealed on pawns when the move is played', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/3Nn3/3PPP2/4K3 w - - 0 1',
      white: PLAIN,
      moves: ['d2d4'],
    });
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'pawn', ability: 'electric_slide' },
        cause: 'observed',
      }),
    ]);
    // A normal pawn move reveals nothing.
    const quiet = scenario({
      fen: '4k3/8/8/8/8/3Nn3/3PPP2/4K3 w - - 0 1',
      white: PLAIN,
      moves: ['f2f3'],
    });
    expect(eventsOf(quiet.events, 'Revealed')).toEqual([]);
  });

  it('R-ELEM-003 attuned: a Storm rook turns at its ally once, never stops on it, never continues straight; an unattuned rook does not turn', () => {
    // Ra1, Nd1, Kh2; black pawn d6 and king h8. Along rank 1 the rook meets the knight on d1 and
    // may turn north; the a-file is open as usual.
    const fen = '7k/8/3p4/8/8/8/7K/R2N4 w - - 0 1';
    const storm = setup({ fen, white: STORM });
    const file = ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    expect(dests(storm.engine, storm.state, 'white', 'a1')).toEqual(
      [...file, 'b1', 'c1', 'd2', 'd3', 'd4', 'd5', 'd6'].sort(),
    );
    const plain = setup({ fen, white: PLAIN });
    expect(dests(plain.engine, plain.state, 'white', 'a1')).toEqual([...file, 'b1', 'c1'].sort());
  });

  it('R-ELEM-003 a bishop turns only onto diagonals; a queen may turn twice, a rook once', () => {
    // Bc1 meets the knight e3: on it may turn NW (d4..a7) or SE (f2, g1), not continue to f4.
    const bishop = setup({ fen: '7k/8/8/8/8/4N3/8/K1B5 w - - 0 1', white: STORM });
    expect(dests(bishop.engine, bishop.state, 'white', 'c1')).toEqual(
      ['a3', 'b2', 'd2', 'a7', 'b6', 'c5', 'd4', 'f2', 'g1'].sort(),
    );
    // Qa1 with knights a4 and d4: a1-a4 (turn) -b4-c4-d4 (turn) -d8 needs two turns, e8 one, and
    // a5 two the other way round (a1-d4 along the diagonal, west to a4, then north). Never the
    // allies' squares themselves.
    const queen = setup({ fen: '7k/8/8/8/N2N4/8/8/Q6K w - - 0 1', white: STORM });
    const q = dests(queen.engine, queen.state, 'white', 'a1');
    expect(q).toEqual(expect.arrayContaining(['d8', 'e8', 'b4', 'c4', 'd3', 'c5', 'a5']));
    expect(q).not.toContain('a4');
    expect(q).not.toContain('d4');
    // A rook turns once: a1-a4-b4-c4 and no further (d4 is an ally with no turn left), or along
    // the rank to its king on h1 and north from there (the black king on h8 is never a target).
    const rook = setup({ fen: '7k/8/8/8/N2N4/8/8/R6K w - - 0 1', white: STORM });
    const rk = dests(rook.engine, rook.state, 'white', 'a1');
    expect(rk).toEqual(
      [
        'a2',
        'a3',
        'b1',
        'b4',
        'c1',
        'c4',
        'd1',
        'e1',
        'f1',
        'g1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'h7',
      ].sort(),
    );
  });

  it("R-ELEM-003 DD-106 a slider never turns at a pawn: behind its pawns the Storm queen has the plain queen's moves", () => {
    // The same geometry as above with pawns on a4 and d4 (and the king off the queen's rays, since
    // a king is a corner): no turn, so a4 and d4 block as in chess.
    const queen = setup({ fen: '7k/8/8/8/P2P4/8/7K/Q7 w - - 0 1', white: STORM });
    expect(dests(queen.engine, queen.state, 'white', 'a1')).toEqual(
      ['a2', 'a3', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'b2', 'c3'].sort(),
    );
    const bishop = setup({ fen: '7k/8/8/8/8/4P3/8/K1B5 w - - 0 1', white: STORM });
    expect(dests(bishop.engine, bishop.state, 'white', 'c1')).toEqual(['a3', 'b2', 'd2'].sort());
    // A pawn in the middle of a two-turn path ends it too: a1-a4 (knight) -b4-c4-d4 (pawn) stops
    // at c4; d8 and a5 are out of reach while e8 (one turn at the knight) stays.
    const mixed = setup({ fen: '7k/8/8/8/N2P4/8/7K/Q7 w - - 0 1', white: STORM });
    const q = dests(mixed.engine, mixed.state, 'white', 'a1');
    expect(q).toEqual(expect.arrayContaining(['b4', 'c4', 'e8']));
    expect(q).not.toContain('d8');
    expect(q).not.toContain('a5');
  });

  it('R-RULES-001 DD-106 from the opening position a Storm army has exactly the twenty chess moves and no capture', () => {
    // With pawns as corners the c1 bishop took g7 on move 1 and the queen reached seven pawns
    // (docs/BALANCE_BASELINE.md finding 1); pawns do not conduct, so the back rank is shut as in
    // chess until a piece moves.
    const { engine, state } = setup({ white: STORM, black: STORM });
    const moves = legal(engine, state, 'white');
    expect(moves).toHaveLength(20);
    expect(moves.filter((m) => /^(c1|d1|f1|a1|h1)/.test(m))).toEqual([]);
    expect(
      engine.legalMoves(state, 'white').some((m) => state.pieces.some((p) => p.square === m.to)),
    ).toBe(false);
  });

  it("R-ELEM-006 DD-106 attacks follow the same rule: a pawn stepping onto the rook's rank gives no check through it, a knight does", () => {
    // White Ra4, Kh1 and a pawn d3 (or a knight b3); black king d8. The pawn reaches d4 and the
    // rook's rank-4 ray stops at it; the knight on d4 is a corner and the rook checks along the
    // d-file.
    const pawn = scenario({
      fen: '3k4/8/8/8/R7/3P4/8/7K w - - 0 1',
      white: STORM,
      moves: ['d3d4'],
    });
    expect(eventsOf(pawn.events, 'Check')).toEqual([]);
    expect(pawn.state.inCheck).toBeNull();
    expect(legal(pawn.engine, pawn.state, 'black')).toContain('d8d7');
    expect(eventsOf(pawn.events, 'Revealed')).toEqual([]);
    const knight = scenario({
      fen: '3k4/8/8/8/R7/1N6/8/7K w - - 0 1',
      white: STORM,
      moves: ['b3d4'],
    });
    expect(eventsOf(knight.events, 'Check')).toEqual([expect.objectContaining({ side: 'black' })]);
    expect(legal(knight.engine, knight.state, 'black')).not.toContain('d8d7');
  });

  it('R-ELEM-006 R-RULES-005 attacks follow the turns: a knight landing on d1 lets the rook check the king on d7, the king may not stay on the file, and the rule is revealed', () => {
    // Ra1, Nb2, Ka2; black king d7. Nb2-d1 opens the rook's turn north along the d-file.
    const r = scenario({ fen: '8/3k4/8/8/8/8/KN6/R7 w - - 0 1', white: STORM, moves: ['b2d1'] });
    expect(eventsOf(r.events, 'Check')).toEqual([expect.objectContaining({ side: 'black' })]);
    expect(r.state.inCheck).toBe('black');
    const moves = legal(r.engine, r.state, 'black');
    expect(moves).not.toContain('d7d6');
    expect(moves).not.toContain('d7d8');
    expect(moves).toContain('d7e6');
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'rook', ability: 'electric_slide' },
        cause: 'observed',
      }),
    ]);
    // Control: unattuned, the knight move gives no check.
    const plain = scenario({
      fen: '8/3k4/8/8/8/8/KN6/R7 w - - 0 1',
      white: PLAIN,
      moves: ['b2d1'],
    });
    expect(eventsOf(plain.events, 'Check')).toEqual([]);
  });

  it('INV-03 the mover may not expose their own king to a turned attack', () => {
    // Black Ka8 and pawn a5; white Ra1 (Storm) turns at its knight... the black pawn a7 is pinned
    // along the turned path: Rc1, Nc5? Simpler: white Rh1, Nd1 and black Kd7 with a black knight d6
    // that may not move away from the file (it shields the king from the turned rook).
    const { engine, state } = setup({ fen: '8/3k4/3n4/8/8/8/K7/3N3R b - - 0 1', white: STORM });
    const moves = legal(engine, state, 'black');
    expect(moves.filter((m) => m.startsWith('d6'))).toEqual([]);
    const plain = setup({ fen: '8/3k4/3n4/8/8/8/K7/3N3R b - - 0 1', white: PLAIN });
    expect(legal(plain.engine, plain.state, 'black').filter((m) => m.startsWith('d6'))).not.toEqual(
      [],
    );
  });

  it('DD-99 DD-104 a turned capture approaches from the last corner: a Block Path pawn facing south blocks the rook arriving from d1', () => {
    const fen = '7k/8/3p4/8/8/8/K7/R2N4 w - - 0 1';
    const guarded = setup({ fen, white: STORM, black: { abilities: ['block_path'] } });
    expect(dests(guarded.engine, guarded.state, 'white', 'a1')).not.toContain('d6');
    const open = setup({ fen, white: STORM });
    expect(dests(open.engine, open.state, 'white', 'a1')).toContain('d6');
  });

  it('R-ELEM-003 R-LOAD-002 the Attunement Charm (Storm) gives a neutral army the turns, and the first observed turn reveals the charm with the ability', () => {
    const charm: ArmySpec = {
      elements: ['neutral'],
      abilities: ['electric_slide'],
      items: ['attunement_charm'],
      itemParams: { attunement_charm: { element: 'storm' } },
    };
    const fen = '7k/8/3p4/8/8/8/K7/R2N4 w - - 0 1';
    const { engine, state } = setup({ fen, white: charm });
    expect(dests(engine, state, 'white', 'a1')).toContain('d6');
    const r = scenario({ fen, white: charm, moves: ['a1d6'] });
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'rook', ability: 'electric_slide' },
      }),
      expect.objectContaining({ side: 'white', info: { kind: 'item', item: 'attunement_charm' } }),
    ]);
  });

  it('R-ELEM-005 a turning slider still may not stop on a burning square but passes over it', () => {
    // Black Ember knight took on d3 and left: d3 burns. The white Storm rook a1 turns at d1 and
    // may reach d4 past the fire but not d3.
    const burn = scenario({
      fen: '7k/8/8/8/2n5/8/3P4/R2NK3 b - - 0 1',
      white: STORM,
      black: { elements: ['ember'] },
      moves: ['c4d2', 'e1e2', 'd2b3'],
    });
    expect(eventsOf(burn.events, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('d2') }),
    ]);
    const d = dests(burn.engine, burn.state, 'white', 'a1');
    expect(d).not.toContain('d2');
    expect(d).toEqual(expect.arrayContaining(['d3', 'd4', 'd5']));
  });
});
