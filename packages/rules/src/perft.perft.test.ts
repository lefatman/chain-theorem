/**
 * Perft suites (M1 step 1.3, R-RULES-001). Reference counts from the Chess Programming Wiki
 * "Perft Results" page. Gate: start position depth 5 = 4,865,609; Kiwipete depth 4 = 4,085,603.
 */
import { describe, expect, it } from 'vitest';
import { parseFen, piecesFromFen, START_FEN } from './board.ts';
import { Pos, perft } from './movegen.ts';

function posFromFen(fen: string): Pos {
  const parsed = parseFen(fen);
  const { board, pieces } = piecesFromFen(parsed, { white: ['neutral'], black: ['neutral'] });
  return Pos.fromState({
    board,
    pieces,
    turn: parsed.turn,
    castling: parsed.castling,
    ep: parsed.ep,
  });
}

const SUITES: { name: string; fen: string; counts: number[] }[] = [
  { name: 'start position', fen: START_FEN, counts: [20, 400, 8_902, 197_281, 4_865_609] },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2_039, 97_862, 4_085_603],
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2_812, 43_238, 674_624],
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9_467, 422_333],
  },
  {
    name: 'position 4 mirrored',
    fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1',
    counts: [6, 264, 9_467, 422_333],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1_486, 62_379, 2_103_487],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2_079, 89_890, 3_894_594],
  },
];

describe('R-RULES-001 perft', () => {
  for (const suite of SUITES) {
    suite.counts.forEach((expected, i) => {
      const depth = i + 1;
      it(`R-RULES-001 perft ${suite.name} depth ${depth} = ${expected}`, () => {
        expect(perft(posFromFen(suite.fen), depth)).toBe(expected);
      });
    });
  }
});
