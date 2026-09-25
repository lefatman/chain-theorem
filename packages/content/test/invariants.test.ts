/**
 * Invariant and pipeline tests (M2 steps 2.2 and 2.5, R-TEST-001): INV-01 to INV-07 (spec 4.1),
 * R-RULES-002 to R-RULES-005 (4.2-4.5), R-ABIL-001, R-ABIL-003, R-ABIL-004 (5.1-5.4), R-FMT-001 and
 * R-FMT-002 (9.1), suspended actions (13.2, DD-11) and DD-12, DD-17, DD-25, DD-35, DD-38, DD-39.
 *
 * Expected behaviour is derived from the spec and the delegated decisions, not from the engine's
 * current output. Elements default to 'neutral' (DD-23), so no ability is attuned and nothing is
 * silenced unless a test says otherwise.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionInput,
  type ApplyResult,
  type BattleEvent,
  type ChoiceOption,
  type Engine,
  type FormatId,
  type GameState,
  type Side,
  RulesError,
  uciToMove,
} from '@chain-theorem/rules';
import { makeEngine } from '../index.ts';
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
const mv = (from: string, to: string): ChoiceOption => ({
  kind: 'move',
  from: sq(from),
  to: sq(to),
});
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const other = (s: Side): Side => (s === 'white' ? 'black' : 'white');
const move = (side: Side, uci: string): ActionInput => ({
  kind: 'move',
  side,
  move: uciToMove(uci),
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
/** Knight c3 can take a lone pawn on d5; kings far away. */
const KNIGHT_TAKES_PAWN = '7k/8/8/3p4/8/2N5/8/K7 w - - 0 1';
/** E6: bishop b3 takes the knight d5; the rook d8 and the pawn e6 can recapture on d5. */
const E6_FEN = '3rk3/8/4p3/3n4/8/1B6/8/4K3 w - - 0 1';

/** AbilityTriggered events as `side ability CATEGORY dN`, in stream order. */
function triggered(events: readonly BattleEvent[]): string[] {
  return eventsOf(events, 'AbilityTriggered').map(
    (e) => `${e.side} ${e.ability ?? '?'} ${e.category} d${e.depth}`,
  );
}

/** Index of the first event matching `pred`, or -1. */
function at(events: readonly BattleEvent[], pred: (e: BattleEvent) => boolean): number {
  return events.findIndex(pred);
}

const isTrig =
  (ability: string) =>
  (e: BattleEvent): boolean =>
    e.k === 'AbilityTriggered' && e.ability === ability;

function needsChoice(r: ApplyResult): Extract<ApplyResult, { kind: 'needsChoice' }> {
  if (r.kind !== 'needsChoice') throw new Error(`expected needsChoice, got ${r.kind}`);
  return r;
}

function choose(r: Extract<ApplyResult, { kind: 'needsChoice' }>, option: number): ActionInput {
  return { kind: 'choice', side: r.request.chooser, promptId: r.request.promptId, option };
}

function optionIndex(r: Extract<ApplyResult, { kind: 'needsChoice' }>, o: ChoiceOption): number {
  const i = r.request.options.findIndex((x) => JSON.stringify(x) === JSON.stringify(o));
  if (i < 0) throw new Error(`option ${JSON.stringify(o)} not offered`);
  return i;
}

function hasStalwart(state: GameState, side: Side): boolean {
  return state.armies[side].sets.king.includes('stalwart');
}

// ---------------------------------------------------------------------------------------------------

describe('INV-01 one action per turn, at most one bonus action per ability (DD-12)', () => {
  it('INV-01 a bonus action (Momentum) adds exactly one move inside the action; the turn then passes once', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [mv('d5', 'b4')],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts.map((p) => [p.chooser, p.kind, p.source.ability])).toEqual([
      ['white', 'bonusMove', 'momentum'],
    ]);
    expect(eventsOf(r.events, 'MoveMade').map((e) => [e.piece, e.from, e.to, e.bonus])).toEqual([
      [knight, sq('c3'), sq('d5'), false],
      [knight, sq('d5'), sq('b4'), true],
    ]);
    expect(eventsOf(r.events, 'TurnPassed')).toEqual([
      expect.objectContaining({ side: 'black', ply: 1 }),
    ]);
    expect(r.state.turn).toBe('black');
    expect(r.state.ply).toBe(1);
    expect(pieceAt(r.state, 'b4')?.id).toBe(knight);
    // One action per turn: white cannot move again.
    expect(() => r.engine.applyAction(r.state, move('white', 'b4c6'))).toThrow(RulesError);
  });

  it('INV-01 DD-12 DD-17 a bonus action cannot grant another: Momentum on the riposting pawn fizzles with bonus_in_bonus and spends no charge', () => {
    const r = scenario({
      fen: E6_FEN,
      black: { abilities: ['riposte', 'momentum'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const pawn = idAt(r.initial, 'e6');
    expect(r.prompts.map((p) => [p.chooser, p.source.ability])).toEqual([['black', 'riposte']]);
    expect(triggered(r.events)).toEqual([
      'black riposte CAPTURED d0',
      'black momentum CAPTURES d1',
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        side: 'black',
        piece: pawn,
        ability: 'momentum',
        reason: 'bonus_in_bonus',
      }),
    ]);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toHaveLength(1);
    expect(r.events.filter((e) => e.depth > 1)).toEqual([]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    expect(r.engine.remainingCharges(r.state, pawn, 'momentum')).toBe(2);
    expect(pieceAt(r.state, 'd5')?.id).toBe(pawn);
    expect(r.state.turn).toBe('black');
  });

  it('INV-01 R-ABIL-004 two different abilities may each grant one bonus action in the same action; the victim side is asked first', () => {
    const r = scenario({
      fen: '7k/8/4p3/3p4/8/2N5/8/K7 w - - 0 1',
      white: { abilities: ['momentum'] },
      black: { abilities: ['riposte'] },
      moves: ['c3d5'],
      answers: [{ kind: 'decline' }, mv('d5', 'b4')],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts.map((p) => [p.chooser, p.source.ability])).toEqual([
      ['black', 'riposte'],
      ['white', 'momentum'],
    ]);
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('e6', 'd5')]);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([
      expect.objectContaining({ piece: knight, from: sq('d5'), to: sq('b4') }),
    ]);
    expect(pieceAt(r.state, 'b4')?.id).toBe(knight);
    expect(eventsOf(r.events, 'TurnPassed')).toHaveLength(1);
  });
});

describe('INV-02 an ordinary king is never captured', () => {
  it("INV-02 an ordinary king is never among the opponent's legal moves, even when it stands attacked with the opponent to move", () => {
    const { engine, state } = setup({ fen: 'k7/8/8/8/8/8/8/R3K3 w - - 0 1' });
    const king = sq('a8');
    expect(engine.legalMoves(state, 'white').filter((m) => m.to === king)).toEqual([]);
    expect(() => engine.applyAction(state, move('white', 'a1a8'))).toThrow(RulesError);
  });

  it('INV-02 R-RULES-003 only a Stalwart king left in check can be captured, and only by a move', () => {
    const fen = 'k7/7p/8/8/8/8/8/R3K3 b - - 0 1';
    const ordinary = setup({ fen });
    // An ordinary king must answer the check, so h7-h6 is illegal.
    expect(ordinary.engine.legalMoves(ordinary.state, 'black')).not.toContainEqual(
      uciToMove('h7h6'),
    );
    const r = scenario({ fen, black: { abilities: ['stalwart'] }, moves: ['h7h6'] });
    expect(r.engine.legalMoves(r.state, 'white')).toContainEqual(uciToMove('a1a8'));
    const { state, step } = play(r.engine, r.state, 'a1a8');
    expect(eventsOf(step.events, 'Captured')).toEqual([
      expect.objectContaining({ victimType: 'king', victimSide: 'black', by: 'move' }),
    ]);
    expect(state.result).toEqual({ winner: 'white', reason: 'stalwart_captured' });
  });
});

describe('INV-03 no action leaves the acting player’s ordinary king in check', () => {
  it("INV-03 E5 an opponent's effect (Poisoned Meat) that would expose the acting player's ordinary king fizzles", () => {
    const r = scenario({
      fen: 'k3q3/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
      black: { abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    const rook = idAt(r.initial, 'e2');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'poisoned_meat', reason: 'inv03' }),
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    expect(pieceAt(r.state, 'e5')?.id).toBe(rook);
    expect(r.state.inCheck).toBeNull();
    expect(eventsOf(r.events, 'Check')).toEqual([]);
  });

  it("INV-03 the acting player's own effect (Hit and Run) that would expose its ordinary king fizzles", () => {
    // Nd3xe5 blocks the e-file itself; returning to d3 would open it to the rook e8.
    const r = scenario({
      fen: 'k3r3/8/8/4p3/8/3N4/8/4K3 w - - 0 1',
      white: { abilities: ['hit_and_run'] },
      moves: ['d3e5'],
    });
    const knight = idAt(r.initial, 'd3');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'hit_and_run', reason: 'inv03' }),
    ]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    expect(pieceAt(r.state, 'e5')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd3')).toBeUndefined();
    expect(r.state.inCheck).toBeNull();
  });

  it('INV-03 R-RULES-003 DD-32 not for a Stalwart king: the same Hit and Run resolves, the check alert fires and Stalwart is revealed', () => {
    const r = scenario({
      fen: 'k3r3/8/8/4p3/8/3N4/8/4K3 w - - 0 1',
      white: { abilities: ['stalwart', 'hit_and_run'] },
      moves: ['d3e5'],
    });
    const knight = idAt(r.initial, 'd3');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('e5'), to: sq('d3') }),
    ]);
    expect(pieceAt(r.state, 'd3')?.id).toBe(knight);
    expect(r.state.inCheck).toBe('white');
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e1') }),
    ]);
    expect(r.state.result).toBeNull();
    expect(r.state.reveals.white.abilities.king).toContain('stalwart');
  });

  it("INV-03 DD-17 an opponent's revival (Rebirth) that would check the acting player's ordinary king fizzles and keeps its charge", () => {
    // The black knight starts on d4. It leaves, the white king steps to e2 (attacked from d4), and
    // the rook takes the knight on c6: returning to d4 would check the white king.
    const r = scenario({
      fen: '7k/8/8/8/3n4/8/8/2R1K3 b - - 0 1',
      black: { abilities: ['rebirth'] },
      moves: ['d4c6', 'e1e2', 'h8g8', 'c1c6'],
    });
    const knight = idAt(r.initial, 'd4');
    const last = r.steps[3]?.events ?? [];
    expect(eventsOf(last, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'rebirth', reason: 'inv03' }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toEqual([]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd4')).toBeUndefined();
    expect(r.state.inCheck).toBeNull();
    expect(eventsOf(last, 'ChargeSpent')).toEqual([]);
    expect(r.engine.remainingCharges(r.state, knight, 'rebirth')).toBe(1);
  });

  it('INV-03 R-RULES-003 DD-32 not for a Stalwart king: the same revival resolves and checks the king, which the knight then captures', () => {
    const r = scenario({
      fen: '7k/8/8/8/3n4/8/8/2R1K3 b - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['rebirth'] },
      moves: ['d4c6', 'e1e2', 'h8g8', 'c1c6'],
    });
    const knight = idAt(r.initial, 'd4');
    const last = r.steps[3]?.events ?? [];
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: knight, side: 'black', square: sq('d4') }),
    ]);
    expect(r.state.inCheck).toBe('white');
    expect(eventsOf(last, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e2') }),
    ]);
    expect(r.state.result).toBeNull();
    expect(r.state.reveals.white.abilities.king).toContain('stalwart');
    const end = play(r.engine, r.state, 'd4e2');
    expect(end.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
  });

  it('INV-03 DD-19 a chosen effect capture never takes the piece shielding the acting king: Cleave fizzles instead of removing the pin-blocker', () => {
    // The black pawn g3 blocks the bishop h4 from the white king e1.
    const r = scenario({
      fen: 'k7/8/8/8/5n1b/6p1/8/4KR2 w - - 0 1',
      white: { abilities: ['cleave'] },
      moves: ['f1f4'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'cleave' }),
    ]);
    expect(pieceAt(r.state, 'g3')).toMatchObject({ side: 'black', type: 'pawn' });
    expect(r.state.inCheck).toBeNull();
  });

  it('INV-03 DD-18 DD-19 with another pawn in reach, Cleave takes it without a prompt and leaves the pin-blocker alone', () => {
    const r = scenario({
      fen: 'k7/8/8/8/5n1b/4p1p1/8/4KR2 w - - 0 1',
      white: { abilities: ['cleave'] },
      moves: ['f1f4'],
    });
    const e3 = idAt(r.initial, 'e3');
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ by: 'move', victimType: 'knight' }),
      expect.objectContaining({ by: 'effect', victim: e3, square: sq('e3') }),
    ]);
    expect(pieceAt(r.state, 'g3')).toMatchObject({ side: 'black', type: 'pawn' });
    expect(r.state.inCheck).toBeNull();
  });

  it("INV-03 DD-21 the opponent's bonus capture (Riposte) is never offered when it would leave the acting player's ordinary king in check", () => {
    // Rd8xd5 would check the white king d1 along the d-file; e6xd5 would not.
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/8/1B6/8/3K4 w - - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('e6', 'd5')]);
    expect(pieceAt(r.state, 'd8')?.type).toBe('rook');
    expect(r.state.inCheck).toBeNull();
  });

  it('INV-03 DD-35 INV-03 is checked before PROTECT: with Antidote the E5 retaliation fizzles as inv03, not as protected', () => {
    const r = scenario({
      fen: 'k3q3/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
      white: { abilities: ['antidote'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'inv03' }),
    ]);
    expect(pieceAt(r.state, 'e5')?.type).toBe('rook');
  });
});

describe('INV-04 determinism', () => {
  it('INV-04 the same action on equal states resolves to one result: events, state and hash match, also from a JSON copy', () => {
    const spec: ScenarioSpec = {
      fen: E6_FEN,
      white: { abilities: ['poisoned_meat', 'hit_and_run'] },
      black: { abilities: ['riposte', 'poisoned_meat'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    };
    const a = scenario(spec);
    const b = scenario(spec);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
    expect(b.engine.stateHash(b.state)).toBe(a.engine.stateHash(a.state));
    const replay = play(makeEngine(), json(a.initial), 'b3d5', [mv('e6', 'd5')]);
    expect(replay.step.events).toEqual(a.events);
    expect(replay.state).toEqual(a.state);
    expect(a.engine.stateHash(replay.state)).toBe(a.engine.stateHash(a.state));
  });

  it('INV-04 R-DATA-002 applyAction never mutates its input state, whether it completes, suspends or resumes', () => {
    const { engine, state } = setup({ fen: E6_FEN, black: { abilities: ['riposte'] } });
    const before = JSON.stringify(state);
    const r1 = needsChoice(engine.applyAction(state, move('white', 'b3d5')));
    expect(JSON.stringify(state)).toBe(before);
    const suspended = JSON.stringify(r1.state);
    const r2 = engine.applyAction(r1.state, choose(r1, optionIndex(r1, mv('e6', 'd5'))));
    expect(JSON.stringify(r1.state)).toBe(suspended);
    expect(r2.kind).toBe('done');
    const done = JSON.stringify(r2.state);
    engine.applyAction(r2.state, move('black', 'e8e7'));
    expect(JSON.stringify(r2.state)).toBe(done);
  });
});

describe('INV-05 the victim leaves the board in the Capture phase', () => {
  it('INV-05 R-ABIL-001 the victim is removed before the captor lands and before any reaction resolves', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['scout', 'hit_and_run'] },
      black: { abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const pawn = idAt(r.initial, 'd5');
    const ev = r.events;
    const captured = at(ev, (e) => e.k === 'Captured' && e.victim === pawn);
    const landed = at(ev, (e) => e.k === 'MoveMade' && e.to === sq('d5'));
    expect(captured).toBeGreaterThan(at(ev, isTrig('scout')));
    expect(landed).toBe(captured + 1);
    expect(at(ev, isTrig('last_word'))).toBeGreaterThan(landed);
    expect(at(ev, isTrig('hit_and_run'))).toBeGreaterThan(landed);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
  });

  it("INV-05 R-ABIL-004 a Captured reaction measures from the victim's last known square (Backdraft burns the pawn next to it)", () => {
    const r = scenario({
      fen: '7k/8/8/3p4/4P3/2N5/8/7K w - - 0 1',
      black: { abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    const e4 = idAt(r.initial, 'e4');
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ by: 'move', square: sq('d5'), captor: knight }),
      expect.objectContaining({
        by: 'effect',
        victim: e4,
        square: sq('e4'),
        source: expect.objectContaining({ kind: 'ability', id: 'backdraft', side: 'black' }),
      }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });
});

describe('INV-06 a committed action is spent', () => {
  it('INV-06 a committed move is spent even when a hidden Poisoned Meat removes the moving piece', () => {
    const { engine, state } = setup({
      fen: KNIGHT_TAKES_PAWN,
      black: { abilities: ['poisoned_meat'] },
    });
    const knight = idAt(state, 'c3');
    const pawn = idAt(state, 'd5');
    const r = engine.applyAction(state, move('white', 'c3d5'));
    expect(r.kind).toBe('done');
    expect(eventsOf(r.events, 'MoveMade')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('c3'), to: sq('d5'), capture: true }),
    ]);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(r.state.turn).toBe('black');
    expect(r.state.ply).toBe(1);
    expect(r.state.reveals.black.abilities.pawn).toContain('poisoned_meat');
    // Not retractable: the turn has passed, white cannot act again.
    expect(() => engine.applyAction(r.state, move('white', 'a1a2'))).toThrow(RulesError);
  });

  it('INV-06 hidden opponent abilities never make a move illegal: legal moves are the same whatever the opponent carries', () => {
    const hidden = ['poisoned_meat', 'riposte', 'backdraft', 'rebirth', 'antidote', 'veil'];
    for (const fen of [START, KIWIPETE, KNIGHT_TAKES_PAWN, E6_FEN]) {
      const bare = setup({ fen });
      const armed = setup({ fen, black: { abilities: hidden } });
      expect(armed.engine.legalMoves(armed.state, 'white')).toEqual(
        bare.engine.legalMoves(bare.state, 'white'),
      );
    }
  });
});

describe('INV-07 / R-RULES-004 Royal Immunity', () => {
  it('INV-07 R-RULES-004 E3 an ordinary king that captures a Poisoned Meat pawn survives: the retaliation fizzles by Royal Immunity', () => {
    const r = scenario({
      fen: '7k/8/8/8/8/8/4p3/4K3 w - - 0 1',
      black: { abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    const king = idAt(r.initial, 'e1');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        ability: 'poisoned_meat',
        reason: 'royal_immunity',
        side: 'black',
      }),
    ]);
    expect(eventsOf(r.events, 'Captured').filter((e) => e.victimType === 'king')).toEqual([]);
    expect(pieceAt(r.state, 'e2')?.id).toBe(king);
    expect(r.state.reveals.black.abilities.pawn).toContain('poisoned_meat');
    expect(r.state.result).toBeNull();
  });

  it('INV-07 R-RULES-004 DD-35 a Stalwart king with Antidote survives too, and Royal Immunity (not Antidote) is what stops the retaliation', () => {
    const r = scenario({
      fen: '7k/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { abilities: ['stalwart', 'antidote'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'royal_immunity' }),
    ]);
    expect(pieceAt(r.state, 'e2')?.type).toBe('king');
    expect(r.state.result).toBeNull();
  });
});

describe('R-RULES-002 promotion adopts the new type', () => {
  it("R-RULES-002 a capture-promotion's Captures abilities come from the queen set, not the pawn set", () => {
    const r = scenario({
      fen: '2b5/1P1p4/7k/8/8/8/8/4K3 w - - 0 1',
      white: { sets: [['hit_and_run'], [], [], [], ['cleave'], []] },
      moves: ['b7c8q'],
    });
    const pawn = idAt(r.initial, 'b7');
    const d7 = idAt(r.initial, 'd7');
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'white', to: 'queen' }),
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ piece: pawn, pieceType: 'queen', ability: 'cleave' }),
    ]);
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ by: 'move', victimType: 'bishop' }),
      expect.objectContaining({ by: 'effect', victim: d7 }),
    ]);
    expect(pieceAt(r.state, 'c8')).toMatchObject({ id: pawn, type: 'queen' });
    expect(pieceAt(r.state, 'b7')).toBeUndefined();
  });

  it("R-RULES-002 a promoted piece's Captured abilities come from its new set", () => {
    const fen = '7r/1P6/8/8/8/8/8/k3K3 w - - 0 1';
    const queenSet = scenario({
      fen,
      white: { sets: [[], [], [], [], ['poisoned_meat'], []] },
      moves: ['b7b8q', 'h8b8'],
    });
    const rook = idAt(queenSet.initial, 'h8');
    expect(triggered(queenSet.events)).toEqual(['white poisoned_meat CAPTURED d0']);
    expect(eventsOf(queenSet.events, 'Captured')).toEqual([
      expect.objectContaining({ by: 'move', victimType: 'queen' }),
      expect.objectContaining({ by: 'effect', victim: rook }),
    ]);
    expect(pieceAt(queenSet.state, 'b8')).toBeUndefined();

    const pawnSet = scenario({
      fen,
      white: { sets: [['poisoned_meat'], [], [], [], [], []] },
      moves: ['b7b8q', 'h8b8'],
    });
    expect(triggered(pawnSet.events)).toEqual([]);
    expect(pieceAt(pawnSet.state, 'b8')?.id).toBe(rook);
  });

  it("R-RULES-002 R-ELEM-004 under Blended Family a promoted pawn joins its new type's group element", () => {
    const r = scenario({
      fen: '7r/1P6/8/8/8/8/8/k3K3 w - - 0 1',
      white: { elements: ['ember', 'tide'], items: ['blended_family'] },
      moves: ['b7b8q'],
    });
    const pawn = idAt(r.initial, 'b7');
    expect(r.initial.pieces[pawn]?.element).toBe('ember');
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, to: 'queen', element: 'tide' }),
    ]);
    expect(r.state.pieces[pawn]).toMatchObject({ type: 'queen', element: 'tide' });
  });
});

describe('R-RULES-003 Stalwart king legality', () => {
  it('R-RULES-003 a Stalwart king may castle through and into attacked squares; an ordinary king may not', () => {
    for (const fen of ['5r1k/8/8/8/8/8/8/4K2R w K - 0 1', '6rk/8/8/8/8/8/8/4K2R w K - 0 1']) {
      const ordinary = setup({ fen });
      expect(ordinary.engine.legalMoves(ordinary.state, 'white')).not.toContainEqual(
        uciToMove('e1g1'),
      );
      const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['e1g1'] });
      expect(eventsOf(r.events, 'MoveMade')).toEqual([
        expect.objectContaining({ from: sq('e1'), to: sq('g1'), castle: 'K' }),
      ]);
      expect(pieceAt(r.state, 'g1')?.type).toBe('king');
      expect(pieceAt(r.state, 'f1')?.type).toBe('rook');
      expect(r.state.reveals.white.abilities.king).toContain('stalwart');
    }
  });

  it('R-RULES-003 R-RULES-005 a Stalwart king cannot be checkmated: a back-rank "mate" leaves the battle running with a check alert', () => {
    const fen = 'r6k/8/8/8/8/8/5PPP/6K1 b - - 0 1';
    const ordinary = scenario({ fen, moves: ['a8a1'] });
    expect(ordinary.state.result).toEqual({ winner: 'black', reason: 'checkmate' });

    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['a8a1'] });
    expect(r.state.result).toBeNull();
    expect(eventsOf(r.events, 'BattleEnded')).toEqual([]);
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('g1') }),
    ]);
    expect(r.state.inCheck).toBe('white');
    expect(r.engine.legalMoves(r.state, 'white').length).toBeGreaterThan(0);
    expect(r.state.reveals.white.abilities.king).toContain('stalwart');
  });

  it('R-RULES-003 Stalwart only matters for the king: carried only by knights, the king stays ordinary and is checkmated', () => {
    const r = scenario({
      fen: 'r6k/8/8/8/8/8/5PPP/6K1 b - - 0 1',
      white: { sets: [[], ['stalwart'], [], [], [], []] },
      moves: ['a8a1'],
    });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'checkmate' });
  });

  it('R-RULES-003 R-RULES-005 DD-25 capturing a Stalwart king ends the battle only after its reaction chain has resolved', () => {
    // Black leaves its Stalwart king in check; the knight takes it and the king's Poisoned Meat
    // still removes the knight before the battle ends.
    const r = scenario({
      fen: '4k3/p7/3N4/8/8/8/8/7K b - - 0 1',
      black: { abilities: ['stalwart', 'poisoned_meat'] },
      moves: ['a7a6', 'd6e8'],
    });
    const knight = idAt(r.initial, 'd6');
    const king = idAt(r.initial, 'e8');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'Captured')).toEqual([
      expect.objectContaining({ victim: king, victimType: 'king', by: 'move' }),
      expect.objectContaining({ victim: knight, by: 'effect' }),
    ]);
    expect(last.at(-1)).toMatchObject({
      k: 'BattleEnded',
      result: { winner: 'white', reason: 'stalwart_captured' },
    });
    expect(at(last, (e) => e.k === 'TurnPassed')).toBeGreaterThan(
      at(last, (e) => e.k === 'Captured' && e.by === 'effect'),
    );
    expect(r.state.result).toEqual({ winner: 'white', reason: 'stalwart_captured' });
  });

  it('R-RULES-003 R-RULES-005 a Stalwart owner with no legal move at all is stalemated (draw), even while in check', () => {
    // Every white piece is walled in; Nd4-b3 checks the king a1.
    const fen = '7k/8/8/1p6/1Ppn4/2Pp4/NPRP4/KBB5 b - - 0 1';
    const ordinary = scenario({ fen, moves: ['d4b3'] });
    expect(ordinary.state.result).toEqual({ winner: 'black', reason: 'checkmate' });
    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['d4b3'] });
    expect(r.engine.legalMoves(r.state, 'white')).toEqual([]);
    expect(r.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });
});

describe('R-RULES-005 win, loss and draw', () => {
  it('R-RULES-005 DD-25 checkmate of an ordinary king wins; Settle passes the turn, then alerts the check, then ends the battle', () => {
    const r = scenario({ moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'checkmate' });
    const last = r.steps[3]?.events ?? [];
    expect(last.slice(-3).map((e) => e.k)).toEqual(['TurnPassed', 'Check', 'BattleEnded']);
    expect(last.at(-1)).toMatchObject({ result: { winner: 'black', reason: 'checkmate' } });
    expect(r.engine.legalMoves(r.state, 'white')).toEqual([]);
    expect(() => r.engine.applyAction(r.state, move('white', 'e1f2'))).toThrow(RulesError);
  });

  it('R-RULES-005 resignation and abandonment lose; agreement draws; each ends the battle with one BattleEnded event', () => {
    const { engine, state } = setup({});
    const cases: [ActionInput, { winner: Side | null; reason: string }][] = [
      [
        { kind: 'resign', side: 'white' },
        { winner: 'black', reason: 'resign' },
      ],
      [
        { kind: 'resign', side: 'black' },
        { winner: 'white', reason: 'resign' },
      ],
      [
        { kind: 'abandon', side: 'black' },
        { winner: 'white', reason: 'abandon' },
      ],
      [{ kind: 'agreeDraw' }, { winner: null, reason: 'agreement' }],
    ];
    for (const [input, result] of cases) {
      const r = engine.applyAction(state, input);
      expect(r.kind).toBe('done');
      expect(r.state.result).toEqual(result);
      expect(r.events.map((e) => e.k)).toEqual(['BattleEnded']);
      expect(() => engine.applyAction(r.state, move('white', 'e2e4'))).toThrow(RulesError);
    }
  });

  it('R-RULES-005 timeout is always a loss, even when the opponent has only a king; insufficient material never auto-draws', () => {
    const r = scenario({ fen: '7k/8/8/8/8/8/8/4K3 w - - 0 1', moves: ['e1e2', 'h8g8'] });
    expect(r.state.result).toBeNull();
    const white = r.engine.applyAction(r.state, { kind: 'timeout', side: 'white' });
    expect(white.state.result).toEqual({ winner: 'black', reason: 'timeout' });
    const black = r.engine.applyAction(r.state, { kind: 'timeout', side: 'black' });
    expect(black.state.result).toEqual({ winner: 'white', reason: 'timeout' });
  });

  it('R-RULES-005 stalemate is a draw', () => {
    const r = scenario({ fen: '7k/8/8/8/6Q1/8/8/4K3 w - - 0 1', moves: ['g4g6'] });
    expect(r.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('R-RULES-005 threefold repetition of the full state is a draw on the third occurrence', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const twice = scenario({ moves: shuffle });
    expect(twice.state.result).toBeNull();
    const thrice = scenario({ moves: [...shuffle, ...shuffle] });
    expect(thrice.state.result).toEqual({ winner: null, reason: 'repetition' });
    expect(eventsOf(thrice.steps[7]?.events ?? [], 'BattleEnded')).toHaveLength(1);
  });

  it('R-RULES-005 DD-33 repetition compares the full engine state: a position repeated after a reveal is a new position', () => {
    // Ke1-e2 walks into the rook's rank, which reveals Stalwart (DD-32). The board then returns to
    // the start position twice, but with Stalwart revealed it is not the start state.
    const fen = '6nk/8/8/8/8/8/r7/4K1N1 w - - 0 1';
    const opening = ['e1e2', 'g8f6', 'e2e1', 'f6g8'];
    // Shares no position with the opening, so only the start board can repeat.
    const cycle = ['g1h3', 'g8h6', 'h3g1', 'h6g8'];
    const twice = scenario({
      fen,
      white: { abilities: ['stalwart'] },
      moves: [...opening, ...cycle],
    });
    expect(twice.state.reveals.white.abilities.king).toContain('stalwart');
    expect(twice.engine.toFen(twice.state).split(' ')[0]).toBe(fen.split(' ')[0]);
    expect(twice.state.result).toBeNull();
    const thrice = scenario({
      fen,
      white: { abilities: ['stalwart'] },
      moves: [...opening, ...cycle, ...cycle],
    });
    expect(thrice.state.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('R-RULES-005 DD-11 resignation ends the battle even while a choice is pending', () => {
    const { engine, state } = setup({ fen: E6_FEN, black: { abilities: ['riposte'] } });
    const r1 = needsChoice(engine.applyAction(state, move('white', 'b3d5')));
    const r = engine.applyAction(r1.state, { kind: 'resign', side: 'white' });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'resign' });
    expect(r.state.pending).toBeNull();
    expect(() => engine.applyAction(r.state, choose(r1, 0))).toThrow(RulesError);
  });

  it('R-RULES-005 fifty moves each without a capture or pawn move is a draw', () => {
    const before = scenario({ fen: '7k/8/8/8/8/8/8/1R2K3 w - - 98 80', moves: ['e1e2'] });
    expect(before.state.result).toBeNull();
    const r = scenario({ fen: '7k/8/8/8/8/8/8/1R2K3 w - - 99 80', moves: ['e1e2'] });
    expect(r.state.halfmove).toBe(100);
    expect(r.state.result).toEqual({ winner: null, reason: 'fifty_move' });
  });

  it('R-RULES-005 DD-25 royal defeat and stalemate outrank the fifty-move rule on the same move', () => {
    const mate = scenario({ fen: 'k7/8/1K6/8/8/8/8/7R w - - 99 80', moves: ['h1h8'] });
    expect(mate.state.result).toEqual({ winner: 'white', reason: 'checkmate' });
    const stale = scenario({ fen: '7k/8/8/8/6Q1/8/8/4K3 w - - 99 80', moves: ['g4g6'] });
    expect(stale.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('R-RULES-005 R-RULES-003 both kings defeated within the same reaction chain is a draw (double_royal_defeat)', () => {
    // The white Stalwart king takes the black Stalwart king; Riposte lets the rook take it back.
    const r = scenario({
      fen: '4r3/8/8/4k3/3K4/8/8/8 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['stalwart', 'riposte'] },
      moves: ['d4e5'],
      answers: [mv('e8', 'e5')],
    });
    expect(
      eventsOf(r.events, 'Captured').map((e) => [e.victimSide, e.victimType, e.by, e.depth]),
    ).toEqual([
      ['black', 'king', 'move', 0],
      ['white', 'king', 'move', 1],
    ]);
    expect(r.state.result).toEqual({ winner: null, reason: 'double_royal_defeat' });
    expect(eventsOf(r.events, 'BattleEnded')).toHaveLength(1);
  });
});

describe('R-FMT-001 / R-FMT-002 format objectives', () => {
  it('R-FMT-001 First Blood: a pawn capture does not end the battle; the first non-pawn capture wins', () => {
    const r = scenario({
      fen: '7k/8/5b2/3p4/8/2N5/8/7K w - - 0 1',
      format: 'first_blood',
      moves: ['c3d5', 'h8h7', 'd5f6'],
    });
    expect(eventsOf(r.steps[0]?.events ?? [], 'BattleEnded')).toEqual([]);
    expect(r.state.objective).toEqual({ white: 1, black: 0 });
    expect(r.state.result).toEqual({ winner: 'white', reason: 'objective' });
  });

  it('R-FMT-001 E4 DD-38 First Blood: an effect capture of a non-pawn is credited to the owner of the ability', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      format: 'first_blood',
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.objective).toEqual({ white: 0, black: 1 });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'objective' });
    expect(r.events.at(-1)).toMatchObject({
      k: 'BattleEnded',
      result: { winner: 'black', reason: 'objective' },
    });
  });

  it('R-FMT-002 First Blood: when both sides score in one chain, the earliest qualifying capture wins', () => {
    // Nc3xd5 takes a knight first; its Poisoned Meat then removes the white knight.
    const r = scenario({
      fen: '7k/8/8/3n4/8/2N5/8/K7 w - - 0 1',
      format: 'first_blood',
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victimSide, e.by])).toEqual([
      ['black', 'move'],
      ['white', 'effect'],
    ]);
    expect(r.state.objective).toEqual({ white: 1, black: 1 });
    expect(r.state.result).toEqual({ winner: 'white', reason: 'objective' });
  });

  it('R-FMT-002 R-RULES-005 DD-25 DD-38 a royal defeat in the same chain outranks the First Blood objective', () => {
    // Be8xc6 uncovers mate from the rook a8; Poisoned Meat removes the bishop, which would give
    // black First Blood, but black is checkmated in the same chain.
    const r = scenario({
      fen: 'R3B2k/6pp/2p5/8/8/8/8/4K3 w - - 0 1',
      format: 'first_blood',
      black: { abilities: ['poisoned_meat'] },
      moves: ['e8c6'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victimType, e.by])).toEqual([
      ['pawn', 'move'],
      ['bishop', 'effect'],
    ]);
    expect(r.state.objective).toEqual({ white: 0, black: 1 });
    expect(r.state.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });

  it('R-FMT-002 DD-25 the format objective outranks stalemate: taking the last black piece wins First Blood even though black has no move', () => {
    const fen = 'k7/8/1n6/8/8/8/8/1Q2K3 w - - 0 1';
    const full = scenario({ fen, moves: ['b1b6'] });
    expect(full.state.result).toEqual({ winner: null, reason: 'stalemate' });
    const fb = scenario({ fen, format: 'first_blood', moves: ['b1b6'] });
    expect(fb.state.result).toEqual({ winner: 'white', reason: 'objective' });
  });

  it('R-FMT-001 First Blood: a royal defeat still wins without any capture', () => {
    const r = scenario({ format: 'first_blood', moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] });
    expect(r.state.objective).toEqual({ white: 0, black: 0 });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'checkmate' });
  });

  it('R-FMT-001 DD-38 a promoted pawn counts as its new type: capturing the new queen wins First Blood', () => {
    const r = scenario({
      fen: '7r/1P6/8/8/8/8/8/k3K3 w - - 0 1',
      format: 'first_blood',
      moves: ['b7b8q', 'h8b8'],
    });
    expect(eventsOf(r.steps[0]?.events ?? [], 'BattleEnded')).toEqual([]);
    expect(eventsOf(r.steps[1]?.events ?? [], 'Captured')).toEqual([
      expect.objectContaining({ victimType: 'queen', by: 'move' }),
    ]);
    expect(r.state.result).toEqual({ winner: 'black', reason: 'objective' });
  });

  it("R-FMT-001 R-FMT-002 Vanguard needs three non-pawn captures; the third may be a bonus capture in the opponent's action", () => {
    const r = scenario({
      fen: '7k/8/r2b4/8/3nN3/8/8/3Q2K1 w - - 0 1',
      format: 'vanguard',
      white: { abilities: ['riposte'] },
      moves: ['d1d4', 'h8g8', 'd4d6', 'a6d6'],
      answers: [mv('e4', 'd6')],
    });
    const steps = r.steps.map((s) => eventsOf(s.events, 'BattleEnded').length);
    expect(steps).toEqual([0, 0, 0, 1]);
    const last = r.steps[3]?.events ?? [];
    expect(eventsOf(last, 'Captured').map((e) => [e.victimType, e.victimSide, e.depth])).toEqual([
      ['queen', 'white', 0],
      ['rook', 'black', 1],
    ]);
    expect(r.state.objective).toEqual({ white: 3, black: 1 });
    expect(r.state.result).toEqual({ winner: 'white', reason: 'objective' });
  });

  it('R-FMT-001 Vanguard: two non-pawn captures are not enough', () => {
    const r = scenario({
      fen: '7k/8/r2b4/8/3nN3/8/8/3Q2K1 w - - 0 1',
      format: 'vanguard',
      moves: ['d1d4', 'h8g8', 'd4d6'],
    });
    expect(r.state.objective).toEqual({ white: 2, black: 0 });
    expect(r.state.result).toBeNull();
  });
});

describe('R-ABIL-001 trigger categories', () => {
  it('R-ABIL-001 CAPTURING fires before the victim is removed; CAPTURES (captor) and CAPTURED (victim) fire after; nothing else fires', () => {
    const set = ['scout', 'hit_and_run', 'last_word'];
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: set },
      black: { abilities: set },
      moves: ['c3d5'],
    });
    const pawn = idAt(r.initial, 'd5');
    const knight = idAt(r.initial, 'c3');
    expect(triggered(r.events)).toEqual([
      'white scout CAPTURING d0',
      'black last_word CAPTURED d0',
      'white hit_and_run CAPTURES d0',
    ]);
    const captured = at(r.events, (e) => e.k === 'Captured' && e.victim === pawn);
    // Scout reveals the victim's set before the victim is removed.
    const scouted = at(
      r.events,
      (e) => e.k === 'Revealed' && e.side === 'black' && e.info.kind === 'set',
    );
    expect(scouted).toBeGreaterThanOrEqual(0);
    expect(scouted).toBeLessThan(captured);
    expect(at(r.events, isTrig('last_word'))).toBeGreaterThan(captured);
    expect(at(r.events, isTrig('hit_and_run'))).toBeGreaterThan(captured);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
  });

  it('R-ABIL-001 R-RULES-001 Passive abilities never trigger, and non-capturing moves and castling trigger nothing', () => {
    const set = ['stalwart', 'veil', 'scout', 'hit_and_run', 'last_word', 'momentum', 'riposte'];
    const r = scenario({
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      white: { abilities: set },
      black: { abilities: set },
      moves: ['e1g1', 'e8c8', 'f1f7'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(r.prompts).toEqual([]);
    expect(pieceAt(r.state, 'g1')?.type).toBe('king');
    expect(pieceAt(r.state, 'd8')?.type).toBe('rook');
  });
});

describe('R-ABIL-003 the five-phase pipeline', () => {
  it('R-ABIL-003 DD-35 the event stream follows Commit, Before capture, Capture, Reactions, Settle', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['scout', 'antidote', 'hit_and_run'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const shown = new Set([
      'ActionStarted',
      'AbilityTriggered',
      'Captured',
      'MoveMade',
      'EffectFizzled',
      'PieceMoved',
      'TurnPassed',
    ]);
    const trace = r.events
      .filter((e) => shown.has(e.k))
      .map((e) => {
        if (e.k === 'AbilityTriggered') return `Triggered ${e.side} ${e.ability ?? '?'}`;
        if (e.k === 'Captured') return `Captured ${e.victimSide} ${e.victimType} ${e.by}`;
        if (e.k === 'EffectFizzled') return `Fizzled ${e.ability ?? '?'} ${e.reason}`;
        if (e.k === 'MoveMade') return `MoveMade ${e.from}-${e.to}`;
        if (e.k === 'PieceMoved') return `PieceMoved ${e.from}-${e.to}`;
        return e.k;
      });
    expect(trace).toEqual([
      'ActionStarted',
      'Triggered white scout',
      'Triggered white antidote',
      'Captured black pawn move',
      `MoveMade ${sq('c3')}-${sq('d5')}`,
      'Triggered black poisoned_meat',
      'Fizzled poisoned_meat protected',
      'Triggered white hit_and_run',
      `PieceMoved ${sq('d5')}-${sq('c3')}`,
      'TurnPassed',
    ]);
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
  });

  it('R-ABIL-003 a bonus capture runs a nested pipeline whose events sit at depth 1 inside the reaction that granted it, before Settle', () => {
    const r = scenario({
      fen: E6_FEN,
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const ev = r.events;
    const depths = ev.map((e) => e.depth);
    const first = depths.indexOf(1);
    const lastNested = depths.lastIndexOf(1);
    expect(first).toBeGreaterThan(at(ev, isTrig('riposte')));
    expect(depths.slice(first, lastNested + 1).every((d) => d === 1)).toBe(true);
    expect(
      ev
        .slice(first, lastNested + 1)
        .filter((e) => e.k === 'Captured' || e.k === 'MoveMade')
        .map((e) => e.k),
    ).toEqual(['Captured', 'MoveMade']);
    const settle = at(ev, (e) => e.k === 'TurnPassed');
    expect(settle).toBeGreaterThan(lastNested);
    expect(ev[settle]?.depth).toBe(0);
  });
});

describe('R-ABIL-004 resolution rules', () => {
  it('R-ABIL-004 DD-17 earned triggers persist: Reinforce resolves after Poisoned Meat removed its bearer, victim side first', () => {
    // Black's bishop took the e4 pawn on its starting square; Nc3xe4 retakes, Poisoned Meat removes
    // the knight (emptying e4) and the knight's earned Reinforce then revives the pawn there.
    const r = scenario({
      fen: '7k/1b6/8/8/4P3/2N5/8/6K1 b - - 0 1',
      white: { abilities: ['reinforce'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['b7e4', 'c3e4'],
    });
    const pawn = idAt(r.initial, 'e4');
    const knight = idAt(r.initial, 'c3');
    const last = r.steps[1]?.events ?? [];
    expect(triggered(last)).toEqual([
      'black poisoned_meat CAPTURED d0',
      'white reinforce CAPTURES d0',
    ]);
    expect(at(last, isTrig('reinforce'))).toBeGreaterThan(
      at(last, (e) => e.k === 'Captured' && e.victim === knight),
    );
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'white', square: sq('e4') }),
    ]);
    expect(eventsOf(last, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: knight, ability: 'reinforce', remaining: 0 }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(pawn);
    expect(r.state.pieces[knight]?.square).toBe(-1);
  });

  it('R-ABIL-004 E1 DD-17 self-acting effects fizzle without a body: Hit and Run and Momentum of a removed captor fizzle, no charge spent', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['hit_and_run', 'momentum'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(triggered(r.events)).toEqual([
      'black poisoned_meat CAPTURED d0',
      'white hit_and_run CAPTURES d0',
      'white momentum CAPTURES d0',
    ]);
    expect(eventsOf(r.events, 'EffectFizzled').map((e) => [e.side, e.ability, e.reason])).toEqual([
      ['white', 'hit_and_run', 'no_body'],
      ['white', 'momentum', 'no_body'],
    ]);
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(2);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
  });

  it('R-ABIL-004 an effect measured from a square uses the last known square: Cleave of a removed captor still takes the pawn next to its landing square', () => {
    const r = scenario({
      fen: '7k/8/4p3/3p4/8/2N5/8/K7 w - - 0 1',
      white: { abilities: ['cleave'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const e6 = idAt(r.initial, 'e6');
    expect(triggered(r.events)).toEqual([
      'black poisoned_meat CAPTURED d0',
      'white cleave CAPTURES d0',
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [idAt(r.initial, 'd5'), 'move'],
      [knight, 'effect'],
      [e6, 'effect'],
    ]);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('R-ABIL-004 effect captures never trigger Captured abilities: a knight removed by Poisoned Meat fires neither its own Poisoned Meat nor Rebirth', () => {
    const r = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['poisoned_meat', 'rebirth'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(triggered(r.events)).toEqual(['black poisoned_meat CAPTURED d0']);
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-004 effect captures never trigger Captured abilities: a pawn carrying Poisoned Meat and Riposte taken by Cleave does nothing', () => {
    const r = scenario({
      fen: '7k/8/4p3/3b4/8/2N5/8/K7 w - - 0 1',
      white: { abilities: ['cleave'] },
      black: { sets: [['poisoned_meat', 'riposte'], [], [], [], [], []] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(triggered(r.events)).toEqual(['white cleave CAPTURES d0']);
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victimType, e.by])).toEqual([
      ['bishop', 'move'],
      ['pawn', 'effect'],
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });

  it('R-ABIL-004 INV-01 each ability instance fires at most once per action, nested actions included; the same ability on another piece fires on its own', () => {
    // Nc3xd5; the knight's Riposte (first in its set) lets e6xd5 retake at depth 1; the white
    // knight's Poisoned Meat removes that pawn; then the black knight's earned Poisoned Meat finds
    // its captor gone and fizzles.
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/8/2N5/8/K7 w - - 0 1',
      white: { abilities: ['poisoned_meat'] },
      black: { abilities: ['riposte', 'poisoned_meat'] },
      moves: ['c3d5'],
      answers: [mv('e6', 'd5')],
    });
    const whiteKnight = idAt(r.initial, 'c3');
    const blackKnight = idAt(r.initial, 'd5');
    const pawn = idAt(r.initial, 'e6');
    expect(
      eventsOf(r.events, 'AbilityTriggered').map((e) => [e.piece, e.ability, e.depth]),
    ).toEqual([
      [blackKnight, 'riposte', 0],
      [whiteKnight, 'poisoned_meat', 1],
      [blackKnight, 'poisoned_meat', 0],
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by, e.depth])).toEqual([
      [blackKnight, 'move', 0],
      [whiteKnight, 'move', 1],
      [pawn, 'effect', 1],
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'black', piece: blackKnight, ability: 'poisoned_meat' }),
    ]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'd8')?.type).toBe('rook');
  });

  it("R-ABIL-004 triggers of the same piece resolve in the owner's loadout order, which changes the outcome", () => {
    const fen = '7k/8/4p3/3p4/3p4/2N5/8/7K w - - 0 1';
    // Cleave first: measured from d5, it takes e6; then Hit and Run returns to c3.
    const a = scenario({ fen, white: { abilities: ['cleave', 'hit_and_run'] }, moves: ['c3d5'] });
    expect(triggered(a.events)).toEqual([
      'white cleave CAPTURES d0',
      'white hit_and_run CAPTURES d0',
    ]);
    expect(pieceAt(a.state, 'e6')).toBeUndefined();
    expect(pieceAt(a.state, 'd4')?.type).toBe('pawn');
    expect(pieceAt(a.state, 'c3')?.type).toBe('knight');
    // Hit and Run first: back on c3, Cleave is measured from c3 and takes d4 instead.
    const b = scenario({ fen, white: { abilities: ['hit_and_run', 'cleave'] }, moves: ['c3d5'] });
    expect(triggered(b.events)).toEqual([
      'white hit_and_run CAPTURES d0',
      'white cleave CAPTURES d0',
    ]);
    expect(pieceAt(b.state, 'd4')).toBeUndefined();
    expect(pieceAt(b.state, 'e6')?.type).toBe('pawn');
    expect(pieceAt(b.state, 'c3')?.type).toBe('knight');
  });

  it("R-ABIL-004 across sides the victim's triggers resolve first, whichever side is moving", () => {
    const w = scenario({
      fen: KNIGHT_TAKES_PAWN,
      white: { abilities: ['hit_and_run', 'last_word'] },
      black: { abilities: ['hit_and_run', 'last_word'] },
      moves: ['c3d5'],
    });
    expect(triggered(w.events)).toEqual([
      'black last_word CAPTURED d0',
      'white hit_and_run CAPTURES d0',
    ]);
    const b = scenario({
      fen: '7k/8/2n5/8/3P4/8/8/K7 b - - 0 1',
      white: { abilities: ['hit_and_run', 'last_word'] },
      black: { abilities: ['hit_and_run', 'last_word'] },
      moves: ['c6d4'],
    });
    expect(triggered(b.events)).toEqual([
      'white last_word CAPTURED d0',
      'black hit_and_run CAPTURES d0',
    ]);
  });
});

describe('DD-11 suspended actions', () => {
  /** Nc3xd5: black may Riposte (e6xd5) first, then white may make a Momentum move. */
  const TWO_PROMPTS: ScenarioSpec = {
    fen: '7k/8/4p3/3p4/8/2N5/8/K7 w - - 0 1',
    white: { abilities: ['momentum'] },
    black: { abilities: ['riposte'] },
  };

  it('DD-11 R-DATA-002 a suspended action is plain JSON and resumes from a copy (Durable Object restart) with exactly the same result', () => {
    const { engine, state } = setup({ fen: E6_FEN, black: { abilities: ['riposte'] } });
    const r1 = needsChoice(engine.applyAction(state, move('white', 'b3d5')));
    expect(r1.request.chooser).toBe('black');
    expect(r1.state.pending).not.toBeNull();
    expect(r1.state.result).toBeNull();
    const stored = JSON.stringify(r1.state);
    expect(JSON.parse(stored)).toEqual(r1.state);
    for (let option = 0; option < r1.request.options.length; option++) {
      const input = choose(r1, option);
      const original = engine.applyAction(r1.state, input);
      const restored = engine.applyAction(JSON.parse(stored) as GameState, input);
      const fresh = makeEngine().applyAction(JSON.parse(stored) as GameState, input);
      expect(original.kind).toBe('done');
      expect(original.state.pending).toBeNull();
      expect(restored).toEqual(original);
      expect(fresh).toEqual(original);
    }
  });

  it('DD-11 events returned after each resume continue the stream without repeating events already returned', () => {
    const { engine, state } = setup(TWO_PROMPTS);
    const r1 = needsChoice(engine.applyAction(state, move('white', 'c3d5')));
    expect(r1.request.source.ability).toBe('riposte');
    const r2 = needsChoice(
      engine.applyAction(json(r1.state), choose(r1, optionIndex(r1, { kind: 'decline' }))),
    );
    expect(r2.request.source.ability).toBe('momentum');
    const r3 = engine.applyAction(json(r2.state), choose(r2, optionIndex(r2, mv('d5', 'b4'))));
    expect(r3.kind).toBe('done');
    const all = [...r1.events, ...r2.events, ...r3.events];
    const first = all[0]?.i ?? -1;
    expect(first).toBe(state.eventSeq);
    expect(all.map((e) => e.i)).toEqual(all.map((_, k) => first + k));
    expect(r3.state.eventSeq).toBe(first + all.length);
    expect(eventsOf(all, 'ActionStarted')).toHaveLength(1);
    expect(eventsOf(all, 'Captured')).toHaveLength(1);
    expect(eventsOf(all, 'ChoiceMade')).toHaveLength(2);
    expect(eventsOf(all, 'TurnPassed')).toHaveLength(1);
    expect(eventsOf(r1.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r2.events, 'Captured')).toEqual([]);
    expect(eventsOf(r3.events, 'Captured')).toEqual([]);
    // Same stream as resuming the live objects at every prompt.
    const live = scenario({
      ...TWO_PROMPTS,
      moves: ['c3d5'],
      answers: [{ kind: 'decline' }, mv('d5', 'b4')],
    });
    expect(all).toEqual(live.events);
    expect(r3.state).toEqual(live.state);
  });

  it('DD-11 a stale promptId, the wrong side, a bad option or a move while a choice is pending is rejected', () => {
    const { engine, state } = setup(TWO_PROMPTS);
    const r1 = needsChoice(engine.applyAction(state, move('white', 'c3d5')));
    const req = r1.request;
    const bad: ActionInput[] = [
      { kind: 'choice', side: 'white', promptId: req.promptId, option: 0 },
      { kind: 'choice', side: 'black', promptId: `${req.promptId}x`, option: 0 },
      { kind: 'choice', side: 'black', promptId: req.promptId, option: req.options.length },
      { kind: 'choice', side: 'black', promptId: req.promptId, option: -1 },
      move('white', 'a1a2'),
      move('black', 'e6d5'),
    ];
    for (const input of bad) {
      expect(() => engine.applyAction(r1.state, input)).toThrow(RulesError);
    }
    // The earlier prompt's id is stale once the next prompt is open.
    const r2 = needsChoice(engine.applyAction(r1.state, choose(r1, 0)));
    expect(r2.request.promptId).not.toBe(req.promptId);
    expect(() =>
      engine.applyAction(r2.state, {
        kind: 'choice',
        side: r2.request.chooser,
        promptId: req.promptId,
        option: 0,
      }),
    ).toThrow(RulesError);
    // No choice is pending on a finished action.
    const done = engine.applyAction(r2.state, choose(r2, 0));
    expect(done.kind).toBe('done');
    expect(() =>
      engine.applyAction(done.state, {
        kind: 'choice',
        side: 'white',
        promptId: r2.request.promptId,
        option: 0,
      }),
    ).toThrow(RulesError);
  });

  it("DD-39 choices pre-supplied with a move are not used for the opponent's prompts or for the mover's own Captures abilities", () => {
    const e6 = setup({ fen: E6_FEN, black: { abilities: ['riposte'] } });
    const r1 = e6.engine.applyAction(e6.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('b3d5'),
      choices: [mv('e6', 'd5')],
    });
    expect(needsChoice(r1).request.chooser).toBe('black');

    // Cleave (Captures) with two pawns in reach still prompts its owner.
    const cl = setup({
      fen: '7k/8/2p1p3/3p4/8/2N5/8/K7 w - - 0 1',
      white: { abilities: ['cleave'] },
    });
    const e6pawn = idAt(cl.state, 'e6');
    const r2 = needsChoice(
      cl.engine.applyAction(cl.state, {
        kind: 'move',
        side: 'white',
        move: uciToMove('c3d5'),
        choices: [{ kind: 'piece', piece: e6pawn, square: sq('e6') }],
      }),
    );
    expect(r2.request).toMatchObject({ chooser: 'white', kind: 'target' });
    expect(r2.request.source.ability).toBe('cleave');
    expect(r2.request.options).toEqual([
      { kind: 'piece', piece: idAt(cl.state, 'c6'), square: sq('c6') },
      { kind: 'piece', piece: e6pawn, square: sq('e6') },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------

const POOL = [
  'scout',
  'hit_and_run',
  'last_word',
  'poisoned_meat',
  'pierce',
  'backdraft',
  'antidote',
  'cleave',
  'momentum',
  'reinforce',
  'riposte',
  'rebirth',
  'stalwart',
  'veil',
] as const;

const armyArb = fc.record({
  abilities: fc.subarray([...POOL], { maxLength: 5 }),
  element: fc.constantFrom('neutral', 'ember', 'tide', 'grove') as fc.Arbitrary<
    'neutral' | 'ember' | 'tide' | 'grove'
  >,
});

/** Invariants that must hold after every action of any battle. */
function checkAction(engine: Engine, pre: GameState, post: GameState, events: BattleEvent[]): void {
  const actor = pre.turn;
  // Event indices are contiguous across the action and its resumes (DD-11).
  expect(events.map((e) => e.i)).toEqual(events.map((_, k) => pre.eventSeq + k));
  // INV-07, INV-02: no king falls to an effect; only a Stalwart king falls to a move.
  for (const c of eventsOf(events, 'Captured')) {
    if (c.victimType !== 'king') continue;
    expect(c.by).toBe('move');
    expect(hasStalwart(pre, c.victimSide)).toBe(true);
  }
  // R-ABIL-004: each ability instance fires at most once per action, nested actions included.
  const pairs = eventsOf(events, 'AbilityTriggered').map((e) => `${e.piece}:${e.ability}`);
  expect(new Set(pairs).size).toBe(pairs.length);
  // R-ABIL-001, R-ABIL-004: triggers come only from move captures, from the right role.
  const byMove = eventsOf(events, 'Captured').filter((c) => c.by === 'move');
  const victims = new Set(byMove.map((c) => c.victim));
  const captors = new Set(byMove.map((c) => c.captor));
  for (const t of eventsOf(events, 'AbilityTriggered')) {
    expect(t.category).not.toBe('PASSIVE');
    if (t.category === 'CAPTURED') expect(victims.has(t.piece)).toBe(true);
    else expect(captors.has(t.piece)).toBe(true);
  }
  // INV-05: between a move capture and its captor landing, nothing resolves.
  const board = new Set(['MoveMade', 'AbilityTriggered', 'Captured', 'PieceMoved', 'PieceRevived']);
  events.forEach((e, k) => {
    if (e.k !== 'Captured' || e.by !== 'move') return;
    const next = events.slice(k + 1).find((x) => board.has(x.k));
    expect(next).toMatchObject({ k: 'MoveMade', piece: e.captor, capture: true });
  });
  // INV-03: the acting player's ordinary king is never left in check by its own action.
  if (!hasStalwart(pre, actor)) {
    expect(engine.position(post).inCheck(actor === 'white' ? 0 : 1)).toBe(false);
    expect(eventsOf(events, 'Check').filter((c) => c.side === actor)).toEqual([]);
  }
}

describe('property: invariants over random battles with random loadouts', () => {
  it('INV-02 INV-03 INV-04 INV-05 INV-07 R-ABIL-004 DD-11 random battles: replays from JSON are identical, inputs are never mutated, kings are safe, triggers fire at most once', () => {
    fc.assert(
      fc.property(
        armyArb,
        armyArb,
        fc.constantFrom(START, KIWIPETE),
        fc.constantFrom<FormatId>('full', 'first_blood', 'vanguard'),
        fc.array(fc.nat(), { minLength: 50, maxLength: 50 }),
        fc.array(fc.nat(), { minLength: 20, maxLength: 20 }),
        (w, b, fen, format, picks, answers) => {
          const { engine, state: s0 } = setup({
            fen,
            format,
            white: { abilities: w.abilities, elements: [w.element] },
            black: { abilities: b.abilities, elements: [b.element] },
          });
          let state = s0;
          let answer = 0;
          for (const pick of picks) {
            if (state.result) break;
            // INV-02: an ordinary king is never a destination in either side's legal moves.
            for (const side of ['white', 'black'] as const) {
              const king = state.pieces.find((p) => p.side === other(side) && p.type === 'king');
              if (!king || king.square < 0 || hasStalwart(state, other(side))) continue;
              expect(engine.legalMoves(state, side).filter((m) => m.to === king.square)).toEqual(
                [],
              );
            }
            const legal = engine.legalMoves(state, state.turn);
            expect(legal.length).toBeGreaterThan(0);
            const m = legal[pick % legal.length];
            if (!m) break;
            const pre = state;
            let input: ActionInput = { kind: 'move', side: state.turn, move: m };
            const events: BattleEvent[] = [];
            for (let guard = 0; guard < 16; guard++) {
              const before = JSON.stringify(state);
              const r = engine.applyAction(state, input);
              // INV-04 + DD-11: the same input on a JSON copy gives the same result.
              expect(engine.applyAction(json(state), input)).toEqual(r);
              expect(JSON.stringify(state)).toBe(before);
              events.push(...r.events);
              state = r.state;
              if (r.kind === 'done') break;
              expect(r.request.options.length).toBeGreaterThan(0);
              const n = answers[answer++ % answers.length] ?? 0;
              input = choose(r, n % r.request.options.length);
            }
            expect(state.pending).toBeNull();
            checkAction(engine, pre, state, events);
          }
        },
      ),
      { seed: 20260925, numRuns: 40 },
    );
  });
});
