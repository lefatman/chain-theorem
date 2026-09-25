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

export type WorkedExampleId = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9';

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
    note: 'The bishop steps out and the rook captures it three times; White answers both attuned Rebirth prompts with c1. Ids: c1 B=0, e1 K=1, d8 r=2, e8 k=3.',
    setup: {
      fen: '3rk3/8/8/8/8/8/8/2B1K3 w - - 0 1',
      format: 'full',
      white: { elements: ['grove'], abilities: ['rebirth'] },
      black: { elements: ['neutral'] },
      moves: ['c1d2', 'd8d2', 'c1b2', 'd2b2', 'c1d2', 'b2d2'],
      answers: [
        { kind: 'square', square: sq('c1') },
        { kind: 'square', square: sq('c1') },
      ],
    },
  },
];

export function workedExample(id: WorkedExampleId): WorkedExample {
  const ex = WORKED_EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`unknown worked example ${id}`);
  return ex;
}
