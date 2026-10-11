/**
 * Block Path (5.8): Passive, neutral, all. "The piece faces one of eight directions, forward by
 * default. It cannot be move-captured by an attacker approaching from that direction; a diagonal is
 * blocked only when that diagonal is chosen. After moving the piece its owner may choose a new
 * direction (a declinable prompt; declining keeps the old one); a king gets no prompt and always
 * faces forward after it moves. Kings included: a king cannot be checked from its blocked direction.
 * Knights approach along their long leg. Costs two ability slots."
 *
 * Expected behaviour comes from spec 5.4 (prompts), 5.6, 8.2 (DD-32), DD-99, DD-102 (hard
 * restriction), DD-105 (prompt visibility), R-SEC-001 and the B5 brief (2026-10-11: two slots, the
 * king faces forward after it moves).
 */
import { describe, expect, it } from 'vitest';
import {
  type ChoiceRequest,
  type Engine,
  type GameState,
  type Side,
  moveToUci,
  uciToMove,
} from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, play, scenario, setup } from '../src/testing.ts';
import { FACINGS, type BlockPathState } from './block_path.ts';

const sq = parseSquare;
const legal = (engine: Engine, state: GameState, side: Side): string[] =>
  engine.legalMoves(state, side).map(moveToUci);
const pickSquare = (name: string) => (req: ChoiceRequest) => {
  const i = req.options.findIndex((o) => o.kind === 'square' && o.square === sq(name));
  if (i < 0) throw new Error(`${name} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};
const facings = (s: GameState) => (s.slices[FACINGS] as BlockPathState).facing;

// White rook a1 (Block Path), king e1; black rooks a8 and h4, king e8.
const ROOKS = 'r3k3/8/8/8/7r/8/8/R3K3 w - - 0 1';

describe('Block Path (5.8, DD-99)', () => {
  it('R-ABIL-005 module data: Passive, neutral, all, level 12, 2 slots (B5); a facings slice, captureFilter and onActionEnd hooks', () => {
    const def = abilityById.get('block_path');
    expect(def).toMatchObject({
      category: 'PASSIVE',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 12,
      slotCost: 2,
    });
    expect(def?.hooks?.stateSlice?.id).toBe(FACINGS);
    expect(def?.hooks?.moveFilter?.captureFilter).toBeTypeOf('function');
    expect(def?.hooks?.onActionEnd).toBeTypeOf('function');
  });

  it('R-RULES-001 DD-99 default facing is forward: a white pawn is safe from a rook to its north but not from a bishop to its north-east', () => {
    // White pawn d4 (Block Path); black rook d7 (north), bishop g7 (north-east diagonal).
    const { engine, state } = setup({
      fen: '4k3/3r2b1/8/8/3P4/8/8/4K3 b - - 0 1',
      white: { abilities: ['block_path'] },
    });
    const moves = legal(engine, state, 'black');
    expect(moves).not.toContain('d7d4');
    expect(moves).toContain('g7d4');
  });

  it("DD-99 Black's default facing is south (its forward): a white rook from the south is blocked, one from the north captures", () => {
    // Black pawn d5 (Block Path); white rooks d1 (south) and d8 (north).
    const { engine, state } = setup({
      fen: '3R4/8/8/3p4/8/8/8/3R1K1k w - - 0 1',
      black: { abilities: ['block_path'] },
    });
    const moves = legal(engine, state, 'white');
    expect(moves).not.toContain('d1d5');
    expect(moves).toContain('d8d5');
  });

  it('DD-99 knights approach along their long leg: from c3 the knight is south of d5 and blocked, from b6 it is west and captures', () => {
    const { engine, state } = setup({
      fen: '4k3/8/1N6/3p4/8/2N5/8/4K3 w - - 0 1',
      black: { abilities: ['block_path'] },
    });
    const moves = legal(engine, state, 'white');
    expect(moves).not.toContain('c3d5');
    expect(moves).toContain('b6d5');
  });

  it('R-ABIL-004 5.4 DD-18 after a move the owner may turn the piece: a declinable square prompt in square order, Decline first and default', () => {
    const r = scenario({
      fen: ROOKS,
      white: { abilities: ['block_path'] },
      moves: ['a1a4'],
      answers: [pickSquare('b4')],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    const rook = idAt(r.initial, 'a1');
    expect(req).toMatchObject({
      chooser: 'white',
      kind: 'square',
      purpose: 'facing',
      subject: rook,
      source: { ability: 'block_path', piece: rook, side: 'white' },
      defaultOption: 0,
    });
    // The current facing (N, a5) is not offered; W, SW and NW are off the board.
    expect(req.options).toEqual([
      { kind: 'decline' },
      { kind: 'square', square: sq('a3') },
      { kind: 'square', square: sq('b3') },
      { kind: 'square', square: sq('b4') },
      { kind: 'square', square: sq('b5') },
    ]);
    expect(eventsOf(r.events, 'FacingSet')).toEqual([
      expect.objectContaining({ piece: rook, side: 'white', square: sq('a4'), facing: 'E' }),
    ]);
    expect(facings(r.state)).toEqual({ [rook]: 'E' });
    // Facing east: the rook h4 (east) may not take it; the rook a8 (north) may.
    const moves = legal(r.engine, r.state, 'black');
    expect(moves).not.toContain('h4a4');
    expect(moves).toContain('a8a4');
  });

  it('DD-99 declining keeps the old facing (north): the rook a8 is blocked and the rook h4 captures', () => {
    const r = scenario({
      fen: ROOKS,
      white: { abilities: ['block_path'] },
      moves: ['a1a4'],
      answers: [0],
    });
    expect(eventsOf(r.events, 'FacingSet')).toEqual([]);
    expect(facings(r.state)).toEqual({});
    const moves = legal(r.engine, r.state, 'black');
    expect(moves).toContain('h4a4');
    expect(moves).not.toContain('a8a4');
  });

  it('R-INFO-002 DD-32 DD-99 the facing is revealed on the piece type the first time it removes a legal capture', () => {
    const r = scenario({
      fen: ROOKS,
      white: { abilities: ['block_path'] },
      moves: ['a1a4'],
      answers: [pickSquare('b4')],
    });
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'rook', ability: 'block_path' },
        cause: 'observed',
      }),
    ]);
  });

  it('R-SEC-001 DD-105 the opponent sees neither the facing prompt nor the facing until Block Path is revealed; spectators likewise', () => {
    const { engine, state } = setup({ fen: ROOKS, white: { abilities: ['block_path'] } });
    const rook = idAt(state, 'a1');
    const r = engine.applyAction(state, { kind: 'move', side: 'white', move: uciToMove('a1a4') });
    expect(r.kind).toBe('needsChoice');
    if (r.kind !== 'needsChoice') throw new Error('expected a prompt');
    // The chooser gets the prompt; the opponent and spectators see no pending choice at all.
    expect(engine.project(r.state, 'white').pending?.request).toEqual(r.request);
    expect(engine.project(r.state, 'black').pending).toBeNull();
    expect(engine.projectSpectator(r.state).pending).toBeNull();
    const done = engine.applyAction(r.state, {
      kind: 'choice',
      side: 'white',
      promptId: r.request.promptId,
      option: r.request.options.findIndex((o) => o.kind === 'square' && o.square === sq('b4')),
    });
    if (done.kind !== 'done') throw new Error('expected the action to finish');
    // The denial of h4xa4 revealed Block Path on rooks at Settle, so the facing is public now.
    const own = engine.project(done.state, 'white').slices[FACINGS] as BlockPathState;
    const theirs = engine.project(done.state, 'black').slices[FACINGS] as BlockPathState;
    // The owner sees every Block Path piece's facing, defaults included (the king still faces N).
    expect(own.facing).toEqual({ [rook]: 'E', [idAt(state, 'e1')]: 'N' });
    expect(theirs.facing).toEqual({ [rook]: 'E' });
    expect(
      engine.projectEvents(done.state, done.events, 'black').some((e) => e.k === 'FacingSet'),
    ).toBe(true);
  });

  it('R-SEC-001 an unrevealed facing stays private: without an attacker to deny, the opponent sees no facing and no FacingSet event', () => {
    // No black piece can reach a4 at all, so nothing is observed.
    const { engine, state } = setup({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      white: { abilities: ['block_path'] },
    });
    const rook = idAt(state, 'a1');
    const { state: after, step } = play(engine, state, 'a1a4', [pickSquare('b4')]);
    expect(facings(after)).toEqual({ [rook]: 'E' });
    expect(eventsOf(step.events, 'Revealed')).toEqual([]);
    const theirs = engine.project(after, 'black').slices[FACINGS] as BlockPathState;
    expect(theirs.facing).toEqual({});
    expect(engine.projectEvents(after, step.events, 'black').map((e) => e.k)).not.toContain(
      'FacingSet',
    );
    expect(engine.projectEvents(after, step.events, 'white').map((e) => e.k)).toContain(
      'FacingSet',
    );
  });

  it('R-RULES-005 DD-99 a king is not in check from its facing: no check alert, any move is legal, and the rule is revealed', () => {
    // White king e1 (Block Path, facing north); black rook e8 on the open e-file.
    const r = scenario({
      fen: '4r2k/8/8/8/8/8/P7/4K3 b - - 0 1',
      white: { sets: [[], [], [], [], [], ['block_path']], items: ['multitaskers_schedule'] },
      moves: ['h8g8'],
    });
    expect(eventsOf(r.events, 'Check')).toEqual([]);
    expect(r.state.inCheck).toBeNull();
    expect(legal(r.engine, r.state, 'white')).toContain('a2a3');
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'king', ability: 'block_path' },
        cause: 'observed',
      }),
    ]);
    // Control: an ordinary king is in check and must answer it.
    const plain = scenario({ fen: '4r2k/8/8/8/8/8/P7/4K3 b - - 0 1', moves: ['h8g8'] });
    expect(eventsOf(plain.events, 'Check')).toHaveLength(1);
    expect(legal(plain.engine, plain.state, 'white')).not.toContain('a2a3');
  });

  it('R-ABIL-005 DD-99 a king that moves faces forward again without a prompt, so it is checked from the side it had been facing', () => {
    // White king e1 (Block Path) and pawn a2; black king h8 and rook h7. No prompt can turn a king
    // any more, so the east facing it carries here is seeded straight into the slice, as a battle
    // saved under version 1 would carry it.
    const { engine, state: fresh } = setup({
      fen: '7k/7r/8/8/8/8/P7/4K3 w - - 0 1',
      white: { abilities: ['block_path'] },
    });
    const king = idAt(fresh, 'e1');
    const state: GameState = {
      ...fresh,
      slices: { ...fresh.slices, [FACINGS]: { facing: { [king]: 'E' } } },
    };
    // Control: while the king stands still its east facing holds, and a rook arriving on its rank
    // from the east gives no check.
    const still = play(engine, play(engine, state, 'a2a3').state, 'h7h1');
    expect(eventsOf(still.step.events, 'Check')).toEqual([]);
    expect(still.state.inCheck).toBeNull();
    expect(facings(still.state)).toEqual({ [king]: 'E' });
    // The king moves: no prompt, its facing entry is gone and FacingSet reports the forward facing.
    const moved = play(engine, state, 'e1e2');
    expect(moved.step.prompts).toEqual([]);
    expect(facings(moved.state)).toEqual({});
    expect(eventsOf(moved.step.events, 'FacingSet')).toEqual([
      expect.objectContaining({ piece: king, side: 'white', square: sq('e2'), facing: 'N' }),
    ]);
    // Facing north again, the king is in check from the rook to its east and must answer it.
    const checked = play(engine, moved.state, 'h7h2');
    expect(eventsOf(checked.step.events, 'Check')).toHaveLength(1);
    expect(checked.state.inCheck).toBe('white');
    expect(legal(engine, checked.state, 'white')).not.toContain('a2a3');
  });

  it('R-ABIL-005 DD-99 a king at its default facing moves without a prompt or a FacingSet event; castling still asks for the rook', () => {
    // White king e1 and rook h1 (both Block Path); castling moves both in one action.
    const r = scenario({
      fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
      white: { abilities: ['block_path'] },
      moves: ['e1g1'],
      answers: [0],
    });
    const king = idAt(r.initial, 'e1');
    const rook = idAt(r.initial, 'h1');
    expect(r.prompts.map((p) => [p.chooser, p.purpose, p.subject])).toEqual([
      ['white', 'facing', rook],
    ]);
    expect(eventsOf(r.events, 'FacingSet')).toEqual([]);
    expect(facings(r.state)).toEqual({});
    expect(pieceAt(r.state, 'g1')).toMatchObject({ id: king, type: 'king' });
    expect(pieceAt(r.state, 'f1')).toMatchObject({ id: rook, type: 'rook' });
  });

  it('DD-102 Stalwart does not bypass Block Path: a Stalwart queen is still blocked from the facing', () => {
    const { engine, state } = setup({
      fen: '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['block_path'] },
    });
    expect(legal(engine, state, 'white')).not.toContain('d1d5');
  });

  it('R-RULES-004 effect captures ignore the facing: Poisoned Meat still removes a Block Path captor', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['block_path'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move', 'effect']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('DD-99 a captured piece loses its facing', () => {
    const r = scenario({
      fen: ROOKS,
      white: { abilities: ['block_path'] },
      moves: ['a1a4', 'a8a4'],
      answers: [pickSquare('b4')],
    });
    expect(facings(r.state)).toEqual({});
    expect(pieceAt(r.state, 'a4')).toMatchObject({ side: 'black', type: 'rook' });
  });
});
