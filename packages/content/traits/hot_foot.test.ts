/**
 * Hot Foot scenario tests (Ember trait, R-ELEM-001, R-ELEM-005, E7, DD-19, DD-24, DD-25, DD-33).
 *
 * Expected behaviour comes from spec 6.1 (Hot Foot rules), 5.4, 5.5 E7 and the delegated decisions
 * DD-17, DD-19, DD-24, DD-25 and DD-33, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type Engine,
  type GameState,
  type Side,
  moveToUci,
  squareName,
} from '@chain-theorem/rules';
import {
  type Answer,
  type ScenarioSpec,
  type ScenarioStep,
  eventsOf,
  idAt,
  parseSquare,
  pieceAt,
  play,
  setup,
} from '../src/testing.ts';
import type { HotFootState } from './hot_foot.ts';

const sq = parseSquare;
const hot = (s: { slices: Record<string, unknown> }) => s.slices.hot_foot as HotFootState;
const burn = (square: string, side: Side, turns: number) => ({ sq: sq(square), side, turns });

/** Plays `moves` from a spec, keeping every intermediate state (states[0] is the start). */
function walk(spec: ScenarioSpec, moves: string[], answers: Answer[] = []) {
  const { engine, state } = setup(spec);
  const states: GameState[] = [state];
  const steps: ScenarioStep[] = [];
  let s = state;
  const queue = [...answers];
  for (const m of moves) {
    const r = play(engine, s, m, queue);
    s = r.state;
    states.push(s);
    steps.push(r.step);
  }
  return { engine, states, steps, state: s };
}

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

const kinds = (events: readonly BattleEvent[]) => events.map((e) => e.k);

describe('hot_foot (R-ELEM-005)', () => {
  it('R-ELEM-005 E7 an Ember move capture leaves a pending burn that ignites only when that piece leaves the square', () => {
    // 1. Nf3xe5 ... 3. Ne5-f3: the knight leaves e5 two turns after capturing there.
    const w = walk(
      {
        fen: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'e8d8', 'e1e2', 'd8e8', 'e5f3'],
    );
    const knight = idAt(w.states[0] as GameState, 'f3');
    // The capture itself does not burn anything yet.
    expect(hot(w.states[1] as GameState)).toEqual({
      burning: [],
      pending: [{ piece: knight, sq: sq('e5') }],
    });
    for (const i of [0, 1, 2, 3])
      expect(eventsOf((w.steps[i] as ScenarioStep).events, 'SquareIgnited')).toEqual([]);
    // Other pieces moving leave the pending burn in place.
    expect(hot(w.states[4] as GameState)).toEqual({
      burning: [],
      pending: [{ piece: knight, sq: sq('e5') }],
    });
    const last = (w.steps[4] as ScenarioStep).events;
    expect(eventsOf(last, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('e5'), side: 'white', turns: 3 }),
    ]);
    expect(kinds(last).indexOf('SquareIgnited')).toBeGreaterThan(kinds(last).indexOf('MoveMade'));
    expect(hot(w.state)).toEqual({ burning: [burn('e5', 'white', 3)], pending: [] });
  });

  it('R-ELEM-005 only a move capture by an Ember piece starts a burn: a non-Ember capture or an Ember non-capturing move leaves nothing', () => {
    const tide = walk(
      {
        fen: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['tide'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'e8d8', 'e5f3'],
    );
    expect(hot(tide.states[1] as GameState)).toEqual({ burning: [], pending: [] });
    expect(hot(tide.state)).toEqual({ burning: [], pending: [] });
    expect(tide.steps.flatMap((s) => eventsOf(s.events, 'SquareIgnited'))).toEqual([]);

    const quiet = walk(
      {
        fen: '4k3/8/8/8/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'e8d8', 'e5f3'],
    );
    expect(hot(quiet.states[1] as GameState)).toEqual({ burning: [], pending: [] });
    expect(hot(quiet.state)).toEqual({ burning: [], pending: [] });
    expect(quiet.steps.flatMap((s) => eventsOf(s.events, 'SquareIgnited'))).toEqual([]);
  });

  it('R-ELEM-005 Hit and Run ignites the capture square immediately, and non-Ember pieces then cannot stop there but slide over it', () => {
    // Ember knight (Hit and Run is Tide-affine, so the base version: back to c3) takes d5.
    const w = walk(
      {
        fen: '3rk3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { elements: ['ember'], abilities: ['hit_and_run'] },
        black: { elements: ['neutral'] },
      },
      ['c3d5'],
    );
    const ev = (w.steps[0] as ScenarioStep).events;
    const k = kinds(ev);
    expect(k.indexOf('Captured')).toBeLessThan(k.indexOf('MoveMade'));
    expect(k.indexOf('MoveMade')).toBeLessThan(k.indexOf('PieceMoved'));
    expect(k.indexOf('PieceMoved')).toBeLessThan(k.indexOf('SquareIgnited'));
    expect(k.indexOf('SquareIgnited')).toBeLessThan(k.indexOf('TurnPassed'));
    expect(eventsOf(ev, 'PieceMoved')).toEqual([
      expect.objectContaining({ from: sq('d5'), to: sq('c3') }),
    ]);
    expect(eventsOf(ev, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('d5'), side: 'white', turns: 3 }),
    ]);
    expect(hot(w.state)).toEqual({ burning: [burn('d5', 'white', 3)], pending: [] });
    // The black (neutral) rook may not stop on d5 but slides over it down the file.
    expect(dests(w.engine, w.state, 'black', 'd8')).toEqual(
      ['a8', 'b8', 'c8', 'd7', 'd6', 'd4', 'd3', 'd2', 'd1'].sort(),
    );
  });

  it('R-ELEM-005 being captured on the pending square (by a move) does not ignite it and clears the pending burn', () => {
    const w = walk(
      {
        fen: '4k3/8/3p4/4p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'd6e5'],
    );
    expect(hot(w.states[1] as GameState).pending).toEqual([
      { piece: idAt(w.states[0] as GameState, 'f3'), sq: sq('e5') },
    ]);
    expect(w.steps.flatMap((s) => eventsOf(s.events, 'SquareIgnited'))).toEqual([]);
    expect(hot(w.state)).toEqual({ burning: [], pending: [] });
    expect(pieceAt(w.state, 'e5')?.side).toBe('black');
  });

  it('R-ELEM-005 R-ABIL-004 an Ember captor removed by an effect capture on the pending square does not ignite it', () => {
    const w = walk(
      {
        fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      },
      ['c3d5'],
    );
    const knight = idAt(w.states[0] as GameState, 'c3');
    expect(eventsOf((w.steps[0] as ScenarioStep).events, 'Captured')).toEqual([
      expect.objectContaining({ victimType: 'pawn', by: 'move' }),
      expect.objectContaining({ victim: knight, by: 'effect', square: sq('d5') }),
    ]);
    expect(eventsOf((w.steps[0] as ScenarioStep).events, 'SquareIgnited')).toEqual([]);
    expect(hot(w.state)).toEqual({ burning: [], pending: [] });
  });

  it('R-ELEM-005 R-ABIL-003 a Momentum bonus move off the pending square ignites it within the same action', () => {
    const w = walk(
      {
        fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { elements: ['ember'], abilities: ['momentum'] },
        black: { elements: ['neutral'] },
      },
      ['c3d5'],
      [{ kind: 'move', from: sq('d5'), to: sq('b4') }],
    );
    const ev = (w.steps[0] as ScenarioStep).events;
    const bonus = eventsOf(ev, 'MoveMade').find((e) => e.bonus);
    expect(bonus).toMatchObject({ from: sq('d5'), to: sq('b4') });
    expect(eventsOf(ev, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('d5'), side: 'white', turns: 3 }),
    ]);
    expect(ev.findIndex((e) => e.k === 'SquareIgnited')).toBeGreaterThan(
      ev.findIndex((e) => e.k === 'MoveMade' && e.bonus),
    );
    expect(hot(w.state)).toEqual({ burning: [burn('d5', 'white', 3)], pending: [] });
    expect(pieceAt(w.state, 'b4')?.type).toBe('knight');
  });

  it('R-ELEM-005 DD-24 a bonus-action move capture by an Ember piece (Riposte) starts a pending burn', () => {
    // 1. Nc3xd5; Riposte lets the black Ember bishop f7 take the knight on d5 as a bonus move.
    const w = walk(
      {
        fen: '4k3/5b2/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { elements: ['neutral'] },
        black: { elements: ['ember'], abilities: ['riposte'] },
      },
      ['c3d5', 'd5e6'],
      [{ kind: 'move', from: sq('f7'), to: sq('d5') }],
    );
    const bishop = idAt(w.states[0] as GameState, 'f7');
    const first = (w.steps[0] as ScenarioStep).events;
    expect(eventsOf(first, 'MoveMade').find((e) => e.bonus)).toMatchObject({
      piece: bishop,
      to: sq('d5'),
      capture: true,
    });
    expect(hot(w.states[1] as GameState)).toEqual({
      burning: [],
      pending: [{ piece: bishop, sq: sq('d5') }],
    });
    expect(eventsOf((w.steps[1] as ScenarioStep).events, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('d5'), side: 'black', turns: 3 }),
    ]);
    expect(hot(w.state)).toEqual({ burning: [burn('d5', 'black', 3)], pending: [] });
  });

  it('R-ELEM-005 DD-24 R-ELEM-004 the element after promotion decides whether a capturing pawn leaves a pending burn', () => {
    const fen = '4k2r/6P1/8/8/8/8/8/4K3 w - - 0 1';
    const cases: [string[], string, boolean][] = [
      [['ember', 'tide'], 'g7h8q', false], // Ember pawn becomes a Tide queen
      [['ember', 'tide'], 'g7h8n', true], // Ember pawn becomes an Ember knight
      [['tide', 'ember'], 'g7h8q', true], // Tide pawn becomes an Ember queen
      [['tide', 'ember'], 'g7h8n', false], // Tide pawn becomes a Tide knight
    ];
    for (const [elements, uci, pending] of cases) {
      const w = walk(
        {
          fen,
          white: { elements: elements as ['ember', 'tide'], items: ['blended_family'] },
          black: { elements: ['neutral'] },
        },
        [uci],
      );
      const pawn = idAt(w.states[0] as GameState, 'g7');
      expect(hot(w.state), `${elements.join('/')} ${uci}`).toEqual({
        burning: [],
        pending: pending ? [{ piece: pawn, sq: sq('h8') }] : [],
      });
    }
    // The promoted Ember queen igniting h8 when it leaves.
    const w = walk(
      {
        fen,
        white: { elements: ['tide', 'ember'], items: ['blended_family'] },
        black: { elements: ['neutral'] },
      },
      ['g7h8q', 'e8d7', 'h8h1'],
    );
    expect(eventsOf((w.steps[2] as ScenarioStep).events, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('h8'), side: 'white', turns: 3 }),
    ]);
  });

  it('R-ELEM-005 non-Ember pieces of both sides cannot move to or capture on a burning square; Ember pieces of both sides use it normally', () => {
    // White: Ember knight/bishop, Tide rook and king. Black: Ember knight/pawn, Grove rook and king.
    const w = walk(
      {
        fen: 'k3r3/3n4/8/4p3/8/2B2N2/8/K3R3 w - - 0 1',
        white: { elements: ['ember', 'tide'], items: ['blended_family'] },
        black: { elements: ['ember', 'grove'], items: ['blended_family'] },
      },
      ['f3e5', 'a8b8', 'e5f3', 'b8a8'],
    );
    let state = w.state;
    expect(hot(state).burning).toEqual([burn('e5', 'white', 2)]);
    // White (the igniting side): its Tide rook may not stop on e5 but slides over it.
    let moves = legal(w.engine, state, 'white');
    expect(moves).not.toContain('e1e5');
    expect(moves).toContain('e1e6');
    expect(moves).toContain('e1e8');
    expect(moves).toContain('c3e5'); // Ember bishop
    expect(moves).toContain('f3e5'); // Ember knight
    state = play(w.engine, state, 'a1b1').state;
    // Black: the Grove rook may not stop on e5 but slides over it; the Ember knight may enter.
    moves = legal(w.engine, state, 'black');
    expect(moves).not.toContain('e8e5');
    expect(moves).toContain('e8e4');
    expect(moves).toContain('e8e1');
    expect(moves).toContain('d7e5');
    state = play(w.engine, state, 'd7e5').state;
    expect(pieceAt(state, 'e5')?.type).toBe('knight');
    // An Ember piece on the burning square: the Tide rook cannot take it, Ember pieces can.
    moves = legal(w.engine, state, 'white');
    expect(moves).not.toContain('e1e5');
    expect(moves).toContain('c3e5');
    expect(moves).toContain('f3e5');
    state = play(w.engine, state, 'c3e5').state;
    expect(pieceAt(state, 'e5')).toMatchObject({ side: 'white', type: 'bishop' });
    // The Grove rook cannot take the Ember bishop standing on the burning square.
    moves = legal(w.engine, state, 'black');
    expect(moves).not.toContain('e8e5');
    expect(moves).toContain('e8e6');
  });

  it('R-ELEM-005 an Ember king on a burning square cannot be checked by non-Ember pieces, while a slider still attacks the squares beyond it', () => {
    const fen = 'k3r3/8/8/8/4n3/2NK4/8/8 w - - 0 1';
    const moves = ['c3e4', 'a8b8', 'e4c3', 'b8a8'];
    const w = walk(
      { fen, white: { elements: ['ember'] }, black: { elements: ['neutral'] } },
      moves,
    );
    expect(hot(w.state).burning).toEqual([burn('e4', 'white', 2)]);
    const king = legal(w.engine, w.state, 'white');
    expect(king).toContain('d3e4'); // the rook cannot capture on e4, so e4 is not attacked
    expect(king).not.toContain('d3e3'); // the rook's line passes over e4
    expect(king).not.toContain('d3e2');
    const r = play(w.engine, w.state, 'd3e4');
    expect(pieceAt(r.state, 'e4')?.type).toBe('king');
    expect(r.state.inCheck).toBeNull();
    expect(eventsOf(r.step.events, 'Check')).toEqual([]);

    // An Ember rook uses the square normally, so it does attack e4.
    const ember = walk({ fen, white: { elements: ['ember'] }, black: { elements: ['ember'] } }, moves);
    expect(legal(ember.engine, ember.state, 'white')).not.toContain('d3e4');
  });

  it('R-ELEM-005 DD-19 effect captures still reach an Ember piece on a burning square (Cleave)', () => {
    // White burns d5, pushes its Ember pawn onto it; the black knight cannot take it by a move but
    // its Cleave effect-captures it.
    const w = walk(
      {
        fen: '4k3/8/5n2/3p4/3PP3/2N5/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'], abilities: ['cleave'] },
      },
      ['c3d5', 'e8d8', 'd5c3', 'd8e8', 'd4d5'],
    );
    const pawn = idAt(w.state, 'd5');
    expect(pieceAt(w.state, 'd5')).toMatchObject({ side: 'white', type: 'pawn' });
    expect(hot(w.state).burning).toEqual([burn('d5', 'white', 2)]);
    const moves = legal(w.engine, w.state, 'black');
    expect(moves).not.toContain('f6d5');
    expect(moves).toContain('f6e4');
    const r = play(w.engine, w.state, 'f6e4');
    expect(r.step.prompts).toEqual([]);
    expect(eventsOf(r.step.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('e4'), by: 'move' }),
      expect.objectContaining({ victim: pawn, square: sq('d5'), by: 'effect' }),
    ]);
    expect(eventsOf(r.step.events, 'EffectFizzled')).toEqual([]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ELEM-005 DD-25 the burn counts only the igniting player’s opponent’s turns and ends after the third with SquareExtinguished', () => {
    const w = walk(
      {
        fen: '3k4/8/8/r3p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'd8c8', 'e5f3', 'c8d8', 'e1e2', 'd8c8', 'e2e1', 'c8d8'],
    );
    const turnsAfter = w.states.slice(3).map((s) => hot(s).burning.map((b) => b.turns));
    // After the ignition (white), black, white, black, white, black.
    expect(turnsAfter).toEqual([[3], [2], [2], [1], [1], []]);
    const ignited = w.states[3] as GameState;
    const rook = dests(w.engine, ignited, 'black', 'a5');
    expect(rook).not.toContain('e5');
    expect(rook).toEqual(expect.arrayContaining(['d5', 'f5', 'g5', 'h5']));
    for (const i of [2, 3, 4, 5, 6])
      expect(eventsOf((w.steps[i] as ScenarioStep).events, 'SquareExtinguished')).toEqual([]);
    expect(eventsOf((w.steps[7] as ScenarioStep).events, 'SquareExtinguished')).toEqual([
      expect.objectContaining({ square: sq('e5') }),
    ]);
    // Once extinguished, the non-Ember rook may enter e5 again.
    const after = play(w.engine, w.state, 'e1e2').state;
    expect(dests(w.engine, after, 'black', 'a5')).toContain('e5');
  });

  it('R-ELEM-005 igniting a burning square again resets its count', () => {
    // The black Ember knight enters the burning e5, the white Ember knight captures it there and
    // leaves again: e5 re-ignites with a fresh count of 3.
    const w = walk(
      {
        fen: 'k7/8/6n1/4p3/8/5N2/8/K7 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['ember'] },
      },
      ['f3e5', 'a8b8', 'e5f3', 'g6e5', 'f3e5', 'b8a8', 'e5f3', 'a8b8'],
    );
    expect(hot(w.states[5] as GameState).burning).toEqual([burn('e5', 'white', 2)]);
    expect(hot(w.states[6] as GameState).burning).toEqual([burn('e5', 'white', 1)]);
    expect(eventsOf((w.steps[6] as ScenarioStep).events, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('e5'), side: 'white', turns: 3 }),
    ]);
    expect(hot(w.states[7] as GameState).burning).toEqual([burn('e5', 'white', 3)]);
    // Under the old count e5 would have gone out on this black turn.
    expect(eventsOf((w.steps[7] as ScenarioStep).events, 'SquareExtinguished')).toEqual([]);
    expect(hot(w.state).burning).toEqual([burn('e5', 'white', 2)]);
  });

  it('R-ELEM-005 when the opponent re-ignites a burning square, the count restarts against the new igniting player', () => {
    const w = walk(
      {
        fen: 'k7/8/6n1/4p3/8/5N2/8/K7 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['ember'] },
      },
      ['f3e5', 'a8b8', 'e5f3', 'b8a8', 'f3e5', 'g6e5', 'a1b1', 'e5g6', 'b1a1'],
    );
    expect(hot(w.states[6] as GameState).burning).toEqual([burn('e5', 'white', 1)]);
    expect(eventsOf((w.steps[7] as ScenarioStep).events, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('e5'), side: 'black', turns: 3 }),
    ]);
    // Black's own turn does not count down black's burn; white's next turn does.
    expect(hot(w.states[8] as GameState).burning).toEqual([burn('e5', 'black', 3)]);
    expect(hot(w.state).burning).toEqual([burn('e5', 'black', 2)]);
  });

  it('R-ELEM-005 DD-17 an effect cannot place a non-Ember piece on a burning square: Rebirth fizzles (burning) and keeps its charge', () => {
    // The Ember knight takes the bishop on its start square c8 and Hit and Run carries it back to
    // b6, igniting c8 before Rebirth resolves at chain end.
    const spec = (element: 'neutral' | 'ember'): ScenarioSpec => ({
      fen: '2b1k3/8/1N6/8/8/8/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['hit_and_run'] },
      black: { elements: [element], abilities: ['rebirth'] },
    });
    const w = walk(spec('neutral'), ['b6c8']);
    const bishop = idAt(w.states[0] as GameState, 'c8');
    const ev = (w.steps[0] as ScenarioStep).events;
    expect(eventsOf(ev, 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('c8'), side: 'white' }),
    ]);
    expect(eventsOf(ev, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        side: 'black',
        ability: 'rebirth',
        reason: 'burning',
        source: expect.objectContaining({ kind: 'trait', id: 'hot_foot' }),
      }),
    ]);
    expect(kinds(ev).indexOf('SquareIgnited')).toBeLessThan(kinds(ev).indexOf('EffectFizzled'));
    expect(eventsOf(ev, 'PieceRevived')).toEqual([]);
    expect(eventsOf(ev, 'ChargeSpent')).toEqual([]);
    expect(w.state.pieces[bishop]?.square).toBe(-1);
    expect(w.engine.remainingCharges(w.state, bishop, 'rebirth')).toBe(1);

    // An Ember piece may be placed there.
    const e = walk(spec('ember'), ['b6c8']);
    expect(eventsOf((e.steps[0] as ScenarioStep).events, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: bishop, square: sq('c8') }),
    ]);
    expect(pieceAt(e.state, 'c8')?.id).toBe(bishop);
  });

  it('R-ELEM-005 DD-19 burning squares are not offered to a non-Ember piece (attuned Hit and Run), but are to an Ember piece', () => {
    // Black's Ember knight burns d4 (adjacent to c3); then white's knight takes d5 from c3.
    const fen = '7k/8/8/3p1n2/3P4/2N5/8/7K b - - 0 1';
    const moves = ['f5d4', 'h1g1', 'd4f5', 'c3d5'];
    const opts = (req: { options: unknown[] } | undefined) =>
      (req?.options ?? []).map((o) => squareName((o as { square: number }).square));

    const tide = walk(
      {
        fen,
        white: { elements: ['tide'], abilities: ['hit_and_run'] },
        black: { elements: ['ember'] },
      },
      moves,
    );
    const prompt = (tide.steps[3] as ScenarioStep).prompts[0];
    expect(prompt?.kind).toBe('square');
    expect(opts(prompt)).toEqual(['b2', 'c2', 'd2', 'b3', 'c3', 'd3', 'b4', 'c4']);

    // With the Attunement Charm (Tide) an Ember knight gets the attuned version; d4 is allowed.
    const ember = walk(
      {
        fen,
        white: {
          elements: ['ember'],
          abilities: ['hit_and_run'],
          items: ['attunement_charm'],
          itemParams: { attunement_charm: { element: 'tide' } },
        },
        black: { elements: ['ember'] },
      },
      moves,
    );
    expect(opts((ember.steps[3] as ScenarioStep).prompts[0])).toEqual([
      'b2',
      'c2',
      'd2',
      'b3',
      'c3',
      'd3',
      'b4',
      'c4',
      'd4',
    ]);
  });

  it('R-ELEM-005 DD-24 castling is illegal when the king’s or rook’s destination burns for that piece; a square the rook only passes is fine', () => {
    // White Ember knights burn one back-rank square; the Tide king and rooks are non-Ember.
    const cases: { burn: string; knight: string; fen: string; ks: boolean; qs: boolean }[] = [
      { burn: 'g1', knight: 'h3', fen: '4k3/8/8/8/8/7N/8/R3K1nR w KQ - 0 1', ks: false, qs: true },
      { burn: 'f1', knight: 'g3', fen: '4k3/8/8/8/8/6N1/8/R3Kn1R w KQ - 0 1', ks: false, qs: true },
      { burn: 'd1', knight: 'c3', fen: '4k3/8/8/8/8/2N5/8/R2nK2R w KQ - 0 1', ks: true, qs: false },
      { burn: 'c1', knight: 'b3', fen: '4k3/8/8/8/8/1N6/8/R1n1K2R w KQ - 0 1', ks: true, qs: false },
      { burn: 'b1', knight: 'c3', fen: '4k3/8/8/8/8/2N5/8/Rn2K2R w KQ - 0 1', ks: true, qs: true },
    ];
    for (const c of cases) {
      const w = walk(
        {
          fen: c.fen,
          white: { elements: ['ember', 'tide'], items: ['blended_family'] },
          black: { elements: ['neutral'] },
        },
        [`${c.knight}${c.burn}`, 'e8d8', `${c.burn}${c.knight}`, 'd8e8'],
      );
      expect(hot(w.state).burning, c.burn).toEqual([burn(c.burn, 'white', 2)]);
      const moves = legal(w.engine, w.state, 'white');
      expect(moves.includes('e1g1'), `O-O with ${c.burn} burning`).toBe(c.ks);
      expect(moves.includes('e1c1'), `O-O-O with ${c.burn} burning`).toBe(c.qs);
    }
    // An Ember king and rook castle onto a burning square normally.
    const ember = walk(
      {
        fen: '4k3/8/8/8/8/7N/8/R3K1nR w KQ - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['h3g1', 'e8d8', 'g1h3', 'd8e8'],
    );
    expect(legal(ember.engine, ember.state, 'white')).toContain('e1g1');
  });

  it('R-ELEM-005 DD-24 a non-Ember pawn cannot capture en passant an Ember pawn standing on a burning square', () => {
    // Black burns d5, then its Ember pawn double-pushes onto it.
    const fen = '7k/3p4/1n6/3NP3/8/8/8/7K b - - 0 1';
    const moves = ['b6d5', 'h1g1', 'd5b6', 'g1h1', 'd7d5'];
    const neutral = walk({ fen, white: { elements: ['neutral'] }, black: { elements: ['ember'] } }, moves);
    expect(hot(neutral.state).burning).toEqual([burn('d5', 'black', 2)]);
    expect(pieceAt(neutral.state, 'd5')).toMatchObject({ side: 'black', type: 'pawn' });
    const wm = legal(neutral.engine, neutral.state, 'white');
    expect(wm).not.toContain('e5d6');
    expect(wm).toContain('e5e6');

    // An Ember pawn uses the square normally, so it may capture en passant.
    const ember = walk({ fen, white: { elements: ['ember'] }, black: { elements: ['ember'] } }, moves);
    expect(legal(ember.engine, ember.state, 'white')).toContain('e5d6');
  });

  it('R-ELEM-005 R-INFO-005 burning squares are public: both players see them in project()', () => {
    const w = walk(
      {
        fen: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'e8d8', 'e5f3'],
    );
    for (const viewer of ['white', 'black'] as const) {
      const slice = w.engine.project(w.state, viewer).slices.hot_foot as HotFootState | undefined;
      expect(slice?.burning, viewer).toEqual([burn('e5', 'white', 3)]);
    }
  });

  it('R-ELEM-005 DD-33 burning squares are part of the repetition hash', () => {
    const w = walk(
      {
        fen: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1',
        white: { elements: ['ember'] },
        black: { elements: ['neutral'] },
      },
      ['f3e5', 'e8d8', 'e5f3'],
    );
    const h = w.engine.stateHash(w.state);
    const withSlice = (v: HotFootState): GameState => ({
      ...w.state,
      slices: { ...w.state.slices, hot_foot: v },
    });
    expect(w.engine.stateHash(withSlice({ burning: [], pending: [] }))).not.toBe(h);
    expect(w.engine.stateHash(withSlice({ burning: [burn('e5', 'white', 2)], pending: [] }))).not.toBe(
      h,
    );
    expect(w.engine.stateHash(withSlice({ burning: [burn('e5', 'white', 3)], pending: [] }))).toBe(h);
  });

  it('R-ELEM-005 DD-33 R-RULES-005 a board that recurs with a different burn does not count toward threefold repetition', () => {
    const shuffle = [
      'd8c8',
      'e1e2',
      'c8d8',
      'e2e1',
      'd8c8',
      'e1e2',
      'c8d8',
      'e2e1',
      'd8c8',
      'e1e2',
      'c8d8',
      'e2e1',
      'd8c8',
    ];
    const opening = ['f3e5', 'e8d8', 'e5f3'];
    const fen = '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1';
    // Without a burn, the position after the knight's return recurs a third time after 8 plies.
    const tide = walk(
      { fen, white: { elements: ['tide'] }, black: { elements: ['neutral'] } },
      [...opening, ...shuffle.slice(0, 8)],
    );
    expect(tide.state.result).toEqual({ winner: null, reason: 'repetition' });

    // With e5 burning (3, then 1, then out) those three boards differ; the first threefold
    // repetition is the board after black's move that recurs with no burn at plies 5, 9 and 13.
    const ember = walk(
      { fen, white: { elements: ['ember'] }, black: { elements: ['neutral'] } },
      [...opening, ...shuffle.slice(0, 12)],
    );
    expect(ember.state.result).toBeNull();
    const last = play(ember.engine, ember.state, shuffle[12] as string);
    expect(last.state.result).toEqual({ winner: null, reason: 'repetition' });
  });
});
