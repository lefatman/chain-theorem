/**
 * Hit and Run (5.7): Captures, Tide, non-king. "Return to the square it moved from, if empty."
 * Attuned: "May instead land on any empty square adjacent to it" (DD-20: adjacent to the origin
 * square; the origin stays an option). Selections are mandatory and auto-resolve with one option
 * (DD-18); options are filtered by public rules only, INV-03 included (DD-19).
 *
 * Expected behaviour comes from spec 4.1, 5.1-5.7, 6.1 (Hot Foot), 6.2, 6.3, 8.2 and DD-17 to DD-40.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type ChoiceRequest,
  type GameState,
  type PieceType,
  type Side,
  moveToUci,
  squareName,
  uciToMove,
} from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, play, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;

function revealedOn(state: GameState, side: Side, pieceType: PieceType): string[] {
  return state.reveals[side].abilities[pieceType] ?? [];
}

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
      case 'TurnPassed':
        out.push(`${d}TurnPassed ${e.side}`);
        break;
      default:
        break;
    }
  }
  return out;
}

function pickSquare(name: string) {
  const s = sq(name);
  return (req: ChoiceRequest): number => {
    const idx = req.options.findIndex((o) => o.kind === 'square' && o.square === s);
    if (idx < 0) throw new Error(`square ${name} is not offered: ${JSON.stringify(req.options)}`);
    return idx;
  };
}

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

/** Square names offered by a square prompt, in the order given. */
function offeredSquares(req: ChoiceRequest): string[] {
  return req.options.map((o) => (o.kind === 'square' ? squareName(o.square) : `not-a-square`));
}

const fizzlesOf = (events: readonly BattleEvent[], ability: string) =>
  eventsOf(events, 'EffectFizzled').filter((e) => e.ability === ability);

// e1 K=0, c3 N=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('Hit and Run', () => {
  it('R-ABIL-005 module data matches the 5.7 catalogue row (Captures, Tide, non-king, level 1, 1 slot)', () => {
    const def = abilityById.get('hit_and_run');
    expect(def?.category).toBe('CAPTURES');
    expect(def?.affinity).toBe('tide');
    expect(def?.eligible).toEqual(['pawn', 'knight', 'bishop', 'rook', 'queen']);
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(1);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it('R-ABIL-005 R-ABIL-002 R-INFO-002 base: after capturing, the knight returns to the square it moved from', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    expect(idAt(r.state, 'c3')).toBe(1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.pieces[2]?.square).toBe(-1);
    expect(r.prompts).toEqual([]);

    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered white hit_and_run',
      'PieceMoved #1 d5-c3',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'white',
      piece: 1,
      pieceType: 'knight',
      category: 'CAPTURES',
      attuned: false,
    });
    expect(eventsOf(r.events, 'PieceMoved')[0]).toMatchObject({
      piece: 1,
      side: 'white',
      from: sq('d5'),
      to: sq('c3'),
      source: { kind: 'ability', id: 'hit_and_run', piece: 1, side: 'white' },
    });
    // Revealed on activation with the piece type it was seen on (8.2).
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'hit_and_run',
      ),
    ).toMatchObject([
      {
        side: 'white',
        info: { kind: 'ability', pieceType: 'knight', ability: 'hit_and_run' },
        cause: 'activated',
      },
    ]);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['hit_and_run']);
    expect(r.state.reveals.white.complete).toEqual([]);
  });

  it('R-ABIL-005 R-ABIL-004 fizzles without a body when the captor is removed first (bishop vs Poisoned Meat)', () => {
    // e1 K=0, b3 B=1, d5 p=2, e8 k=3
    const r = scenario({
      fen: '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['b3d5'],
    });
    expect(r.state.pieces[1]?.square).toBe(-1);
    expect(pieceAt(r.state, 'b3')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white bishop#1 b3-d5',
      'Triggered black poisoned_meat',
      'Captured white bishop#1 by effect',
      'Triggered white hit_and_run',
      'Fizzled white hit_and_run no_body',
      'TurnPassed black',
    ]);
    expect(fizzlesOf(r.events, 'hit_and_run')[0]).toMatchObject({
      side: 'white',
      piece: 1,
      reason: 'no_body',
    });
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    // A fizzle still reveals the ability (8.2).
    expect(revealedOn(r.state, 'white', 'bishop')).toEqual(['hit_and_run']);
  });

  it('R-ABIL-005 R-ABIL-004 fizzles (occupied) when the origin square was filled earlier in the chain', () => {
    // e1 K=0, c2 P=1, c3 N=2, d5 p=3, e8 k=4. The Ember knight's attuned Momentum lets the c2 pawn
    // step into c3 before Hit and Run (loadout order) resolves.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/2P5/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['momentum', 'hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
      answers: [pickMove('c2c3')],
    });
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.kind).toBe('bonusMove');
    expect(idAt(r.state, 'c3')).toBe(1);
    expect(idAt(r.state, 'd5')).toBe(2);
    expect(trace(r.events)).toEqual([
      'Captured black pawn#3 by move',
      'MoveMade white knight#2 c3-d5',
      'Triggered white momentum',
      // The bonus action runs at depth 1 (INV-01, architecture 2.4).
      'd1 MoveMade white pawn#1 c2-c3 bonus',
      'Triggered white hit_and_run',
      'Fizzled white hit_and_run occupied',
      'TurnPassed black',
    ]);
    expect(fizzlesOf(r.events, 'hit_and_run')[0]).toMatchObject({
      side: 'white',
      piece: 2,
      reason: 'occupied',
    });
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
  });

  it('R-ABIL-005 R-ELEM-003 DD-20 DD-18 attuned (Tide bearer): prompts for the origin or an empty square adjacent to it', () => {
    // e1 K=0, b2 P=1, d2 P=2, c3 N=3, d4 p=4, d5 p=5, e8 k=6
    const r = scenario({
      fen: '4k3/8/8/3p4/3p4/2N5/1P1P4/4K3 w - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
      answers: [pickSquare('b4')],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req.chooser).toBe('white');
    expect(req.kind).toBe('square');
    expect(req.source).toEqual({ ability: 'hit_and_run', piece: 3, side: 'white' });
    // Mandatory selection: no Decline (DD-18). b2, d2 (own pawns) and d4 (enemy pawn) are occupied.
    expect(req.options.some((o) => o.kind === 'decline')).toBe(false);
    expect([...offeredSquares(req)].sort()).toEqual(['b3', 'b4', 'c2', 'c3', 'c4', 'd3']);
    // Default: the first valid option in square order from the owner's side (5.4).
    expect(req.options[req.defaultOption]).toEqual({ kind: 'square', square: sq('c2') });

    expect(idAt(r.state, 'b4')).toBe(3);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'hit_and_run',
      attuned: true,
    });
    expect(eventsOf(r.events, 'ChoiceMade')).toMatchObject([
      { side: 'white', option: { kind: 'square', square: sq('b4') } },
    ]);
    expect(eventsOf(r.events, 'PieceMoved')).toMatchObject([
      { piece: 3, from: sq('d5'), to: sq('b4') },
    ]);
  });

  it('R-ABIL-005 DD-39 a square pre-supplied with the move is not used for Hit and Run (a Captures ability): the owner is prompted', () => {
    const s0 = setup({
      fen: '4k3/8/8/3p4/3p4/2N5/1P1P4/4K3 w - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
    });
    const r = s0.engine.applyAction(s0.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('c3d5'),
      choices: [{ kind: 'square', square: sq('b4') }],
    });
    expect(r.kind).toBe('needsChoice');
    if (r.kind !== 'needsChoice') return;
    expect(r.request).toMatchObject({
      chooser: 'white',
      kind: 'square',
      source: { ability: 'hit_and_run', piece: 3, side: 'white' },
    });
    expect(idAt(r.state, 'd5')).toBe(3);
    const done = s0.engine.applyAction(r.state, {
      kind: 'choice',
      side: 'white',
      promptId: r.request.promptId,
      option: pickSquare('c4')(r.request),
    });
    expect(done.kind).toBe('done');
    expect(idAt(done.state, 'c4')).toBe(3);
  });

  it('R-ABIL-005 R-ELEM-003 DD-20 attuned: the origin square itself stays an option', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/3p4/2N5/1P1P4/4K3 w - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
      answers: [pickSquare('c3')],
    });
    expect(idAt(r.state, 'c3')).toBe(3);
    expect(eventsOf(r.events, 'PieceMoved')).toMatchObject([
      { piece: 3, from: sq('d5'), to: sq('c3') },
    ]);
  });

  it('R-ABIL-005 R-ELEM-003 DD-18 DD-20 attuned with exactly one valid square resolves without a prompt', () => {
    // Every square adjacent to c3 holds a white pawn: only the origin is left.
    // e1 K=0, b2 1, c2 2, d2 3, b3 4, c3 N=5, d3 6, b4 7, c4 8, d4 9, d5 p=10, e8 k=11
    const r = scenario({
      fen: '4k3/8/8/3p4/1PPP4/1PNP4/1PPP4/4K3 w - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(idAt(r.state, 'c3')).toBe(5);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({ attuned: true });
  });

  it('R-ABIL-005 INV-03 base: returning to the origin would expose the own king, so it fizzles', () => {
    // a2 K=0, c3 N=1, d5 p=2, g8 b=3, h8 k=4. On d5 the knight blocks the g8 bishop's diagonal to a2.
    const r = scenario({
      fen: '6bk/8/8/3p4/8/2N5/K7/8 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    expect(idAt(r.state, 'd5')).toBe(1);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(fizzlesOf(r.events, 'hit_and_run')).toMatchObject([
      { side: 'white', piece: 1, reason: 'inv03' },
    ]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 R-ELEM-003 INV-03 DD-19 attuned: squares that would expose the own king are not offered', () => {
    // Same position, Tide knight: only b3 and c4 keep the a2-g8 diagonal blocked.
    const r = scenario({
      fen: '6bk/8/8/3p4/8/2N5/K7/8 w - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
      answers: [pickSquare('c4')],
    });
    expect(r.prompts).toHaveLength(1);
    expect([...offeredSquares(r.prompts[0] as ChoiceRequest)].sort()).toEqual(['b3', 'c4']);
    expect(idAt(r.state, 'c4')).toBe(1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Tide Hit and Run is silenced against a Grove victim and revealed by name', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(idAt(r.state, 'd5')).toBe(1);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Silenced white hit_and_run',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')[0]).toMatchObject({
      side: 'white',
      piece: 1,
      pieceType: 'knight',
      ability: 'hit_and_run',
      category: 'CAPTURES',
      by: 2,
    });
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'hit_and_run',
      ),
    ).toMatchObject([{ side: 'white', cause: 'silenced' }]);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['hit_and_run']);
  });

  it('R-ABIL-005 R-ELEM-002 silenceScope REACTIONS_ONLY still silences Hit and Run (an After-capturing reaction)', () => {
    const r = scenario({
      fen: FEN,
      caps: { SILENCE_SCOPE: 'REACTIONS_ONLY' },
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([{ ability: 'hit_and_run' }]);
    expect(idAt(r.state, 'd5')).toBe(1);
  });

  it('R-ABIL-005 R-ELEM-001 Stillness: capturing a Frost piece negates Hit and Run (revealed as negated)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    // Tide and Frost are in different triangles: nothing is silenced; the trait negates instead.
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      {
        side: 'white',
        piece: 1,
        ability: 'hit_and_run',
        category: 'CAPTURES',
        source: { kind: 'trait', id: 'stillness', element: 'frost' },
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'hit_and_run',
      ),
    ).toMatchObject([{ side: 'white', cause: 'negated' }]);
    expect(idAt(r.state, 'd5')).toBe(1);
  });

  it('R-ABIL-005 R-ELEM-001 R-ABIL-003 Always First: a Storm Hit and Run resolves before Poisoned Meat, which then removes the knight on c3', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered white hit_and_run',
      'PieceMoved #1 d5-c3',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({ victim: 1, square: sq('c3') });
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
  });

  it('R-ABIL-005 R-RULES-001 an en passant captor returns to the square it moved from', () => {
    // e1 K=0, e5 P=1, d7 p=2, e8 k=3
    const r = scenario({
      fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['d7d5', 'e5d6'],
    });
    const ev = r.steps[1]?.events ?? [];
    expect(eventsOf(ev, 'Captured')).toMatchObject([{ victim: 2, square: sq('d5'), by: 'move' }]);
    expect(eventsOf(ev, 'PieceMoved')).toMatchObject([{ piece: 1, from: sq('d6'), to: sq('e5') }]);
    expect(idAt(r.state, 'e5')).toBe(1);
    expect(pieceAt(r.state, 'd6')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-005 Hit and Run is ineligible on a king: a king capture does not trigger it', () => {
    // e1 K=0, e2 p=1, e8 k=2
    const r = scenario({
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    expect(idAt(r.state, 'e2')).toBe(0);
    expect(revealedOn(r.state, 'white', 'king')).toEqual([]);
  });

  it('R-ABIL-005 R-ELEM-005 an Ember knight leaving by Hit and Run ignites the capture square immediately', () => {
    // e1 K=0, c3 N=1, d5 p=2, f6 n=3, e8 k=4
    const s0 = setup({
      fen: '4k3/8/5n2/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
    });
    const { state, step } = play(s0.engine, s0.state, 'c3d5');
    expect(idAt(state, 'c3')).toBe(1);
    const moved = eventsOf(step.events, 'PieceMoved')[0] as BattleEvent;
    const ignited = eventsOf(step.events, 'SquareIgnited');
    expect(ignited).toMatchObject([{ square: sq('d5'), side: 'white', turns: 3 }]);
    expect(step.events.indexOf(moved)).toBeLessThan(step.events.indexOf(ignited[0] as BattleEvent));
    // The non-Ember black knight may no longer move to d5.
    const blackMoves = s0.engine.legalMoves(state, 'black').map(moveToUci);
    expect(blackMoves).not.toContain('f6d5');
    expect(blackMoves).toContain('f6e4');
  });

  it('R-ABIL-005 R-ELEM-005 DD-19 attuned: a burning square next to the origin is not offered to a non-Ember piece', () => {
    // Black to move. e1 K=0, c3 N=1, b4 P=2, d5 p=3, a6 n=4, e8 k=5.
    // 1... Nxb4 (Ember capture, pending burn), 2. Kf1, 2... Nb4-a6 (b4 ignites), 3. Nxd5.
    const r = scenario({
      fen: '4k3/8/n7/3p4/1P6/2N5/8/4K3 b - - 0 1',
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['ember'] },
      moves: ['a6b4', 'e1f1', 'b4a6', 'c3d5'],
      answers: [pickSquare('c4')],
    });
    expect(eventsOf(r.steps[2]?.events ?? [], 'SquareIgnited')).toMatchObject([
      { square: sq('b4'), side: 'black' },
    ]);
    expect(r.prompts).toHaveLength(1);
    expect([...offeredSquares(r.prompts[0] as ChoiceRequest)].sort()).toEqual([
      'b2',
      'b3',
      'c2',
      'c3',
      'c4',
      'd2',
      'd3',
      'd4',
    ]);
    expect(idAt(r.state, 'c4')).toBe(1);
  });

  it('R-ABIL-005 R-ABIL-003 INV-01 Hit and Run resolves inside a nested bonus capture (depth 1)', () => {
    // e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6. Black's Riposte lets the h7 pawn
    // (which also carries Hit and Run) capture the bishop; the pawn then returns to h7.
    const r = scenario({
      fen: '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['riposte', 'hit_and_run'] },
      moves: ['d3g6'],
      answers: [pickMove('h7g6')],
    });
    expect(trace(r.events)).toEqual([
      'Captured black knight#2 by move',
      'MoveMade white bishop#1 d3-g6',
      'Triggered black riposte',
      'd1 Captured white bishop#1 by move',
      'd1 MoveMade black pawn#4 h7-g6 bonus',
      'd1 Triggered black hit_and_run',
      'd1 PieceMoved #4 g6-h7',
      'TurnPassed black',
    ]);
    expect(idAt(r.state, 'h7')).toBe(4);
    expect(pieceAt(r.state, 'g6')).toBeUndefined();
    expect(r.state.pieces[1]?.square).toBe(-1);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['hit_and_run']);
  });

  it('R-ABIL-005 DD-36 R-RULES-002 silence uses the pawn element at commit, even though it promotes into a Tide queen', () => {
    // Blended Family grove/tide: the b7 pawn is Grove, a queen is Tide. The a8 rook is Ember.
    // e1 K=0, h5 k=1, b7 P=2, a8 r=3
    const r = scenario({
      fen: 'r7/1P6/8/7k/8/8/8/4K3 w - - 0 1',
      white: { elements: ['grove', 'tide'], items: ['blended_family'], abilities: ['hit_and_run'] },
      black: { elements: ['ember'] },
      moves: ['b7a8q'],
    });
    expect(eventsOf(r.events, 'Promoted')).toMatchObject([
      { piece: 2, to: 'queen', element: 'tide' },
    ]);
    // Ember beats the committed Grove element: Hit and Run is silenced; the queen stays on a8.
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      { side: 'white', piece: 2, ability: 'hit_and_run', category: 'CAPTURES', by: 3 },
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(idAt(r.state, 'a8')).toBe(2);
    expect(r.state.pieces[2]?.type).toBe('queen');
  });

  it('R-ABIL-005 DD-36 R-ELEM-003 attunement uses the element when the ability resolves: the promoted Tide queen is attuned', () => {
    const r = scenario({
      fen: 'r7/1P6/8/7k/8/8/8/4K3 w - - 0 1',
      white: { elements: ['grove', 'tide'], items: ['blended_family'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['b7a8q'],
      answers: [pickSquare('b7')],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { piece: 2, pieceType: 'queen', ability: 'hit_and_run', attuned: true },
    ]);
    expect(r.prompts).toHaveLength(1);
    const offered = offeredSquares(r.prompts[0] as ChoiceRequest);
    // Origin b7 plus its empty neighbours; a8 holds the queen itself.
    expect([...offered].sort()).toEqual(['a6', 'a7', 'b6', 'b7', 'b8', 'c6', 'c7', 'c8']);
    expect(idAt(r.state, 'b7')).toBe(2);
    expect(r.state.pieces[2]?.type).toBe('queen');
    expect(revealedOn(r.state, 'white', 'queen')).toEqual(['hit_and_run']);
  });
});
