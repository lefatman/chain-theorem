/**
 * Stalwart scenario tests (R-ABIL-005, R-RULES-003, spec 4.3, 5.7): Passive, neutral, king only.
 * The king cannot be checkmated but still triggers the check alert; its owner may leave it in check,
 * move it into attacked squares and castle through or into attacked squares. It keeps Royal
 * Immunity; only a piece capturing it with a move takes it, which ends the battle after the chain.
 * No legal move at all is stalemate.
 *
 * Expected behaviour comes from spec 4.1-4.5, 5.1-5.7, 7.3, 8.2 and DD-25, DD-32, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption, RevealInfo } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const STALWART_REVEAL: RevealInfo = { kind: 'ability', pieceType: 'king', ability: 'stalwart' };

describe('stalwart (R-ABIL-005, R-RULES-003)', () => {
  it('R-RULES-003 R-ABIL-005 DD-32 stalwart: the king may move into an attacked square; the check alert fires and Stalwart is revealed', () => {
    // The black rook a2 controls the second rank.
    const fen = '4k3/8/8/8/8/8/r7/4K3 w - - 0 1';
    const ordinary = scenario({ fen });
    expect(ordinary.engine.legalMoves(ordinary.state, 'white')).not.toContainEqual({
      from: sq('e1'),
      to: sq('e2'),
    });

    const r = scenario({ fen, white: { abilities: ['stalwart'] } });
    expect(r.engine.legalMoves(r.state, 'white')).toContainEqual({
      from: sq('e1'),
      to: sq('e2'),
    });
    const moved = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['e1e2'] });
    expect(pieceAt(moved.state, 'e2')?.type).toBe('king');
    expect(eventsOf(moved.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e2') }),
    ]);
    expect(moved.state.inCheck).toBe('white');
    expect(moved.state.result).toBeNull();
    expect(eventsOf(moved.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
    expect(moved.state.reveals.white.abilities.king).toContain('stalwart');
    expect(
      moved.engine.project(moved.state, 'black').armies.white.revealed.abilities.king,
    ).toContain('stalwart');
  });

  it('R-RULES-003 DD-32 stalwart: its owner may leave the king in check with another move', () => {
    // The white king e1 is in check from the rook e8; h2-h3 ignores it.
    const fen = '4r2k/8/8/8/8/8/7P/4K3 w - - 0 1';
    const ordinary = scenario({ fen });
    expect(ordinary.engine.legalMoves(ordinary.state, 'white')).not.toContainEqual({
      from: sq('h2'),
      to: sq('h3'),
    });
    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['h2h3'] });
    expect(pieceAt(r.state, 'h3')?.type).toBe('pawn');
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e1') }),
    ]);
    expect(r.state.result).toBeNull();
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
  });

  it('R-RULES-003 R-RULES-005 R-ABIL-005 stalwart: a piece capturing the king with a move wins with stalwart_captured', () => {
    const r = scenario({
      fen: '4r2k/8/8/8/8/8/7P/4K3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      moves: ['h2h3', 'e8e1'],
    });
    const king = idAt(r.initial, 'e1');
    const last = r.steps[1]?.events ?? [];
    expect(eventsOf(last, 'Captured')).toEqual([
      expect.objectContaining({ victim: king, victimType: 'king', by: 'move' }),
    ]);
    expect(r.state.pieces[king]?.square).toBe(-1);
    expect(r.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
    expect(last.at(-1)).toMatchObject({
      k: 'BattleEnded',
      result: { winner: 'black', reason: 'stalwart_captured' },
    });
  });

  it("R-RULES-003 DD-25 stalwart: the battle ends only after the capture's reaction chain has resolved", () => {
    // The Stalwart king also carries Poisoned Meat: its retaliation resolves before the result.
    const r = scenario({
      fen: '4r2k/8/8/8/8/8/7P/4K3 w - - 0 1',
      white: { abilities: ['stalwart', 'poisoned_meat'] },
      moves: ['h2h3', 'e8e1'],
    });
    const rook = idAt(r.initial, 'e8');
    const last = r.steps[1]?.events ?? [];
    const kinds = last.map((e) => e.k);
    const iEffect = last.findIndex((e) => e.k === 'Captured' && e.by === 'effect');
    expect(iEffect).toBeGreaterThan(kinds.indexOf('AbilityTriggered'));
    expect((last[iEffect] as { victim?: number }).victim).toBe(rook);
    expect(kinds.indexOf('TurnPassed')).toBeGreaterThan(iEffect);
    expect(kinds.at(-1)).toBe('BattleEnded');
    expect(kinds.filter((k) => k === 'BattleEnded')).toHaveLength(1);
    expect(r.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
  });

  it('R-RULES-003 stalwart: castling through and into attacked squares is legal', () => {
    // Black rooks on f8 and g8 attack f1 and g1.
    const fen = 'k4rr1/8/8/8/8/8/8/4K2R w K - 0 1';
    const ordinary = scenario({ fen });
    expect(ordinary.engine.legalMoves(ordinary.state, 'white')).not.toContainEqual({
      from: sq('e1'),
      to: sq('g1'),
    });
    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['e1g1'] });
    expect(eventsOf(r.events, 'MoveMade')[0]).toMatchObject({ castle: 'K' });
    expect(pieceAt(r.state, 'g1')?.type).toBe('king');
    expect(pieceAt(r.state, 'f1')?.type).toBe('rook');
    expect(r.state.castling & 3).toBe(0);
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('g1') }),
    ]);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
  });

  it('R-RULES-003 R-RULES-005 DD-32 stalwart: a would-be checkmate is survived, the check alert fires and Stalwart is revealed', () => {
    // Back-rank "mate" Ra8-a1 against the king g1 behind its own pawns.
    const fen = 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1';
    const ordinary = scenario({ fen, moves: ['a8a1'] });
    expect(ordinary.state.result).toEqual({ winner: 'black', reason: 'checkmate' });

    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['a8a1'] });
    expect(r.state.result).toBeNull();
    expect(eventsOf(r.events, 'BattleEnded')).toHaveLength(0);
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('g1') }),
    ]);
    expect(r.state.inCheck).toBe('white');
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
    expect(r.engine.legalMoves(r.state, 'white').length).toBeGreaterThan(0);
  });

  it('R-RULES-003 R-RULES-005 stalwart: with no legal move at all it is stalemate, even while in check', () => {
    // Every white piece is walled in; Nd4-b3 checks the king a1 and leaves white without a move.
    const fen = '7k/8/8/1p6/1Ppn4/2Pp4/NPRP4/KBB5 b - - 0 1';
    const ordinary = scenario({ fen, moves: ['d4b3'] });
    expect(ordinary.state.result).toEqual({ winner: 'black', reason: 'checkmate' });

    const r = scenario({ fen, white: { abilities: ['stalwart'] }, moves: ['d4b3'] });
    expect(r.engine.position(r.state).legal(0)).toHaveLength(0);
    expect(r.state.result).toEqual({ winner: null, reason: 'stalemate' });
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('a1') }),
    ]);
    expect(r.events.at(-1)).toMatchObject({
      k: 'BattleEnded',
      result: { winner: null, reason: 'stalemate' },
    });
  });

  it('R-RULES-003 DD-32 stalwart: being put in check fires the alert but reveals nothing (an ordinary king could be in check too)', () => {
    const r = scenario({
      fen: '7k/8/8/8/8/8/r7/4K3 b - - 0 1',
      white: { abilities: ['stalwart'] },
      moves: ['a2a1'],
    });
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e1') }),
    ]);
    expect(r.state.inCheck).toBe('white');
    expect(eventsOf(r.events, 'Revealed')).toHaveLength(0);
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
  });

  it('R-RULES-003 DD-32 stalwart is revealed when the king is captured by a piece', () => {
    // The white Stalwart king stands in check on e4 with black to move; Stalwart is not yet known.
    const r = scenario({
      fen: '4r2k/8/8/8/4K3/8/8/8 b - - 0 1',
      white: { abilities: ['stalwart'] },
      moves: ['e8e4'],
    });
    expect(r.initial.reveals.white.abilities.king ?? []).not.toContain('stalwart');
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL }),
    );
    expect(r.state.reveals.white.abilities.king).toContain('stalwart');
    expect(r.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
  });

  it('R-RULES-004 E3 DD-32 stalwart keeps Royal Immunity: Poisoned Meat retaliation fizzles and an ordinary-legal capture does not reveal Stalwart', () => {
    const r = scenario({
      fen: '4k3/8/8/8/3p4/3K4/8/8 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['d3d4'],
    });
    const king = idAt(r.initial, 'd3');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'royal_immunity' }),
    ]);
    expect(pieceAt(r.state, 'd4')?.id).toBe(king);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(r.state.result).toBeNull();
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
  });

  it('R-RULES-003 DD-32 stalwart is not revealed by a king move that an ordinary king could make', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      moves: ['e1d1'],
    });
    expect(eventsOf(r.events, 'Revealed')).toHaveLength(0);
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
    const pub = r.engine.project(r.state, 'black');
    expect(pub.armies.white.revealed.abilities.king ?? []).not.toContain('stalwart');
    expect(JSON.stringify(r.engine.projectEvents(r.state, r.events, 'black'))).not.toContain(
      'stalwart',
    );
  });

  it('INV-03 DD-32 stalwart: an effect that INV-03 would fizzle for an ordinary king resolves against a Stalwart king and reveals it', () => {
    // E5: the rook e2 shields the king e1 from the queen e8 and takes a Poisoned Meat pawn on e5.
    const fen = 'k3q3/8/8/4p3/8/8/4R3/4K3 w - - 0 1';
    const ordinary = scenario({
      fen,
      black: { abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    expect(pieceAt(ordinary.state, 'e5')?.type).toBe('rook');
    expect(eventsOf(ordinary.events, 'EffectFizzled')[0]).toMatchObject({ reason: 'inv03' });

    const r = scenario({
      fen,
      white: { abilities: ['stalwart'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    const rook = idAt(r.initial, 'e2');
    expect(eventsOf(r.events, 'EffectFizzled')).toHaveLength(0);
    expect(r.state.pieces[rook]?.square).toBe(-1);
    expect(pieceAt(r.state, 'e5')).toBeUndefined();
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
    expect(eventsOf(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'white', square: sq('e1') }),
    ]);
    expect(r.state.result).toBeNull();
  });

  it('R-RULES-003 R-ABIL-005 7.3 stalwart is ineligible on non-kings: on the pawn set only, the king is ordinary and can be checkmated', () => {
    const r = scenario({
      fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1',
      white: { sets: [['stalwart'], [], [], [], [], []] },
      moves: ['a8a1'],
    });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'checkmate' });
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
  });

  it('R-RULES-003 R-RULES-004 stalwart gives non-king pieces no Royal Immunity: an army-wide Stalwart knight is still effect-captured', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [idAt(r.initial, 'd5'), 'move'],
      [knight, 'effect'],
    ]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
  });

  it('R-RULES-003 R-ABIL-005 stalwart: a Riposte bonus capture of the Stalwart king ends the battle after the chain', () => {
    // The Stalwart king e4 takes the Riposte pawn d5 although the rook d8 guards it.
    const recapture: ChoiceOption = { kind: 'move', from: sq('d8'), to: sq('d5') };
    const r = scenario({
      fen: '3rk3/8/8/3p4/4K3/8/8/8 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['riposte'] },
      moves: ['e4d5'],
      answers: [recapture],
    });
    const king = idAt(r.initial, 'e4');
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, recapture]);
    expect(eventsOf(r.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: king, victimType: 'king', by: 'move', depth: 1 }),
    );
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: STALWART_REVEAL, cause: 'observed' }),
    );
    expect(r.state.result).toEqual({ winner: 'black', reason: 'stalwart_captured' });
    expect(r.events.at(-1)?.k).toBe('BattleEnded');
    expect(pieceAt(r.state, 'd5')?.type).toBe('rook');
  });
});
