/**
 * Rebirth scenario tests (R-ABIL-005, spec 5.7, E9): Captured, Grove, non-king, revive, 1 charge.
 * At chain end, return to its starting square if empty. Attuned (Grove bearer): may return to any
 * empty back-rank square (DD-22).
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 5.1-5.7, 6.1 (Overabundance), 6.2, 6.3, 8.2 and
 * DD-17, DD-18, DD-19, DD-22, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const at = (name: string): ChoiceOption => ({ kind: 'square', square: sq(name) });

describe('rebirth (R-ABIL-005)', () => {
  it('R-ABIL-005 R-ABIL-003 rebirth returns the piece to its starting square at chain end, after the other reactions have resolved', () => {
    // Knight b6 takes the bishop on its start square c8; Hit and Run then carries the knight back
    // to b6, so c8 is empty when the chain ends.
    const r = scenario({
      fen: '2b1k3/8/1N6/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['hit_and_run'] },
      black: { abilities: ['rebirth'] },
      moves: ['b6c8'],
    });
    const bishop = idAt(r.initial, 'c8');
    const knight = idAt(r.initial, 'b6');
    expect(pieceAt(r.state, 'c8')?.id).toBe(bishop);
    expect(pieceAt(r.state, 'c8')?.type).toBe('bishop');
    expect(pieceAt(r.state, 'b6')?.id).toBe(knight);
    expect(r.prompts).toHaveLength(0);
    const kinds = r.events.map((e) => e.k);
    const iMoved = kinds.indexOf('PieceMoved');
    const iRevived = kinds.indexOf('PieceRevived');
    expect(iMoved).toBeGreaterThanOrEqual(0);
    expect(iRevived).toBeGreaterThan(iMoved);
    expect(iRevived).toBeLessThan(kinds.indexOf('TurnPassed'));
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([
      expect.objectContaining({
        piece: bishop,
        side: 'black',
        square: sq('c8'),
        source: { kind: 'ability', id: 'rebirth', piece: bishop, side: 'black' },
      }),
    ]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ side: 'black', piece: bishop, ability: 'rebirth', remaining: 0 }),
    ]);
    expect(r.state.reveals.black.abilities.bishop).toContain('rebirth');
  });

  it('R-ABIL-005 DD-17 rebirth fizzles when its starting square is occupied at chain end, and keeps its charge', () => {
    const r = scenario({
      fen: '2b1k3/8/1N6/8/8/8/8/4K3 w - - 0 1',
      black: { abilities: ['rebirth'] },
      moves: ['b6c8'],
    });
    const bishop = idAt(r.initial, 'c8');
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'rebirth', reason: 'occupied' }),
    ]);
    expect(eventsOf(r.events, 'PieceRevived')).toHaveLength(0);
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c8')?.type).toBe('knight');
    expect(r.engine.remainingCharges(r.state, bishop, 'rebirth')).toBe(1);
  });

  it('R-ABIL-005 R-ABIL-004 DD-17 rebirth has 1 charge on a neutral piece: the revived piece keeps its usage and the second capture removes it for good', () => {
    // 1... Bc8-f5 2. Qf1xf5 (bishop returns to c8) 2... Bc8-d7 3. Qf5xd7 (no charge left).
    const r = scenario({
      fen: '2b1k3/8/8/8/8/8/8/4KQ2 b - - 0 1',
      black: { abilities: ['rebirth'] },
      moves: ['c8f5', 'f1f5', 'c8d7', 'f5d7'],
    });
    const bishop = idAt(r.initial, 'c8');
    const second = r.steps[1]?.events ?? [];
    expect(eventsOf(second, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: bishop, square: sq('c8') }),
    ]);
    expect(eventsOf(second, 'ChargeSpent')[0]).toMatchObject({ remaining: 0 });
    expect(r.steps[2]?.events.find((e) => e.k === 'MoveMade')).toMatchObject({ piece: bishop });

    const fourth = r.steps[3]?.events ?? [];
    expect(eventsOf(fourth, 'Captured')).toEqual([
      expect.objectContaining({ victim: bishop, by: 'move' }),
    ]);
    expect(eventsOf(fourth, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(fourth, 'PieceRevived')).toHaveLength(0);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c8')).toBeUndefined();
    expect(r.state.usage[`${bishop}:rebirth`]).toBe(1);
  });

  it('R-ABIL-005 R-ELEM-007 E9 rebirth has 1 charge, 2 on a Grove piece (Overabundance)', () => {
    for (const [element, charges] of [
      ['neutral', 1],
      ['tide', 1],
      ['grove', 2],
    ] as const) {
      const r = scenario({
        fen: '2b1k3/8/8/8/8/8/8/4KQ2 b - - 0 1',
        black: { elements: [element], abilities: ['rebirth'] },
      });
      expect(r.engine.remainingCharges(r.state, idAt(r.state, 'c8'), 'rebirth')).toBe(charges);
    }
  });

  it("R-ABIL-005 R-ELEM-003 DD-22 DD-18 rebirth attuned: the Grove piece's owner chooses among its starting square and every empty back-rank square", () => {
    // 1... Nf6-g4 2. Be2xg4. Rank 8 holds a8, e8 and h8; the start square f6 is empty.
    const fen = 'r3k2r/8/5n2/8/8/8/4B3/2K5 b - - 0 1';
    const r = scenario({
      fen,
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['f6g4', 'e2g4'],
      answers: [at('g8')],
    });
    const knight = idAt(r.initial, 'f6');
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('black');
    expect(req?.kind).toBe('square');
    expect(req?.source).toEqual({ ability: 'rebirth', piece: knight, side: 'black' });
    // Mandatory (no Decline), square order from black's side.
    expect(req?.options).toEqual([at('b8'), at('c8'), at('d8'), at('f8'), at('g8'), at('f6')]);
    expect(req?.defaultOption).toBe(0);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'rebirth',
      attuned: true,
    });
    expect(pieceAt(r.state, 'g8')?.id).toBe(knight);
    expect(pieceAt(r.state, 'f6')).toBeUndefined();
    expect(eventsOf(r.events, 'ChargeSpent')[0]).toMatchObject({ remaining: 1 });

    const unanswered = scenario({
      fen,
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['f6g4', 'e2g4'],
    });
    expect(pieceAt(unanswered.state, 'b8')?.id).toBe(knight);
  });

  it("R-ABIL-005 DD-19 INV-03 rebirth attuned never offers a square where the returning piece would check the acting player's ordinary king", () => {
    // White king d6: a black knight on c8 or e8 would give check, so those squares are left out.
    const r = scenario({
      fen: '7k/8/3K1n2/8/8/8/4B3/8 b - - 0 1',
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['f6g4', 'e2g4'],
      answers: [at('d8')],
    });
    const knight = idAt(r.initial, 'f6');
    expect(r.prompts[0]?.options).toEqual([
      at('a8'),
      at('b8'),
      at('d8'),
      at('f8'),
      at('g8'),
      at('f6'),
    ]);
    expect(pieceAt(r.state, 'd8')?.id).toBe(knight);
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 DD-18 DD-22 rebirth attuned: a single available square resolves without a prompt', () => {
    // 1... Ng8-f6 2. Ne4xf6: the only empty back-rank square is the knight's own start g8.
    const r = scenario({
      fen: 'rnbqkbnr/8/8/8/4N3/8/8/4K3 b - - 0 1',
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['g8f6', 'e4f6'],
    });
    const knight = idAt(r.initial, 'g8');
    expect(r.prompts).toHaveLength(0);
    expect(pieceAt(r.state, 'g8')?.id).toBe(knight);
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: knight, square: sq('g8') }),
    ]);
  });

  it('R-ABIL-005 DD-22 rebirth returns the piece with its current type to the starting square of its identity', () => {
    // The e-pawn promotes on e8 and is captured there as a queen; it returns to e7 as a queen.
    const r = scenario({
      fen: 'r7/4P3/8/8/8/8/7k/1K6 w - - 0 1',
      white: { abilities: ['rebirth'] },
      moves: ['e7e8q', 'a8e8'],
    });
    const pawn = idAt(r.initial, 'e7');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'Captured')[0]).toMatchObject({ victim: pawn, victimType: 'queen' });
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'white', square: sq('e7') }),
    ]);
    const back = pieceAt(r.state, 'e7');
    expect(back?.id).toBe(pawn);
    expect(back?.type).toBe('queen');
  });

  it("R-ABIL-005 INV-03 DD-17 rebirth fizzles when the return would leave the acting player's ordinary king in check, and keeps its charge", () => {
    // 1. Ra2-a7 Kb8xa7: a rook back on a2 would check the black king along the a-file.
    const r = scenario({
      fen: '1k6/8/8/8/8/8/R7/7K w - - 0 1',
      white: { abilities: ['rebirth'] },
      moves: ['a2a7', 'b8a7'],
    });
    const rook = idAt(r.initial, 'a2');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'EffectFizzled')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'rebirth', reason: 'inv03' }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toHaveLength(0);
    expect(eventsOf(last, 'ChargeSpent')).toHaveLength(0);
    expect(r.state.pieces[rook]?.square).toBe(-1);
    expect(pieceAt(r.state, 'a2')).toBeUndefined();
    expect(r.state.inCheck).toBeNull();
    expect(r.engine.remainingCharges(r.state, rook, 'rebirth')).toBe(1);
  });

  it('R-ABIL-005 DD-22 rebirth: chain-end returns resolve in the order their triggers resolved', () => {
    // 1... Nf6-d5 2. Bb3xd5 e6xd5 (Riposte, depth 1). Both the black knight and the white bishop
    // carry Rebirth; their starting squares f6 and b3 are empty at chain end.
    const fen = '4k3/8/4pn2/8/8/1B6/8/4K3 b - - 0 1';
    const riposte: ChoiceOption = { kind: 'move', from: sq('e6'), to: sq('d5') };
    const run = (blackSet: string[]) =>
      scenario({
        fen,
        white: { abilities: ['rebirth'] },
        black: { abilities: blackSet },
        moves: ['f6d5', 'b3d5'],
        answers: [riposte],
      });
    const knightFirst = run(['rebirth', 'riposte']);
    const knight = idAt(knightFirst.initial, 'f6');
    const bishop = idAt(knightFirst.initial, 'b3');
    expect(eventsOf(knightFirst.events, 'PieceRevived').map((e) => [e.piece, e.square])).toEqual([
      [knight, sq('f6')],
      [bishop, sq('b3')],
    ]);
    const bishopFirst = run(['riposte', 'rebirth']);
    expect(eventsOf(bishopFirst.events, 'PieceRevived').map((e) => [e.piece, e.square])).toEqual([
      [bishop, sq('b3')],
      [knight, sq('f6')],
    ]);
    for (const r of [knightFirst, bishopFirst]) {
      expect(pieceAt(r.state, 'f6')?.id).toBe(knight);
      expect(pieceAt(r.state, 'b3')?.id).toBe(bishop);
      expect(pieceAt(r.state, 'd5')?.type).toBe('pawn');
    }
  });

  it('R-ABIL-005 R-ELEM-002 rebirth is silenced when an Ember captor beats the Grove victim, and is revealed by name', () => {
    const r = scenario({
      fen: '2b1k3/8/8/8/8/8/8/4KQ2 b - - 0 1',
      white: { elements: ['ember'] },
      black: { elements: ['grove'], abilities: ['rebirth'] },
      moves: ['c8f5', 'f1f5'],
    });
    const bishop = idAt(r.initial, 'c8');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'black', piece: bishop, ability: 'rebirth' }),
    ]);
    expect(eventsOf(last, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'bishop', ability: 'rebirth' },
        cause: 'silenced',
      }),
    );
    expect(eventsOf(last, 'PieceRevived')).toHaveLength(0);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    expect(r.engine.remainingCharges(r.state, bishop, 'rebirth')).toBe(2);
  });

  it('R-ABIL-004 R-ABIL-005 rebirth never triggers on an effect capture', () => {
    // A Rebirth knight takes a Poisoned Meat pawn and is removed by the effect capture; its
    // starting square c3 is empty, so a (wrong) Rebirth trigger would bring it back there.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['rebirth'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: knight, by: 'effect' }),
    );
    expect(
      eventsOf(r.events, 'AbilityTriggered').filter((e) => e.ability === 'rebirth'),
    ).toHaveLength(0);
    expect(eventsOf(r.events, 'PieceRevived')).toHaveLength(0);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
  });

  it('R-ABIL-005 R-RULES-003 rebirth is ineligible on kings: a captured Stalwart king with army-wide Rebirth stays captured', () => {
    const r = scenario({
      fen: '4r2k/8/8/8/4K3/8/8/8 b - - 0 1',
      white: { abilities: ['stalwart', 'rebirth'] },
      moves: ['e8e4'],
    });
    const king = idAt(r.initial, 'e4');
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(r.events, 'PieceRevived')).toHaveLength(0);
    expect(r.state.pieces[king]?.square).toBe(-1);
    expect(r.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
  });
});
