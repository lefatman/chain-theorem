/**
 * The worked examples E1 to E9 of spec 5.5 as plain scenario data, set up exactly as the golden
 * tests in `test/golden.test.ts` do (R-TEST-001). The dev-only Scenario Lab loads them so a designer
 * can step through each chain and compare it with the spec (BUILD_PROMPT M3, section 8); the tiny
 * `examples.test.ts` keeps them in sync with the engine.
 *
 * Everything here is JSON-like data: prompt answers are the ChoiceOption the chooser picks, never a
 * callback, so the lab can show, edit and export them. Armies use 'neutral' elements where the spec
 * says so (DD-23); loadout validation is bypassed on purpose, as in every scenario() test.
 */
import { parseSquare } from '@chain-theorem/rules';
import type { ScenarioSpec } from './testing.ts';

export type WorkedExampleId =
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E5'
  | 'E6'
  | 'E7'
  | 'E8'
  | 'E9'
  | 'E10'
  | 'E11'
  | 'E12'
  | 'E13'
  | 'E14'
  | 'E15'
  | 'E16'
  | 'E17';

export interface WorkedExampleVariant {
  /** Short label, e.g. 'Stalwart king'. */
  label: string;
  setup: ScenarioSpec;
}

export interface WorkedExample {
  id: WorkedExampleId;
  title: string;
  /** The Setup column of spec 5.5. */
  setupText: string;
  /** The Result column of spec 5.5, verbatim. */
  specText: string;
  /** How the scripted moves stage the example (piece ids follow a1..h8 square order). */
  note?: string;
  setup: ScenarioSpec;
  /** Other setups the golden test also covers (same expected result or a control case). */
  variants?: readonly WorkedExampleVariant[];
}

const sq = parseSquare;

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
  {
    id: 'E1',
    title: 'Hit and Run knight captures a Poisoned Meat pawn',
    setupText: 'Knight with Hit and Run captures a pawn with Poisoned Meat (neutral elements)',
    specText:
      'Pawn removed. Poisoned Meat removes the knight. Hit and Run fizzles (no body). Both gone.',
    note: 'Nc3xd5. Ids: e1 K=0, c3 N=1, d5 p=2, e8 k=3.',
    setup: {
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    },
  },
  {
    id: 'E2',
    title: 'As E1, but the knight also has Pierce',
    setupText: 'As E1, but the knight also has Pierce',
    specText:
      'Pierce negates Poisoned Meat (revealed as negated). Knight returns to its origin square.',
    note: 'Nc3xd5. Ids: e1 K=0, c3 N=1, d5 p=2, e8 k=3.',
    setup: {
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['hit_and_run', 'pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    },
  },
  {
    id: 'E3',
    title: 'A king captures a Poisoned Meat pawn',
    setupText: 'A king (ordinary or Stalwart) captures a Poisoned Meat pawn',
    specText: 'Royal Immunity: retaliation fizzles, ability revealed, king survives.',
    note: 'Ke1xe2 with an ordinary king; the variant gives the king Stalwart (six per-type sets).',
    setup: {
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    },
    variants: [
      {
        label: 'Stalwart king',
        setup: {
          fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
          format: 'full',
          // Six sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king.
          white: { elements: ['neutral'], sets: [[], [], [], [], [], ['stalwart']] },
          black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
          moves: ['e1e2'],
        },
      },
    ],
  },
  {
    id: 'E4',
    title: 'First Blood: a queen captures a Poisoned Meat pawn',
    setupText: 'First Blood: queen captures a Poisoned Meat pawn',
    specText:
      "Poisoned Meat removes the queen: the first non-pawn capture belongs to the pawn's owner, who wins after the chain settles.",
    note: 'Qd1xd5 in First Blood. Ids: d1 Q=0, e1 K=1, d5 p=2, e8 k=3.',
    setup: {
      fen: '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1',
      format: 'first_blood',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    },
  },
  {
    id: 'E5',
    title: 'A rook shielding its king captures a Poisoned Meat pawn',
    setupText:
      'White rook on e2 shields king e1 from a black queen on e8 and captures a Poisoned Meat pawn on e5',
    specText: 'Removing the rook would expose the white king, so Poisoned Meat fizzles (INV-03).',
    note: 'Re2xe5. Ids: e1 K=0, e2 R=1, e5 p=2, e8 q=3, h8 k=4.',
    setup: {
      fen: '4q2k/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    },
  },
  {
    id: 'E6',
    title: 'A bishop captures a knight with Riposte',
    setupText: 'Bishop captures a knight with Riposte',
    specText:
      "Knight's owner picks a piece that can legally capture the bishop; that capture runs a nested pipeline at depth 1.",
    note: 'Bd3xg6; Black answers the Riposte prompt with h7xg6. Ids: e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6.',
    setup: {
      fen: '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['d3g6'],
      answers: [{ kind: 'move', from: sq('h7'), to: sq('g6') }],
    },
  },
  {
    id: 'E7',
    title: 'Hot Foot: an Ember knight captures on e5, then leaves it',
    setupText: 'Ember knight captures on e5; two turns later it moves to f3',
    specText:
      'Hot Foot: e5 ignites. Until the opponent has taken 3 turns, no non-Ember piece may move to or capture on e5; a non-Ember rook may still slide over it.',
    note: 'Nc4xe5, Ka8-b8, Ne5-f3 (e5 ignites), Re8-e4 slides over e5, then Black takes turns 2 and 3 and the fire goes out; Kg1-g2 closes the golden test. Ids: g1 K=0, c4 N=1, e5 p=2, c6 n=3, a8 k=4, e8 r=5.',
    setup: {
      fen: 'k3r3/8/2n5/4p3/2N5/8/8/6K1 w - - 0 1',
      format: 'full',
      white: { elements: ['ember'] },
      black: { elements: ['neutral'] },
      moves: ['c4e5', 'a8b8', 'e5f3', 'e8e4', 'f3e5', 'b8a8', 'e5f3', 'a8b8', 'g1g2'],
    },
  },
  {
    id: 'E8',
    title: 'Flow: a Tide rook behind its own pawn',
    setupText: 'Tide rook on a1, its own pawn on a2, a3-a7 empty, enemy king on a8',
    specText:
      "Flow: the rook's line passes through its own pawn, so the enemy king is in check. The rook may also move from a1 to a5 through the pawn.",
    note: 'The rook starts on b1 and steps to a1 (giving check through a2), Ka8-b8, then Ra1-a5 through the pawn. Ids: b1 R=0, e1 K=1, a2 P=2, a8 k=3. The variant is the golden control: a neutral rook gives no check.',
    setup: {
      fen: 'k7/8/8/8/8/8/P7/1R2K3 w - - 0 1',
      format: 'full',
      white: { elements: ['tide'] },
      black: { elements: ['neutral'] },
      moves: ['b1a1', 'a8b8', 'a1a5'],
    },
    variants: [
      {
        label: 'Control: neutral rook',
        setup: {
          fen: 'k7/8/8/8/8/8/P7/1R2K3 w - - 0 1',
          format: 'full',
          white: { elements: ['neutral'] },
          black: { elements: ['neutral'] },
          moves: ['b1a1', 'a8b8'],
        },
      },
    ],
  },
  {
    id: 'E9',
    title: 'Overabundance: a Grove bishop with Rebirth is captured three times',
    setupText: 'Grove bishop with Rebirth is captured three times in one battle',
    specText:
      'Overabundance: Rebirth has 2 charges on a Grove piece, so the bishop returns twice (each time its starting square is empty); the third capture removes it for good.',
    note: 'The bishop steps out and the rook captures it three times; Rebirth (neutral since DD-98) returns it to c1 without a prompt while that square is empty. Ids: c1 B=0, e1 K=1, d8 r=2, e8 k=3.',
    setup: {
      fen: '3rk3/8/8/8/8/8/8/2B1K3 w - - 0 1',
      format: 'full',
      white: { elements: ['grove'], abilities: ['rebirth'] },
      black: { elements: ['neutral'] },
      moves: ['c1d2', 'd8d2', 'c1b2', 'd2b2', 'c1d2', 'b2d2'],
    },
  },
  {
    id: 'E10',
    title: 'Necromancer: a knight takes a rook and raises the fallen pawn',
    setupText:
      'White knight c3, pawn b2 and bishop b1; Black rook b8. The rook takes the pawn, then the bishop with check; the knight (Necromancer) takes the rook',
    specText:
      "Rank 3 ≥ rank 2: the owner is offered the captured bishop and pawn in square order (b1, then b2), each at its starting square; the pawn returns to b2. The bishop's start b1 now holds the knight, so choosing it would offer the empty back-rank squares instead.",
    note: 'Ids: b1 B=0, e1 K=1, b2 P=2, c3 N=3, b8 r=4, e8 k=5. White answers the target prompt with the pawn (DD-97, DD-103).',
    setup: {
      fen: '1r2k3/8/8/8/8/2N5/1P6/1B2K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['necromancer'] },
      black: { elements: ['neutral'] },
      moves: ['c3e4', 'b8b2', 'e4c3', 'b2b1', 'c3b1'],
      answers: [{ kind: 'piece', piece: 2, square: sq('b2') }],
    },
  },
  {
    id: 'E11',
    title: 'Quantum Kill: a pawn takes a knight and a second piece with it',
    setupText:
      'White pawn d4 (Quantum Kill) takes a black knight on e5; Black has pawns on a7 and h7 and a rook on a8',
    specText:
      'Rank 2 > rank 1: the owner picks one enemy piece of rank ≤ 1 to effect-capture (a7 or h7; the rook and king are never offered). With no such piece the pawn could make one non-capturing move instead.',
    note: 'Ids: e1 K=0, d4 P=1, e5 n=2, a7 p=3, h7 p=4, a8 r=5, e8 k=6. White answers the target prompt with the h7 pawn (DD-97, DD-103).',
    setup: {
      fen: 'r3k3/p6p/8/4n3/3P4/8/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['quantum_kill'] },
      black: { elements: ['neutral'] },
      moves: ['d4e5'],
      answers: [{ kind: 'piece', piece: 4, square: sq('h7') }],
    },
  },
  {
    id: 'E12',
    title: 'Obstinate: a queen may not take the knight, and the denial reveals it',
    setupText:
      'White queen d1 and knight c3; Black knight d5 (Obstinate) and pawn a7. Black plays a7a6',
    specText:
      "At Settle White sees their legal moves: the queen (rank 4) may not capture the knight (rank 2), the knight c3 may. That difference reveals Obstinate on Black's knights; an effect capture would still remove the knight.",
    note: 'Ids: d1 Q=0, e1 K=1, c3 N=2, d5 n=3, a7 p=4, e8 k=5. No prompt (DD-97, DD-99).',
    setup: {
      fen: '4k3/p7/8/3n4/8/2N5/8/3QK3 b - - 0 1',
      format: 'full',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['obstinate'] },
      moves: ['a7a6'],
    },
  },
  {
    id: 'E13',
    title: 'Block Path: the rook turns east and the rook on its rank cannot take it',
    setupText:
      'White rook a1 (Block Path) moves to a4; Black rooks a8 and h4. White turns the rook to face east (b4)',
    specText:
      "After the move White may face the rook anew (declinable; the current facing N is not offered, off-board directions neither). Facing east, the rook h4 may not capture it while the rook a8 (north) may; the missing capture reveals Block Path on White's rooks and the facing becomes visible to Black.",
    note: 'Ids: a1 R=0, e1 K=1, h4 r=2, a8 r=3, e8 k=4. White answers the facing prompt with b4 (DD-99, DD-105).',
    setup: {
      fen: 'r3k3/8/8/8/7r/8/8/R3K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['block_path'] },
      black: { elements: ['neutral'] },
      moves: ['a1a4'],
      answers: [{ kind: 'square', square: sq('b4') }],
    },
  },
  {
    id: 'E14',
    title: 'Stalwart: Cleave cannot remove the pawn; only venom or a move could',
    setupText:
      'White knight c3 (Cleave) takes the black knight d5; the black pawn e6 (Stalwart) is diagonal to d5',
    specText:
      "Cleave's effect capture of the pawn fizzles (reason stalwart_guard) and Stalwart is revealed on Black's pawns; no charge is spent. Poisoned Meat (venom) or a capturing move would still take the pawn.",
    note: 'Ids: e1 K=0, c3 N=1, d5 n=2, e6 p=3, e8 k=4. No prompt: the pawn is the only target (DD-102).',
    setup: {
      fen: '4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['cleave'] },
      black: { elements: ['neutral'], abilities: ['stalwart'] },
      moves: ['c3d5'],
    },
  },
  {
    id: 'E15',
    title: 'Electric Slide: the bishop turns at its rook and checks through the corner',
    setupText:
      'White (Storm, Electric Slide) bishop c1, rook e1, king a1; Black king b6. The rook goes to e3',
    specText:
      "The bishop's c1-h6 diagonal now meets its rook on e3 and turns north-west: the king on b6 is in check through the turn (attacks follow the paths), may not step along that diagonal to c5, and Electric Slide is revealed on White's bishops. Unattuned, the same move gives no check (DD-111: a rook outranks the bishop, so it is a corner for it; a pawn on e3 would block).",
    note: 'Ids: a1 K=0, c1 B=1, e1 R=2, b6 k=3. No prompt (DD-104, DD-111).',
    setup: {
      fen: '8/8/1k6/8/8/8/8/K1B1R3 w - - 0 1',
      format: 'full',
      white: { elements: ['storm'], abilities: ['electric_slide'] },
      black: { elements: ['neutral'] },
      moves: ['e1e3'],
    },
  },
  {
    id: 'E16',
    title: 'Redo: the rook takes the knight and time turns back two plies',
    setupText:
      'White rook a1, king e1; Black knight d5 (Redo), pawn h7, king e8. White a1-d1, Black h7-h6, White d1xd5',
    specText:
      "Rank 3 ≥ rank 2: Redo triggers and the position returns to before Black's h7-h6 (the pawn on h7, the knight on d5, the rook on d1, Black to move at ply 1); Redo's charge is spent and it is revealed on Black's knights; the undone plies leave the repetition history; no objective is adjudicated.",
    note: 'Ids: a1 R=0, e1 K=1, d5 n=2, h7 p=3, e8 k=4. No prompt (DD-97, DD-100).',
    setup: {
      fen: '4k3/7p/8/3n4/8/8/8/R3K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['redo'] },
      moves: ['a1d1', 'h7h6', 'd1d5'],
    },
  },
  {
    id: 'E17',
    title: "Schr\u00f6dinger's Joker: the knight that beat a rook becomes two",
    setupText:
      "White knight c3 (Schr\u00f6dinger's Joker), king e1; Black rook d5, pawn h7, king e8. White c3xd5, Black h7-h6, White e1-f1 and the twin's move d5-f6",
    specText:
      "Rank 3 > rank 2: the capture spawns a twin that waits on d5. On White's next turn, after the king move, the owner is asked for the twin's move: the knight moves out to f6 and the twin takes d5 (two knights, one group). Capturing either later removes both.",
    note: 'Ids: e1 K=0, c3 N=1, d5 r=2, h7 p=3, e8 k=4; the twin is piece 5. White answers the twin prompt with d5-f6 (DD-97, DD-101).',
    setup: {
      fen: '4k3/7p/8/3r4/8/2N5/8/4K3 w - - 0 1',
      format: 'full',
      white: { elements: ['neutral'], abilities: ['schrodingers_joker'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5', 'h7h6', 'e1f1'],
      answers: [{ kind: 'move', from: sq('d5'), to: sq('f6') }],
    },
  },
];

export function workedExample(id: WorkedExampleId): WorkedExample {
  const ex = WORKED_EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`unknown worked example ${id}`);
  return ex;
}
