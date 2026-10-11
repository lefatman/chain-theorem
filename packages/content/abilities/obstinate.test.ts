/**
 * Obstinate (5.8): Passive, neutral, pawn/knight/bishop/rook. "Cannot be move-captured by a piece of higher rank; kings
 * ignore it. Effect captures are unaffected. Costs two ability slots. Revealed the first time it
 * changes which captures are legal."
 *
 * Expected behaviour comes from spec 5.1 (rank, DD-97), 5.6 (captureFilter), 8.2 (passive reveal,
 * DD-32, DD-99), DD-102 (Stalwart bypass), R-RULES-004 and the B5 brief (2026-10-11: two slots,
 * kings ignore it).
 */
import { describe, expect, it } from 'vitest';
import { type Engine, type GameState, type Side, moveToUci } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
const legal = (engine: Engine, state: GameState, side: Side): string[] =>
  engine.legalMoves(state, side).map(moveToUci);

describe('Obstinate (5.8, DD-97, DD-99)', () => {
  it('R-ABIL-005 module data: Passive, neutral, pawn to rook (DD-116), level 9, 2 slots (B5), a captureFilter hook', () => {
    const def = abilityById.get('obstinate');
    expect(def).toMatchObject({
      category: 'PASSIVE',
      affinity: 'neutral',
      eligible: ['pawn', 'knight', 'bishop', 'rook'],
      tags: [],
      minLevel: 9,
      slotCost: 2,
    });
    expect(def?.hooks?.moveFilter?.captureFilter).toBeTypeOf('function');
    expect(def?.attuned).toBeUndefined();
  });

  it('R-RULES-001 DD-97 a queen (rank 4) cannot move-capture an Obstinate knight (rank 2); a knight can', () => {
    // d1 Q, e1 K, c3 N; black: d5 n (Obstinate), e8 k.
    const { engine, state } = setup({
      fen: '4k3/8/8/3n4/8/2N5/8/3QK3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['obstinate'] },
    });
    const moves = legal(engine, state, 'white');
    expect(moves).not.toContain('d1d5');
    expect(moves).toContain('c3d5');
    // Control: without Obstinate the queen takes.
    const plain = setup({
      fen: '4k3/8/8/3n4/8/2N5/8/3QK3 w - - 0 1',
      black: { elements: ['neutral'] },
    });
    expect(legal(plain.engine, plain.state, 'white')).toContain('d1d5');
  });

  it('R-RULES-001 DD-97 a king may capture an Obstinate piece: the king is not among the restricted attackers, a queen still is', () => {
    // d1 Q, e1 K; black: d2 n (Obstinate, adjacent to both), e8 k. The knight attacks neither.
    const fen = '4k3/8/8/8/8/8/3n4/3QK3 w - - 0 1';
    const { engine, state } = setup({ fen, black: { abilities: ['obstinate'] } });
    const moves = legal(engine, state, 'white');
    expect(moves).toContain('e1d2');
    expect(moves).not.toContain('d1d2');
    // Control: without Obstinate both take.
    const plain = legal(setup({ fen }).engine, setup({ fen }).state, 'white');
    expect(plain).toContain('e1d2');
    expect(plain).toContain('d1d2');
  });

  it('DD-97 equal rank is not higher: a bishop may take an Obstinate knight, a rook may not', () => {
    const fen = '4k3/8/8/3n4/8/1B6/3R4/4K3 w - - 0 1';
    const { engine, state } = setup({ fen, black: { abilities: ['obstinate'] } });
    const moves = legal(engine, state, 'white');
    expect(moves).toContain('b3d5');
    expect(moves).not.toContain('d2d5');
  });

  it('DD-97 an Obstinate pawn falls only to a pawn: queen and knight captures are removed, a pawn capture stays', () => {
    // d1 Q, e1 K, c3 N, e4 P; black: d5 p (Obstinate), e8 k.
    const { engine, state } = setup({
      fen: '4k3/8/8/3p4/4P3/2N5/8/3QK3 w - - 0 1',
      black: { abilities: ['obstinate'] },
    });
    const moves = legal(engine, state, 'white');
    expect(moves).not.toContain('d1d5');
    expect(moves).not.toContain('c3d5');
    expect(moves).toContain('e4d5');
  });

  it('R-INFO-002 DD-32 DD-99 Obstinate is revealed at Settle the first time it removes a legal capture, on the piece type it protects', () => {
    // Black to move first; after the quiet move the queen's capture is missing from White's list.
    const r = scenario({
      fen: '4k3/p7/8/3n4/8/2N5/8/3QK3 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['obstinate'] },
      moves: ['a7a6'],
    });
    expect(eventsOf(r.events, 'Revealed')).toEqual([
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'knight', ability: 'obstinate' },
        cause: 'observed',
      }),
    ]);
    expect(r.state.reveals.black.abilities.knight).toEqual(['obstinate']);
    expect(legal(r.engine, r.state, 'white')).not.toContain('d1d5');
  });

  it('R-INFO-002 DD-32 nothing is revealed while the restriction changes nothing (no higher-rank attacker)', () => {
    const r = scenario({
      fen: '4k3/p7/8/3n4/8/2N5/8/4K3 b - - 0 1',
      black: { abilities: ['obstinate'] },
      moves: ['a7a6'],
    });
    expect(eventsOf(r.events, 'Revealed')).toEqual([]);
    expect(legal(r.engine, r.state, 'white')).toContain('c3d5');
  });

  it('R-RULES-004 R-ABIL-002 effect captures ignore Obstinate: Cleave (from a knight, rank 2) removes an Obstinate pawn', () => {
    // The white knight (Cleave) takes the knight d5; the Obstinate pawn e6, diagonal to the landing
    // square, is effect-captured although the knight outranks it.
    const r = scenario({
      fen: '4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['cleave'] },
      black: { elements: ['neutral'], abilities: ['obstinate'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.square, e.by])).toEqual([
      [sq('d5'), 'move'],
      [sq('e6'), 'effect'],
    ]);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
  });

  it('DD-102 a Stalwart attacker ignores Obstinate: a Stalwart queen takes the Obstinate knight', () => {
    const { engine, state } = setup({
      fen: '4k3/8/8/3n4/8/2N5/8/3QK3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['obstinate'] },
    });
    expect(legal(engine, state, 'white')).toContain('d1d5');
  });

  it('INV-01 DD-99 a Riposte recapture that Obstinate forbids is not offered, and the denial reveals Obstinate', () => {
    // A white pawn (Obstinate, rank 1) takes the Riposte pawn d5; the black rook d8 (rank 3) may not
    // recapture, so Riposte has no legal recapture and fizzles instead of prompting.
    const r = scenario({
      fen: '3rk3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['obstinate'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['e4d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'riposte', reason: 'no_target' }),
    ]);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'pawn', ability: 'obstinate' },
        cause: 'observed',
      }),
    );
    expect(r.state.pieces[idAt(r.initial, 'e4')]?.square).toBe(sq('d5'));
  });
});
