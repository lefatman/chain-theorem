/**
 * Electric Slide (5.8, Storm signature; designer rule 2026-10-09, DD-111): "Base: a pawn may move
 * straight over one adjacent allied piece to the empty square beyond. Attuned (Storm pieces): a rook
 * or bishop may change direction once at an allied piece of equal or higher rank than itself (DD-97:
 * pawn < knight = bishop < rook < queen); the queen may change direction twice, at allied rooks and
 * bishops; the king is never a corner and nothing turns at a pawn. A slider never stops on the ally
 * and never continues straight or back. Attacks and checks follow the same paths."
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 5.1, 5.6, 6.3 (attunement, the Attunement Charm),
 * 8.2 (DD-32 reveal on observation), R-ELEM-006 (checks follow movement), DD-104, DD-106 and DD-111,
 * not from the engine's current output.
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
const on = (fen: string, army: ArmySpec = STORM, from = 'a1') => {
  const { engine, state } = setup({ fen, white: army });
  return dests(engine, state, 'white', from);
};

const STORM: ArmySpec = { elements: ['storm'], abilities: ['electric_slide'] };
const PLAIN: ArmySpec = { elements: ['neutral'], abilities: ['electric_slide'] };
const A_FILE = ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

describe('Electric Slide (5.8, DD-104, DD-111)', () => {
  it('R-ABIL-005 R-ELEM-003 module data: Passive, Storm signature with an attuned version, all, level 3, pawnLeap, redirects and redirectCorner hooks', () => {
    const def = abilityById.get('electric_slide');
    expect(def).toMatchObject({
      category: 'PASSIVE',
      affinity: 'storm',
      eligible: 'all',
      tags: [],
      minLevel: 3,
      slotCost: 1,
      version: 5,
    });
    expect(def?.attuned).toBeDefined();
    expect(def?.hooks?.moveFilter?.pawnLeap).toBeTypeOf('function');
    expect(def?.hooks?.moveFilter?.redirects).toBeTypeOf('function');
    expect(def?.hooks?.moveFilter?.redirectCorner).toBeTypeOf('function');
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

  it('R-ELEM-003 DD-111 attuned: a Storm rook turns once at an allied rook or queen (equal or higher rank), never stops on it, never continues straight; an unattuned rook does not turn', () => {
    // Ra1, Rd1, Kh2; black pawn d6 and king h8. Along rank 1 the rook meets its rook on d1 and may
    // turn north up the d-file; the a-file is open as usual.
    const fen = '7k/8/3p4/8/8/8/7K/R2R4 w - - 0 1';
    expect(on(fen)).toEqual([...A_FILE, 'b1', 'c1', 'd2', 'd3', 'd4', 'd5', 'd6'].sort());
    expect(on(fen, PLAIN)).toEqual([...A_FILE, 'b1', 'c1'].sort());
    // A queen on d1 is a corner for the rook too; it may not continue along rank 1 past it.
    expect(on('7k/8/3p4/8/8/8/7K/R2Q4 w - - 0 1')).toEqual(
      [...A_FILE, 'b1', 'c1', 'd2', 'd3', 'd4', 'd5', 'd6'].sort(),
    );
  });

  it('R-ELEM-003 DD-97 DD-111 a rook never turns at a knight, bishop or pawn (lower rank) nor at the king', () => {
    for (const corner of ['N', 'B', 'P']) {
      const fen = `7k/8/3p4/8/8/8/7K/R2${corner}4 w - - 0 1`;
      expect(on(fen), corner).toEqual([...A_FILE, 'b1', 'c1'].sort());
    }
    // The king on d1 (white king there, not on h2): no turn at it.
    expect(on('7k/8/3p4/8/8/8/8/R2K4 w - - 0 1')).toEqual([...A_FILE, 'b1', 'c1'].sort());
  });

  it('R-ELEM-003 DD-97 DD-111 a bishop turns once at a knight (equal rank), a bishop, a rook or the queen, never at a pawn or the king', () => {
    // Bc1 meets the piece on e3: it may turn NW (d4..a7) or SE (f2, g1), never continue to f4.
    const plain = ['a3', 'b2', 'd2'];
    const turned = [...plain, 'a7', 'b6', 'c5', 'd4', 'f2', 'g1'].sort();
    for (const corner of ['N', 'B', 'R', 'Q']) {
      expect(on(`7k/8/8/8/8/4${corner}3/8/K1B5 w - - 0 1`, STORM, 'c1'), corner).toEqual(turned);
    }
    expect(on('7k/8/8/8/8/4P3/8/K1B5 w - - 0 1', STORM, 'c1')).toEqual(plain.sort());
    expect(on('7k/8/8/8/8/4K3/8/2B5 w - - 0 1', STORM, 'c1')).toEqual(plain.sort());
    expect(on('7k/8/8/8/8/4N3/8/K1B5 w - - 0 1', PLAIN, 'c1')).toEqual(plain.sort());
  });

  it('R-ELEM-003 DD-111 the queen turns twice, at allied rooks and bishops only: never at a knight, another queen, a pawn or the king', () => {
    // Qd1 with the rook d4 up the file and the bishop g4 along rank 4: d1-d4 turns east, g4 turns
    // north to g8 or north-west towards c8; a knight on g4 is no corner for the queen.
    const two = on('7k/8/8/8/3R2B1/8/8/K2Q4 w - - 0 1', STORM, 'd1');
    expect(two).toEqual(expect.arrayContaining(['e4', 'f4', 'g5', 'g6', 'g7', 'g8', 'f5', 'e6']));
    expect(two).not.toContain('d4');
    expect(two).not.toContain('g4');
    const knight = on('7k/8/8/8/3R2N1/8/8/K2Q4 w - - 0 1', STORM, 'd1');
    expect(knight).toEqual(expect.arrayContaining(['e4', 'f4']));
    expect(knight).not.toContain('g5');
    expect(knight).not.toContain('g8');
    // A second queen is not a corner for a queen, nor is the king.
    for (const corner of ['Q', 'N', 'P']) {
      const d = on(`7k/8/8/8/8/3${corner}4/8/K2Q4 w - - 0 1`, STORM, 'd1');
      expect(d, corner).not.toContain('e4');
      expect(d, corner).not.toContain('c4');
    }
    expect(on('7k/8/8/8/8/3K4/8/3Q4 w - - 0 1', STORM, 'd1')).not.toContain('e4');
    // Unattuned, the queen has the plain queen's moves.
    expect(on('7k/8/8/8/3R2B1/8/8/K2Q4 w - - 0 1', PLAIN, 'd1')).not.toContain('e4');
  });

  it('R-ELEM-003 DD-106 DD-111 a pawn ends a turned path like any non-corner: after the turn at its rook the Storm rook stops before its pawn', () => {
    const r = on('7k/8/8/8/R2P4/8/7K/R7 w - - 0 1');
    // a1-a4 is a rook corner: along rank 4 the rook reaches b4 and c4, and the pawn d4 ends the path.
    expect(r).toEqual(expect.arrayContaining(['b4', 'c4']));
    expect(r).not.toContain('d4');
    expect(r).not.toContain('e4');
  });

  it('R-RULES-001 DD-106 DD-111 from the opening position a Storm army has exactly the twenty chess moves and no capture', () => {
    // Pawns never conduct and the back rank offers no turn that reaches a new square: Ra1's
    // neighbour is a knight, Qd1's corners (Bc1) lead only into its own pawns.
    const { engine, state } = setup({ white: STORM, black: STORM });
    const moves = legal(engine, state, 'white');
    expect(moves).toHaveLength(20);
    expect(moves.filter((m) => /^(c1|d1|f1|a1|h1)/.test(m))).toEqual([]);
    expect(
      engine.legalMoves(state, 'white').some((m) => state.pieces.some((p) => p.square === m.to)),
    ).toBe(false);
  });

  it("R-ELEM-006 DD-97 DD-111 attacks follow the same rule: a knight stepping onto the rook's rank is no corner for it and gives no check through it", () => {
    // White Ra4, Kh1 and a knight b3; black king d8. The knight reaches d4 and the rook's rank-4
    // ray stops at it: a knight ranks below a rook, so it is no corner for one.
    const knight = scenario({
      fen: '3k4/8/8/8/R7/1N6/8/7K w - - 0 1',
      white: STORM,
      moves: ['b3d4'],
    });
    expect(eventsOf(knight.events, 'Check')).toEqual([]);
    expect(knight.state.inCheck).toBeNull();
    expect(legal(knight.engine, knight.state, 'black')).toContain('d8d7');
    expect(eventsOf(knight.events, 'Revealed')).toEqual([]);
  });

  it('R-ELEM-006 R-RULES-005 attacks follow the turns: a knight landing on e3 lets the c1 bishop check the king on b6 through the turn, the king may not step along the turned diagonal, and the rule is revealed', () => {
    // Bc1, Nd1, Ka1; black king b6. Nd1-e3 puts a knight (equal rank) on the bishop's diagonal, and
    // the bishop turns north-west from e3: d4, c5, b6. The knight itself does not attack b6.
    const fen = '8/8/1k6/8/8/8/8/K1BN4 w - - 0 1';
    const r = scenario({ fen, white: STORM, moves: ['d1e3'] });
    expect(eventsOf(r.events, 'Check')).toEqual([expect.objectContaining({ side: 'black' })]);
    expect(r.state.inCheck).toBe('black');
    const moves = legal(r.engine, r.state, 'black');
    expect(moves).not.toContain('b6c5');
    expect(moves).toContain('b6a6');
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'bishop', ability: 'electric_slide' },
        cause: 'observed',
      }),
    ]);
    // Control: unattuned, the knight move gives no check.
    const plain = scenario({ fen, white: PLAIN, moves: ['d1e3'] });
    expect(eventsOf(plain.events, 'Check')).toEqual([]);
    expect(plain.state.inCheck).toBeNull();
  });

  it('INV-03 the mover may not expose their own king to a turned attack', () => {
    // White Bc1 and Re3 (a corner for the bishop), Ka1; black Kb6 with a knight on c5 that shields
    // the king from the bishop's turned path c1-e3-d4-c5-b6: the knight may not move.
    const fen = '8/8/1k6/2n5/8/4R3/8/K1B5 b - - 0 1';
    const { engine, state } = setup({ fen, white: STORM });
    expect(legal(engine, state, 'black').filter((m) => m.startsWith('c5'))).toEqual([]);
    const plain = setup({ fen, white: PLAIN });
    expect(legal(plain.engine, plain.state, 'black').filter((m) => m.startsWith('c5'))).not.toEqual(
      [],
    );
  });

  it('DD-99 DD-104 a turned capture approaches from the last corner: a Block Path pawn facing south blocks the rook arriving from d1', () => {
    const fen = '7k/8/3p4/8/8/8/K7/R2R4 w - - 0 1';
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
    const fen = '7k/8/3p4/8/8/8/K7/R2R4 w - - 0 1';
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
    // Black Ember knight took on d2 and left: d2 burns. The white Storm rook a1 turns at its rook
    // d1 and may reach d3 and beyond past the fire but not d2.
    const burn = scenario({
      fen: '7k/8/8/8/2n5/8/3P4/R2RK3 b - - 0 1',
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
