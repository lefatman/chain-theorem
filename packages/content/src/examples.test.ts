/**
 * The worked-example data the Scenario Lab loads (spec 5.5, R-TEST-001) must run to completion
 * through scenario() and still show each example's key outcome. The full assertions and event
 * snapshots live in test/golden.test.ts; this keeps the lab's copy of the setups honest.
 */
import { describe, expect, it } from 'vitest';
import { parseSquare, squareName } from '@chain-theorem/rules';
import { WORKED_EXAMPLES, type WorkedExampleId, workedExample } from './examples.ts';
import { type ScenarioResult, eventsOf, idAt, scenario } from './testing.ts';

const sq = parseSquare;

const fizzles = (r: ScenarioResult) =>
  eventsOf(r.events, 'EffectFizzled').map((e) => `${e.ability}:${e.reason}`);

/** One line per example: the result column of spec 5.5 reduced to its decisive facts. */
const KEY_OUTCOME: Record<WorkedExampleId, (r: ScenarioResult) => void> = {
  E1: (r) =>
    expect([idAt(r.state, 'c3'), idAt(r.state, 'd5'), fizzles(r)]).toEqual([
      -1,
      -1,
      ['hit_and_run:no_body'],
    ]),
  E2: (r) =>
    expect([
      idAt(r.state, 'c3'),
      eventsOf(r.events, 'AbilityNegated').map((e) => e.ability),
    ]).toEqual([1, ['poisoned_meat']]),
  E3: (r) =>
    expect([idAt(r.state, 'e2'), fizzles(r)]).toEqual([0, ['poisoned_meat:royal_immunity']]),
  E4: (r) =>
    expect([r.state.pieces[0]?.square, r.state.result]).toEqual([
      -1,
      { winner: 'black', reason: 'objective' },
    ]),
  E5: (r) => expect([idAt(r.state, 'e5'), fizzles(r)]).toEqual([1, ['poisoned_meat:inv03']]),
  E6: (r) =>
    expect([
      idAt(r.state, 'g6'),
      r.state.pieces[1]?.square,
      Math.max(...r.events.map((e) => e.depth)),
    ]).toEqual([4, -1, 1]),
  E7: (r) =>
    expect([
      eventsOf(r.events, 'SquareIgnited').map((e) => squareName(e.square)),
      eventsOf(r.events, 'SquareExtinguished').map((e) => squareName(e.square)),
    ]).toEqual([['e5'], ['e5']]),
  E8: (r) =>
    expect([
      eventsOf(r.events, 'Check').map((e) => e.side),
      idAt(r.state, 'a5'),
      idAt(r.state, 'a2'),
    ]).toEqual([['black'], 0, 2]),
  E9: (r) =>
    expect([
      eventsOf(r.events, 'PieceRevived').length,
      r.state.pieces[0]?.square,
      r.state.usage['0:rebirth'],
    ]).toEqual([2, -1, 2]),
  E10: (r) =>
    expect([
      eventsOf(r.events, 'PieceRevived').map((e) => [e.piece, squareName(e.square)]),
      r.state.pieces[0]?.square,
      idAt(r.state, 'b1'),
    ]).toEqual([[[2, 'b2']], -1, 3]),
  E11: (r) =>
    expect([
      eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by]),
      idAt(r.state, 'a7'),
      idAt(r.state, 'h7'),
    ]).toEqual([
      [
        [2, 'move'],
        [4, 'effect'],
      ],
      3,
      -1,
    ]),
  E12: (r) =>
    expect([
      r.state.reveals.black.abilities.knight,
      r.engine.legalMoves(r.state, 'white').some((m) => m.from === sq('d1') && m.to === sq('d5')),
      r.engine.legalMoves(r.state, 'white').some((m) => m.from === sq('c3') && m.to === sq('d5')),
    ]).toEqual([['obstinate'], false, true]),
  E13: (r) =>
    expect([
      eventsOf(r.events, 'FacingSet').map((e) => [e.piece, e.facing]),
      r.state.reveals.white.abilities.rook,
      r.engine.legalMoves(r.state, 'black').some((m) => m.from === sq('h4') && m.to === sq('a4')),
      r.engine.legalMoves(r.state, 'black').some((m) => m.from === sq('a8') && m.to === sq('a4')),
    ]).toEqual([[[0, 'E']], ['block_path'], false, true]),
  E14: (r) =>
    expect([fizzles(r), r.state.reveals.black.abilities.pawn, idAt(r.state, 'e6')]).toEqual([
      ['cleave:stalwart_guard'],
      ['stalwart'],
      3,
    ]),
  E15: (r) =>
    expect([
      eventsOf(r.events, 'Check').map((e) => e.side),
      r.state.reveals.white.abilities.bishop,
      r.engine.legalMoves(r.state, 'black').some((m) => m.from === sq('b6') && m.to === sq('c5')),
      r.engine.legalMoves(r.state, 'black').some((m) => m.from === sq('b6') && m.to === sq('a6')),
    ]).toEqual([['black'], ['electric_slide'], false, true]),
  E16: (r) =>
    expect([
      eventsOf(r.events, 'Rewound').map((e) => [e.toPly, e.plies]),
      r.state.turn,
      r.state.ply,
      idAt(r.state, 'd5'),
      idAt(r.state, 'h7'),
      r.state.usage['2:redo'],
    ]).toEqual([[[1, 2]], 'black', 1, 2, 3, 1]),
  E17: (r) =>
    expect([
      eventsOf(r.events, 'Spawned').map((e) => [e.piece, e.twinOf]),
      eventsOf(r.events, 'Emerged').map((e) => [e.piece, squareName(e.square)]),
      idAt(r.state, 'f6'),
      idAt(r.state, 'd5'),
      r.state.links,
    ]).toEqual([[[5, 1]], [[5, 'd5']], 1, 5, [{ ability: 'schrodingers_joker', members: [1, 5] }]]),
};

describe('R-TEST-001 worked examples as lab data (spec 5.5)', () => {
  it('R-TEST-001 lists E1 to E17 once each, in order, with the spec result text', () => {
    expect(WORKED_EXAMPLES.map((e) => e.id)).toEqual([
      'E1',
      'E2',
      'E3',
      'E4',
      'E5',
      'E6',
      'E7',
      'E8',
      'E9',
      'E10',
      'E11',
      'E12',
      'E13',
      'E14',
      'E15',
      'E16',
      'E17',
    ]);
    for (const e of WORKED_EXAMPLES) expect(e.specText.length).toBeGreaterThan(20);
  });

  for (const ex of WORKED_EXAMPLES) {
    it(`R-TEST-001 ${ex.id} runs through scenario() and matches the key outcome`, () => {
      const r = scenario(ex.setup);
      expect(r.state.pending).toBeNull();
      expect(r.steps).toHaveLength(ex.setup.moves?.length ?? 0);
      KEY_OUTCOME[ex.id](r);
    });
  }

  it('R-TEST-001 E3 variant: a Stalwart king also survives by Royal Immunity', () => {
    const r = scenario(workedExample('E3').variants?.[0]?.setup ?? {});
    expect([idAt(r.state, 'e2'), fizzles(r)]).toEqual([0, ['poisoned_meat:royal_immunity']]);
  });

  it('R-TEST-001 E8 variant: a neutral rook is blocked by its own pawn (no check)', () => {
    const r = scenario(workedExample('E8').variants?.[0]?.setup ?? {});
    expect([eventsOf(r.events, 'Check').length, r.state.inCheck]).toEqual([0, null]);
  });
});
