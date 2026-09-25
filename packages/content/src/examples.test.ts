/**
 * The worked-example data the Scenario Lab loads (spec 5.5, R-TEST-001) must run to completion
 * through scenario() and still show each example's key outcome. The full assertions and event
 * snapshots live in test/golden.test.ts; this keeps the lab's copy of the setups honest.
 */
import { describe, expect, it } from 'vitest';
import { squareName } from '@chain-theorem/rules';
import { WORKED_EXAMPLES, type WorkedExampleId, workedExample } from './examples.ts';
import { type ScenarioResult, eventsOf, idAt, scenario } from './testing.ts';

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
};

describe('R-TEST-001 worked examples as lab data (spec 5.5)', () => {
  it('R-TEST-001 lists E1 to E9 once each, in order, with the spec result text', () => {
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
