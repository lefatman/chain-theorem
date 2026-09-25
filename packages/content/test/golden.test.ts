/**
 * Golden tests (R-TEST-001, spec 17.1): the worked examples E1 to E9 of spec 5.5. Each example
 * asserts the outcome the table states (board, captures, triggers, fizzles, negations, reveals,
 * results) and snapshots the full event list so the resolution stays identical forever.
 *
 * Expected behaviour is derived from spec sections 4.3, 4.4, 5, 6.1 (Hot Foot, Flow, Overabundance),
 * 9.1 and the delegated decisions DD-10 to DD-40, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type ChoiceRequest,
  type Engine,
  type GameState,
  type PieceType,
  type Side,
  RulesError,
  moveToUci,
  squareName,
  uciToMove,
} from '@chain-theorem/rules';
import type { HotFootState } from '../traits/hot_foot.ts';
import {
  type ScenarioSpec,
  eventsOf,
  idAt,
  parseSquare,
  pieceAt,
  play,
  scenario,
  setup,
} from '../src/testing.ts';

const sq = parseSquare;
const NEUTRAL = ['neutral'] as const;

/**
 * Compact, order-preserving trace of the board- and ability-level events whose order the spec fixes
 * (5.3 phases, 5.4 queue order, DD-25 settle order). Nested events are prefixed with their depth.
 * ActionStarted, Revealed, ChoiceMade and ChargeSpent are asserted separately.
 */
function trace(events: readonly BattleEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const d = e.depth > 0 ? `d${e.depth} ` : '';
    switch (e.k) {
      case 'Captured':
        out.push(`${d}Captured ${e.victimSide} ${e.victimType}#${e.victim} by ${e.by}`);
        break;
      case 'MoveMade':
        out.push(
          `${d}MoveMade ${e.side} ${e.pieceType}#${e.piece} ${squareName(e.from)}-${squareName(e.to)}${e.bonus ? ' bonus' : ''}`,
        );
        break;
      case 'AbilityTriggered':
        out.push(`${d}Triggered ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'AbilityNegated':
        out.push(`${d}Negated ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'AbilitySilenced':
        out.push(`${d}Silenced ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'EffectFizzled':
        out.push(`${d}Fizzled ${e.side} ${e.ability ?? '?'} ${e.reason}`);
        break;
      case 'PieceMoved':
        out.push(`${d}PieceMoved #${e.piece} ${squareName(e.from)}-${squareName(e.to)}`);
        break;
      case 'PieceRevived':
        out.push(`${d}Revived #${e.piece} ${squareName(e.square)}`);
        break;
      case 'TurnPassed':
        out.push(`${d}TurnPassed ${e.side}`);
        break;
      case 'BattleEnded':
        out.push(`${d}BattleEnded ${e.result.winner ?? 'draw'} ${e.result.reason}`);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Answer that picks the move option `uci` of a bonus-move prompt. */
function pickMove(uci: string) {
  const m = uciToMove(uci);
  return (req: ChoiceRequest): number => {
    const idx = req.options.findIndex(
      (o) => o.kind === 'move' && o.from === m.from && o.to === m.to,
    );
    if (idx < 0) throw new Error(`move ${uci} is not offered: ${JSON.stringify(req.options)}`);
    return idx;
  };
}

/** Answer that picks the square option `name` of a square prompt. */
function pickSquare(name: string) {
  const s = sq(name);
  return (req: ChoiceRequest): number => {
    const idx = req.options.findIndex((o) => o.kind === 'square' && o.square === s);
    if (idx < 0) throw new Error(`square ${name} is not offered: ${JSON.stringify(req.options)}`);
    return idx;
  };
}

function legalUci(engine: Engine, state: GameState, side: Side): string[] {
  return engine.legalMoves(state, side).map(moveToUci).sort();
}

function hotFoot(state: GameState): HotFootState {
  return state.slices['hot_foot'] as HotFootState;
}

/** Revealed ability names logged about `side` for `pieceType`. */
function revealedOn(state: GameState, side: Side, pieceType: PieceType): string[] {
  return state.reveals[side].abilities[pieceType] ?? [];
}

// ---------------------------------------------------------------------------------------------------

describe('E1 Hit and Run knight captures a Poisoned Meat pawn (neutral elements)', () => {
  // e1 K=0, c3 N=1, d5 p=2, e8 k=3
  const spec: ScenarioSpec = {
    fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
    white: { elements: [...NEUTRAL], abilities: ['hit_and_run'] },
    black: { elements: [...NEUTRAL], abilities: ['poisoned_meat'] },
    moves: ['c3d5'],
  };

  it('E1 R-ABIL-003 R-ABIL-004 INV-05 pawn removed, Poisoned Meat removes the knight, Hit and Run fizzles with no body', () => {
    const r = scenario(spec);
    const knight = 1;
    const pawn = 2;

    // Both gone.
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(r.state.pieces[pawn]?.square).toBe(-1);

    // Victim's CAPTURED (Poisoned Meat) resolves before the captor's CAPTURES (Hit and Run), 5.3/5.4.
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'Triggered white hit_and_run',
      'Fizzled white hit_and_run no_body',
      'TurnPassed black',
    ]);
    const [moveCap, effCap] = eventsOf(r.events, 'Captured');
    expect(moveCap).toMatchObject({ victim: pawn, by: 'move', captor: knight, square: sq('d5') });
    expect(effCap).toMatchObject({
      victim: knight,
      by: 'effect',
      captor: pawn,
      source: { kind: 'ability', id: 'poisoned_meat', piece: pawn, side: 'black' },
    });
    expect(eventsOf(r.events, 'EffectFizzled')[0]).toMatchObject({
      piece: knight,
      ability: 'hit_and_run',
      effect: 'move',
      reason: 'no_body',
    });
    // Neutral elements: nothing is attuned, nothing is silenced.
    expect(eventsOf(r.events, 'AbilityTriggered').every((e) => !e.attuned)).toBe(true);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);

    // Both abilities are revealed with the piece type they were seen on (8.2).
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['hit_and_run']);

    expect(r.state.result).toBeNull();
    expect(r.state.turn).toBe('black');
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E2 as E1, but the knight also has Pierce', () => {
  // e1 K=0, c3 N=1, d5 p=2, e8 k=3
  const spec: ScenarioSpec = {
    fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
    white: { elements: [...NEUTRAL], abilities: ['hit_and_run', 'pierce'] },
    black: { elements: [...NEUTRAL], abilities: ['poisoned_meat'] },
    moves: ['c3d5'],
  };

  it('E2 R-ABIL-002 R-INFO-002 Pierce negates Poisoned Meat (revealed as negated) and the knight returns to its origin', () => {
    const r = scenario(spec);
    const knight = 1;
    const pawn = 2;

    // Pawn removed; the knight survives and is back on c3.
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(idAt(r.state, 'c3')).toBe(knight);
    expect(r.state.pieces[knight]?.square).toBe(sq('c3'));

    expect(trace(r.events)).toEqual([
      'Triggered white pierce',
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Negated black poisoned_meat',
      'Triggered white hit_and_run',
      'PieceMoved #1 d5-c3',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'AbilityNegated')[0]).toMatchObject({
      side: 'black',
      piece: pawn,
      pieceType: 'pawn',
      ability: 'poisoned_meat',
      category: 'CAPTURED',
      source: { kind: 'ability', id: 'pierce', piece: knight, side: 'white' },
    });
    expect(eventsOf(r.events, 'PieceMoved')[0]).toMatchObject({
      piece: knight,
      from: sq('d5'),
      to: sq('c3'),
      source: { kind: 'ability', id: 'hit_and_run', piece: knight, side: 'white' },
    });
    // Poisoned Meat is revealed with cause 'negated' (8.2); it never resolves.
    const pmReveal = eventsOf(r.events, 'Revealed').filter(
      (e) => e.side === 'black' && e.info.kind === 'ability' && e.info.ability === 'poisoned_meat',
    );
    expect(pmReveal.map((e) => e.cause)).toEqual(['negated']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect([...revealedOn(r.state, 'white', 'knight')].sort()).toEqual(['hit_and_run', 'pierce']);

    expect(r.state.result).toBeNull();
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E3 a king captures a Poisoned Meat pawn', () => {
  // e1 K=0, e2 p=1, e8 k=2
  const fen = '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1';
  const black = { elements: [...NEUTRAL], abilities: ['poisoned_meat'] };
  const expectedTrace = [
    'Captured black pawn#1 by move',
    'MoveMade white king#0 e1-e2',
    'Triggered black poisoned_meat',
    'Fizzled black poisoned_meat royal_immunity',
    'TurnPassed black',
  ];

  it('E3 R-RULES-004 INV-02 INV-07 ordinary king: retaliation fizzles by Royal Immunity, ability revealed, king survives', () => {
    const r = scenario({ fen, white: { elements: [...NEUTRAL] }, black, moves: ['e1e2'] });
    const king = 0;
    const pawn = 1;

    expect(idAt(r.state, 'e2')).toBe(king);
    expect(r.state.pieces[king]?.square).toBe(sq('e2'));
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(trace(r.events)).toEqual(expectedTrace);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')[0]).toMatchObject({
      side: 'black',
      piece: pawn,
      ability: 'poisoned_meat',
      reason: 'royal_immunity',
      target: king,
    });
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(r.state.result).toBeNull();
    expect(r.events).toMatchSnapshot();
  });

  it('E3 R-RULES-003 R-RULES-004 INV-07 DD-32 Stalwart king: retaliation fizzles by Royal Immunity, king survives, Stalwart stays hidden', () => {
    const r = scenario({
      fen,
      // Six sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king.
      white: { elements: [...NEUTRAL], sets: [[], [], [], [], [], ['stalwart']] },
      black,
      moves: ['e1e2'],
    });
    const king = 0;
    const pawn = 1;

    expect(idAt(r.state, 'e2')).toBe(king);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(trace(r.events)).toEqual(expectedTrace);
    expect(eventsOf(r.events, 'EffectFizzled')[0]).toMatchObject({
      ability: 'poisoned_meat',
      reason: 'royal_immunity',
      target: king,
    });
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    // Royal Immunity covers every king alike, so Stalwart's rule difference was not observable.
    expect(revealedOn(r.state, 'white', 'king')).not.toContain('stalwart');
    expect(r.state.result).toBeNull();
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E4 First Blood: a queen captures a Poisoned Meat pawn', () => {
  // d1 Q=0, e1 K=1, d5 p=2, e8 k=3
  const spec: ScenarioSpec = {
    fen: '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1',
    format: 'first_blood',
    white: { elements: [...NEUTRAL] },
    black: { elements: [...NEUTRAL], abilities: ['poisoned_meat'] },
    moves: ['d1d5'],
  };

  it("E4 R-FMT-001 R-FMT-002 DD-25 DD-38 Poisoned Meat removes the queen: the pawn's owner wins after the chain settles", () => {
    const r = scenario(spec);
    const queen = 0;
    const pawn = 2;

    expect(r.state.pieces[queen]?.square).toBe(-1);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();

    // The whole chain resolves, the turn passes, then the objective is adjudicated (DD-25).
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white queen#0 d1-d5',
      'Triggered black poisoned_meat',
      'Captured white queen#0 by effect',
      'TurnPassed black',
      'BattleEnded black objective',
    ]);
    expect(r.events.at(-1)).toMatchObject({
      k: 'BattleEnded',
      result: { winner: 'black', reason: 'objective' },
    });
    // The pawn capture does not qualify; the effect capture of the queen is credited to black.
    expect(r.state.objective).toEqual({ white: 0, black: 1 });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'objective' });

    // The battle is over: no further action is accepted.
    let code: string | undefined;
    try {
      r.engine.applyAction(r.state, { kind: 'move', side: 'black', move: uciToMove('e8e7') });
    } catch (err) {
      code = err instanceof RulesError ? err.code : 'not a RulesError';
    }
    expect(code).toBe('battle_over');
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E5 a rook shielding its king captures a Poisoned Meat pawn', () => {
  // e1 K=0, e2 R=1, e5 p=2, e8 q=3, h8 k=4
  const spec: ScenarioSpec = {
    fen: '4q2k/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
    white: { elements: [...NEUTRAL] },
    black: { elements: [...NEUTRAL], abilities: ['poisoned_meat'] },
    moves: ['e2e5'],
  };

  it('E5 INV-03 removing the rook would expose the white king, so Poisoned Meat fizzles', () => {
    const r = scenario(spec);
    const king = 0;
    const rook = 1;
    const pawn = 2;

    expect(idAt(r.state, 'e5')).toBe(rook);
    expect(r.state.pieces[rook]?.square).toBe(sq('e5'));
    expect(idAt(r.state, 'e1')).toBe(king);
    expect(r.state.pieces[pawn]?.square).toBe(-1);

    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white rook#1 e2-e5',
      'Triggered black poisoned_meat',
      'Fizzled black poisoned_meat inv03',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')[0]).toMatchObject({
      side: 'black',
      piece: pawn,
      ability: 'poisoned_meat',
      reason: 'inv03',
      target: rook,
    });
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(r.state.inCheck).toBeNull();
    expect(r.state.result).toBeNull();
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E6 a bishop captures a knight with Riposte', () => {
  // e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6
  const fen = '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1';
  const bishop = 1;
  const knight = 2;
  const h7pawn = 4;

  it("E6 R-ABIL-003 INV-01 DD-18 DD-21 the knight's owner picks a legal capturer; the capture runs a nested pipeline at depth 1", () => {
    const r = scenario({
      fen,
      white: { elements: [...NEUTRAL] },
      black: { elements: [...NEUTRAL], abilities: ['riposte'] },
      moves: ['d3g6'],
      answers: [pickMove('h7g6')],
    });

    // Exactly one prompt, to the knight's owner, listing Decline first (the default) and every
    // piece that can legally capture the bishop on g6.
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req.chooser).toBe('black');
    expect(req.kind).toBe('bonusMove');
    expect(req.source).toEqual({ ability: 'riposte', piece: knight, side: 'black' });
    expect(req.options[0]).toEqual({ kind: 'decline' });
    expect(req.defaultOption).toBe(0);
    const offered = req.options
      .slice(1)
      .map((o) => (o.kind === 'move' ? moveToUci(o) : `not-a-move:${o.kind}`))
      .sort();
    expect(offered).toEqual(['f7g6', 'g8g6', 'h7g6']);

    // Knight and bishop are gone; the h7 pawn stands on g6.
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(idAt(r.state, 'g6')).toBe(h7pawn);
    expect(pieceAt(r.state, 'h7')).toBeUndefined();

    expect(trace(r.events)).toEqual([
      'Captured black knight#2 by move',
      'MoveMade white bishop#1 d3-g6',
      'Triggered black riposte',
      'd1 Captured white bishop#1 by move',
      'd1 MoveMade black pawn#4 h7-g6 bonus',
      'TurnPassed black',
    ]);
    // The nested capture's events all carry depth 1; the committed action's events depth 0.
    const nestedCapture = eventsOf(r.events, 'Captured').find((e) => e.victim === bishop);
    expect(nestedCapture).toMatchObject({ depth: 1, by: 'move', captor: h7pawn, square: sq('g6') });
    const bonusMove = eventsOf(r.events, 'MoveMade').find((e) => e.bonus);
    expect(bonusMove).toMatchObject({ depth: 1, side: 'black', piece: h7pawn, capture: true });
    expect(
      eventsOf(r.events, 'MoveMade')
        .filter((e) => !e.bonus)
        .map((e) => e.depth),
    ).toEqual([0]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.depth)).toEqual([0]);
    const choice = eventsOf(r.events, 'ChoiceMade');
    expect(choice).toHaveLength(1);
    expect(choice[0]).toMatchObject({
      side: 'black',
      option: { kind: 'move', from: sq('h7'), to: sq('g6') },
    });
    // The nested pipeline starts only after the choice (5.3: the bonus capture re-enters Commit).
    expect(r.events.indexOf(choice[0] as BattleEvent)).toBeLessThan(
      r.events.indexOf(nestedCapture as BattleEvent),
    );
    expect(Math.max(...r.events.map((e) => e.depth))).toBe(1);

    // The bonus move is inside white's action: it is black's turn now (INV-01).
    expect(r.state.turn).toBe('black');
    expect(revealedOn(r.state, 'black', 'knight')).toEqual(['riposte']);
    expect(r.state.result).toBeNull();
    expect(r.events).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E7 Hot Foot: an Ember knight captures on e5, then leaves it', () => {
  // g1 K=0, c4 N=1, e5 p=2, c6 n=3, a8 k=4, e8 r=5
  const fen = 'k3r3/8/2n5/4p3/2N5/8/8/6K1 w - - 0 1';
  const e5 = sq('e5');
  const toE5 = (moves: string[]) => moves.filter((m) => m.slice(2, 4) === 'e5');

  it('E7 R-ELEM-005 e5 ignites for 3 opponent turns: non-Ember pieces may not enter or capture there, sliders pass over, then it goes out', () => {
    const s0 = setup({ fen, white: { elements: ['ember'] }, black: { elements: [...NEUTRAL] } });
    const { engine } = s0;
    let state = s0.state;
    const all: BattleEvent[] = [];
    const step = (uci: string): BattleEvent[] => {
      const p = play(engine, state, uci);
      state = p.state;
      all.push(...p.step.events);
      return p.step.events;
    };
    const blackToE5 = () => toE5(legalUci(engine, state, 'black'));

    // Ply 0: the Ember knight captures on e5, leaving a pending burn (not burning yet).
    let ev = step('c4e5');
    expect(eventsOf(ev, 'Captured')).toMatchObject([{ victim: 2, by: 'move', captor: 1 }]);
    expect(eventsOf(ev, 'SquareIgnited')).toEqual([]);
    expect(hotFoot(state)).toEqual({ burning: [], pending: [{ piece: 1, sq: e5 }] });
    // A pending burn does not block: black may still capture the knight on e5.
    expect(blackToE5()).toEqual(['c6e5', 'e8e5']);

    // Ply 1: black waits. Ply 2 ("two turns later"): the knight moves to f3 and e5 ignites.
    step('a8b8');
    ev = step('e5f3');
    expect(eventsOf(ev, 'SquareIgnited')).toMatchObject([{ square: e5, side: 'white', turns: 3 }]);
    expect(hotFoot(state)).toEqual({ burning: [{ sq: e5, side: 'white', turns: 3 }], pending: [] });

    // Opponent turn 1: no non-Ember piece may move to e5, but the rook may slide over it.
    expect(state.turn).toBe('black');
    expect(blackToE5()).toEqual([]);
    const blackMoves = legalUci(engine, state, 'black');
    expect(blackMoves).toEqual(expect.arrayContaining(['e8e6', 'e8e4', 'e8e3', 'e8e2', 'e8e1']));
    ev = step('e8e4');
    expect(eventsOf(ev, 'MoveMade')).toMatchObject([{ piece: 5, from: sq('e8'), to: sq('e4') }]);
    expect(eventsOf(ev, 'SquareExtinguished')).toEqual([]);

    // White's Ember knight uses the burning square normally (and does not re-ignite it later:
    // only a move capture leaves a pending burn).
    expect(legalUci(engine, state, 'white')).toContain('f3e5');
    ev = step('f3e5');
    expect(eventsOf(ev, 'MoveMade')).toMatchObject([
      { piece: 1, from: sq('f3'), to: e5, capture: false },
    ]);
    expect(idAt(state, 'e5')).toBe(1);

    // Opponent turn 2: non-Ember pieces cannot capture the Ember knight standing on e5.
    expect(blackToE5()).toEqual([]);
    ev = step('b8a8');
    expect(eventsOf(ev, 'SquareExtinguished')).toEqual([]);
    ev = step('e5f3');
    expect(eventsOf(ev, 'SquareIgnited')).toEqual([]);
    expect(hotFoot(state).burning).toEqual([{ sq: e5, side: 'white', turns: 1 }]);

    // Opponent turn 3: still blocked; the square goes out after this turn.
    expect(blackToE5()).toEqual([]);
    ev = step('a8b8');
    expect(eventsOf(ev, 'SquareExtinguished')).toMatchObject([{ square: e5 }]);
    expect(hotFoot(state).burning).toEqual([]);
    expect(eventsOf(all, 'SquareExtinguished')).toHaveLength(1);
    expect(eventsOf(all, 'SquareIgnited')).toHaveLength(1);

    // Opponent turn 4: e5 is an ordinary square again.
    step('g1g2');
    expect(blackToE5()).toEqual(['c6e5', 'e4e5']);
    expect(state.result).toBeNull();
    expect(all).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E8 Flow: a Tide rook behind its own pawn', () => {
  // b1 R=0, e1 K=1, a2 P=2, a8 k=3. The rook steps to a1: rook a1, own pawn a2, a3-a7 empty.
  const fen = 'k7/8/8/8/8/8/P7/1R2K3 w - - 0 1';

  it('E8 R-ELEM-006 the rook checks the enemy king through its own pawn and may move a1-a5 through it', () => {
    const s0 = setup({ fen, white: { elements: ['tide'] }, black: { elements: [...NEUTRAL] } });
    const { engine } = s0;
    let state = s0.state;
    const all: BattleEvent[] = [];
    const step = (uci: string): BattleEvent[] => {
      const p = play(engine, state, uci);
      state = p.state;
      all.push(...p.step.events);
      return p.step.events;
    };

    const ev = step('b1a1');
    expect(eventsOf(ev, 'Check')).toMatchObject([{ side: 'black', square: sq('a8') }]);
    expect(state.inCheck).toBe('black');
    // The attack passes through the pawn, so a7 is covered too: the king must leave the a-file.
    expect(legalUci(engine, state, 'black')).toEqual(['a8b7', 'a8b8']);

    step('a8b8');
    expect(state.inCheck).toBeNull();
    const rookMoves = legalUci(engine, state, 'white').filter((m) => m.startsWith('a1'));
    expect(rookMoves).toEqual(
      expect.arrayContaining(['a1a3', 'a1a4', 'a1a5', 'a1a6', 'a1a7', 'a1a8', 'a1b1']),
    );
    expect(rookMoves).not.toContain('a1a2'); // cannot end a move on its own pawn

    const ev2 = step('a1a5');
    expect(eventsOf(ev2, 'MoveMade')).toMatchObject([
      { piece: 0, from: sq('a1'), to: sq('a5'), capture: false },
    ]);
    expect(idAt(state, 'a5')).toBe(0);
    expect(idAt(state, 'a2')).toBe(2);
    expect(pieceAt(state, 'a1')).toBeUndefined();
    expect(all).toMatchSnapshot();
  });

  it('E8 R-ELEM-006 control: a non-Tide rook is blocked by its own pawn (no check, no pass-through)', () => {
    const s0 = setup({ fen, white: { elements: [...NEUTRAL] }, black: { elements: [...NEUTRAL] } });
    const p = play(s0.engine, s0.state, 'b1a1');
    expect(eventsOf(p.step.events, 'Check')).toEqual([]);
    expect(p.state.inCheck).toBeNull();
    expect(legalUci(s0.engine, p.state, 'black')).toContain('a8a7');
    const p2 = play(s0.engine, p.state, 'a8b8');
    const rookMoves = legalUci(s0.engine, p2.state, 'white').filter((m) => m.startsWith('a1'));
    expect(rookMoves).toEqual(['a1b1', 'a1c1', 'a1d1']);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('E9 Overabundance: a Grove bishop with Rebirth is captured three times', () => {
  // c1 B=0, e1 K=1, d8 r=2, e8 k=3
  const fen = '3rk3/8/8/8/8/8/8/2B1K3 w - - 0 1';
  const bishop = 0;
  const backRankOptions = ['a1', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1'];

  it('E9 R-ELEM-007 R-ABIL-004 DD-17 DD-22 Rebirth has 2 charges on a Grove piece: the bishop returns twice, the third capture is final', () => {
    const s0 = setup({
      fen,
      white: { elements: ['grove'], abilities: ['rebirth'] },
      black: { elements: [...NEUTRAL] },
    });
    const { engine } = s0;
    let state = s0.state;
    const all: BattleEvent[] = [];
    const prompts: ChoiceRequest[] = [];
    const step = (uci: string, answers: ((req: ChoiceRequest) => number)[] = []) => {
      const p = play(engine, state, uci, answers);
      state = p.state;
      all.push(...p.step.events);
      prompts.push(...p.step.prompts);
      return p.step;
    };
    const squaresOf = (req: ChoiceRequest) =>
      req.options.map((o) => (o.kind === 'square' ? squareName(o.square) : `?${o.kind}`)).sort();

    // Overabundance doubles Rebirth's single charge on the Grove bishop.
    expect(engine.remainingCharges(state, bishop, 'rebirth')).toBe(2);

    // Capture 1: Bc1-d2, Rd8xd2. Attuned Rebirth prompts white for a back-rank square.
    step('c1d2');
    let st = step('d8d2', [pickSquare('c1')]);
    expect(st.prompts).toHaveLength(1);
    expect(st.prompts[0]).toMatchObject({
      chooser: 'white',
      kind: 'square',
      source: { ability: 'rebirth', piece: bishop, side: 'white' },
    });
    expect(squaresOf(st.prompts[0] as ChoiceRequest)).toEqual(backRankOptions);
    expect(trace(st.events)).toEqual([
      'Captured white bishop#0 by move',
      'MoveMade black rook#2 d8-d2',
      'Triggered white rebirth',
      'Revived #0 c1',
      'TurnPassed white',
    ]);
    expect(eventsOf(st.events, 'AbilityTriggered')[0]?.attuned).toBe(true);
    expect(eventsOf(st.events, 'ChargeSpent')).toMatchObject([
      { side: 'white', piece: bishop, ability: 'rebirth', remaining: 1 },
    ]);
    expect(idAt(state, 'c1')).toBe(bishop);
    expect(engine.remainingCharges(state, bishop, 'rebirth')).toBe(1);

    // Capture 2: Bc1-b2, Rd2xb2. It returns again (same identity, counters kept).
    step('c1b2');
    st = step('d2b2', [pickSquare('c1')]);
    expect(st.prompts).toHaveLength(1);
    expect(squaresOf(st.prompts[0] as ChoiceRequest)).toEqual(backRankOptions);
    expect(trace(st.events)).toEqual([
      'Captured white bishop#0 by move',
      'MoveMade black rook#2 d2-b2',
      'Triggered white rebirth',
      'Revived #0 c1',
      'TurnPassed white',
    ]);
    expect(eventsOf(st.events, 'ChargeSpent')).toMatchObject([
      { piece: bishop, ability: 'rebirth', remaining: 0 },
    ]);
    expect(idAt(state, 'c1')).toBe(bishop);
    expect(engine.remainingCharges(state, bishop, 'rebirth')).toBe(0);

    // Capture 3: Bc1-d2, Rb2xd2. No charges left, so Rebirth does not trigger at all (DD-17).
    step('c1d2');
    st = step('b2d2');
    expect(st.prompts).toEqual([]);
    expect(trace(st.events)).toEqual([
      'Captured white bishop#0 by move',
      'MoveMade black rook#2 b2-d2',
      'TurnPassed white',
    ]);
    expect(state.pieces[bishop]?.square).toBe(-1);
    expect(pieceAt(state, 'c1')).toBeUndefined();
    expect(idAt(state, 'd2')).toBe(2);

    expect(prompts).toHaveLength(2);
    expect(eventsOf(all, 'PieceRevived')).toHaveLength(2);
    expect(eventsOf(all, 'ChargeSpent')).toHaveLength(2);
    expect(state.usage[`${bishop}:rebirth`]).toBe(2);
    expect(revealedOn(state, 'white', 'bishop')).toEqual(['rebirth']);
    expect(state.result).toBeNull();
    expect(all).toMatchSnapshot();
  });
});
