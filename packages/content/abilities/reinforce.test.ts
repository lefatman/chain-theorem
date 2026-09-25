/**
 * Reinforce scenario tests (R-ABIL-005, spec 5.7): Captures, Grove, all pieces, revive, 1 charge.
 * If the victim was not a pawn, revive your most recently captured pawn on its starting square.
 * Attuned (Grove bearer): triggers on any victim.
 *
 * Expected behaviour comes from spec 5.1-5.7, 6.1 (Overabundance), 6.2, 6.3, 8.2 and DD-17, not
 * from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;

// 1. e2-e4 d5xe4 (a white pawn is captured off its start square), 2. Nd1xc3 (a non-pawn victim),
// then ...Ke8-f8 and Nc3xb5 (another non-pawn victim).
const FEN = '4k3/8/8/1b1p4/8/2r5/4P3/3NK3 w - - 0 1';
const PREFIX = ['e2e4', 'd5e4', 'd1c3'];

describe('reinforce (R-ABIL-005)', () => {
  it('R-ABIL-005 R-ABIL-004 reinforce: capturing a non-pawn revives your most recently captured pawn on its starting square, keeping its identity', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['reinforce'] }, moves: PREFIX });
    const pawn = idAt(r.initial, 'e2');
    const knight = idAt(r.initial, 'd1');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered')).toEqual([
      expect.objectContaining({
        side: 'white',
        piece: knight,
        ability: 'reinforce',
        category: 'CAPTURES',
        attuned: false,
      }),
    ]);
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({
        piece: pawn,
        side: 'white',
        square: sq('e2'),
        source: { kind: 'ability', id: 'reinforce', piece: knight, side: 'white' },
      }),
    ]);
    const revived = pieceAt(r.state, 'e2');
    expect(revived?.id).toBe(pawn);
    expect(revived?.type).toBe('pawn');
    expect(revived?.side).toBe('white');
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(r.prompts).toHaveLength(0);
    // Revived after the capture and before the turn passes.
    const kinds = last.map((e) => e.k);
    expect(kinds.indexOf('PieceRevived')).toBeGreaterThan(kinds.indexOf('MoveMade'));
    expect(kinds.indexOf('PieceRevived')).toBeLessThan(kinds.indexOf('TurnPassed'));
  });

  it('R-ABIL-005 DD-17 reinforce has one charge: it is spent on the revival and the ability then no longer triggers', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['reinforce'] },
      moves: [...PREFIX, 'e8f8', 'c3b5'],
    });
    const knight = idAt(r.initial, 'd1');
    expect(eventsOf(r.steps[2]?.events ?? [], 'ChargeSpent')).toEqual([
      expect.objectContaining({ side: 'white', piece: knight, ability: 'reinforce', remaining: 0 }),
    ]);
    expect(r.state.usage[`${knight}:reinforce`]).toBe(1);
    const last = r.steps[4]?.events ?? [];
    expect(eventsOf(last, 'Captured')).toHaveLength(1);
    expect(eventsOf(last, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(last, 'EffectFizzled')).toHaveLength(0);
    expect(eventsOf(last, 'PieceRevived')).toHaveLength(0);
    expect(r.engine.remainingCharges(r.state, knight, 'reinforce')).toBe(0);
  });

  it('R-ABIL-005 reinforce base: a pawn victim does not trigger it', () => {
    // 1. e2-e4 d5xe4 2. Nc3xe4: the victim is a pawn.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/4P3/4K3 w - - 0 1',
      white: { abilities: ['reinforce'] },
      moves: ['e2e4', 'd5e4', 'c3e4'],
    });
    const pawn = idAt(r.initial, 'e2');
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(r.events, 'PieceRevived')).toHaveLength(0);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(pieceAt(r.state, 'e2')).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-003 R-ELEM-007 reinforce attuned: a Grove bearer triggers on a pawn victim and revives a friendly pawn, not the enemy pawn just taken', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/4P3/4K3 w - - 0 1',
      white: { elements: ['grove'], abilities: ['reinforce'] },
      moves: ['e2e4', 'd5e4', 'c3e4'],
    });
    const pawn = idAt(r.initial, 'e2');
    const knight = idAt(r.initial, 'c3');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'reinforce',
      attuned: true,
    });
    expect(eventsOf(last, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'white', square: sq('e2') }),
    ]);
    expect(pieceAt(r.state, 'e2')?.id).toBe(pawn);
    expect(pieceAt(r.state, 'e4')?.id).toBe(knight);
    // Overabundance: 2 charges on a Grove piece, one left.
    expect(eventsOf(last, 'ChargeSpent')[0]).toMatchObject({ ability: 'reinforce', remaining: 1 });
  });

  it('R-ABIL-005 R-ELEM-007 reinforce has 1 charge, 2 on a Grove piece', () => {
    for (const [element, charges] of [
      ['neutral', 1],
      ['ember', 1],
      ['grove', 2],
    ] as const) {
      const r = scenario({ fen: FEN, white: { elements: [element], abilities: ['reinforce'] } });
      expect(r.engine.remainingCharges(r.state, idAt(r.state, 'd1'), 'reinforce')).toBe(charges);
    }
  });

  it('R-ABIL-005 DD-17 reinforce fizzles when the starting square is occupied, keeps its charge, and uses it on a later capture', () => {
    // 1... Bxb2 (the b-pawn is taken on its start square) 2. Nd1xb2 (b2 is now the knight's)
    // 2... Ke8-f8 3. Nb2xd3 (b2 is empty again).
    const r = scenario({
      fen: '4k3/8/8/4b3/8/3r4/1P6/3NK3 b - - 0 1',
      white: { abilities: ['reinforce'] },
      moves: ['e5b2', 'd1b2', 'e8f8', 'b2d3'],
    });
    const pawn = idAt(r.initial, 'b2');
    const knight = idAt(r.initial, 'd1');
    const second = r.steps[1]?.events ?? [];
    expect(eventsOf(second, 'AbilityTriggered')).toHaveLength(1);
    expect(eventsOf(second, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'reinforce', reason: 'occupied', side: 'white' }),
    ]);
    expect(eventsOf(second, 'PieceRevived')).toHaveLength(0);
    expect(eventsOf(second, 'ChargeSpent')).toHaveLength(0);

    const fourth = r.steps[3]?.events ?? [];
    expect(eventsOf(fourth, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: pawn, square: sq('b2') }),
    ]);
    expect(eventsOf(fourth, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'reinforce', remaining: 0 }),
    ]);
    expect(pieceAt(r.state, 'b2')?.id).toBe(pawn);
    expect(pieceAt(r.state, 'd3')?.id).toBe(knight);
  });

  it('R-ABIL-005 DD-17 reinforce with no friendly pawn captured fizzles and spends nothing', () => {
    const r = scenario({
      fen: '4k3/8/8/3b4/8/2N5/4P3/4K3 w - - 0 1',
      white: { abilities: ['reinforce'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'reinforce', side: 'white' }),
    ]);
    expect(eventsOf(r.events, 'PieceRevived')).toHaveLength(0);
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(r.engine.remainingCharges(r.state, knight, 'reinforce')).toBe(1);
  });

  it('R-ABIL-005 reinforce picks the most recently captured friendly pawn', () => {
    // 1. a2-a4 b5xa4 2. h2-h4 g5xh4 3. Nc3xd5: the h-pawn fell last.
    const r = scenario({
      fen: '4k3/8/8/1p1b2p1/8/2N5/P6P/4K3 w - - 0 1',
      white: { abilities: ['reinforce'] },
      moves: ['a2a4', 'b5a4', 'h2h4', 'g5h4', 'c3d5'],
    });
    const aPawn = idAt(r.initial, 'a2');
    const hPawn = idAt(r.initial, 'h2');
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: hPawn, square: sq('h2') }),
    ]);
    expect(pieceAt(r.state, 'h2')?.id).toBe(hPawn);
    expect(r.state.pieces[aPawn]?.square).toBe(-1);
    expect(pieceAt(r.state, 'a2')).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-002 DD-17 reinforce is silenced when an Ember victim beats the Grove captor', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['grove'], abilities: ['reinforce'] },
      black: { elements: ['ember'] },
      moves: PREFIX,
    });
    const knight = idAt(r.initial, 'd1');
    const pawn = idAt(r.initial, 'e2');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', piece: knight, ability: 'reinforce' }),
    ]);
    expect(eventsOf(last, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'knight', ability: 'reinforce' },
        cause: 'silenced',
      }),
    );
    expect(eventsOf(last, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(last, 'PieceRevived')).toHaveLength(0);
    expect(eventsOf(last, 'ChargeSpent')).toHaveLength(0);
    expect(r.state.pieces[pawn]?.square).toBe(-1);
    expect(r.engine.remainingCharges(r.state, knight, 'reinforce')).toBe(2);
  });

  it('R-ABIL-005 R-INFO-002 reinforce activation is revealed with the bearer type and the revival is shown to the opponent', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['reinforce'] }, moves: PREFIX });
    const last = r.steps[2]?.events ?? [];
    expect(r.state.reveals.white.abilities.knight).toContain('reinforce');
    const pub = r.engine.projectEvents(r.state, last, 'black');
    expect(pub.find((e) => e.k === 'AbilityTriggered')).toMatchObject({ ability: 'reinforce' });
    expect(pub.find((e) => e.k === 'PieceRevived')).toMatchObject({
      square: sq('e2'),
      source: { kind: 'ability', id: 'reinforce' },
    });
  });
});
