/**
 * Riposte scenario tests (R-ABIL-005, spec 5.7, E6): Captured, Ember, all pieces, replay. Bonus
 * action for the owner: capture the captor with any piece that legally can (a nested pipeline).
 * Attuned (Ember bearer): if none can and the captor is a pawn, effect-capture it.
 *
 * Expected behaviour comes from spec 4.1 (INV-01, INV-03), 5.1-5.7, 6.2, 6.3, 8.2 and DD-12, DD-18,
 * DD-21, DD-31, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const mv = (from: string, to: string): ChoiceOption => ({
  kind: 'move',
  from: sq(from),
  to: sq(to),
});

// E6: bishop b3 takes a Riposte knight on d5; the rook d8 and the pawn e6 can capture on d5.
const E6_FEN = '3rk3/8/4p3/3n4/8/1B6/8/4K3 w - - 0 1';

describe('riposte (R-ABIL-005)', () => {
  it("R-ABIL-005 E6 DD-18 riposte prompts the victim's owner with Decline first and every legal capturer of the captor", () => {
    const r = scenario({
      fen: E6_FEN,
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [0],
    });
    const knight = idAt(r.initial, 'd5');
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('black');
    expect(req?.kind).toBe('bonusMove');
    expect(req?.source).toEqual({ ability: 'riposte', piece: knight, side: 'black' });
    expect(req?.defaultOption).toBe(0);
    // Square order from black's side: d8 before e6.
    expect(req?.options).toEqual([{ kind: 'decline' }, mv('d8', 'd5'), mv('e6', 'd5')]);
    expect(r.state.reveals.black.abilities.knight).toContain('riposte');
  });

  it('R-ABIL-005 R-ABIL-003 E6 riposte: the chosen capture runs a nested pipeline at depth 1 inside the same action', () => {
    const r = scenario({
      fen: E6_FEN,
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const bishop = idAt(r.initial, 'b3');
    const pawn = idAt(r.initial, 'e6');
    const nested = r.events.filter((e) => e.depth === 1);
    expect(nested.map((e) => e.k)).toEqual(['Captured', 'MoveMade']);
    expect(nested[0]).toMatchObject({
      k: 'Captured',
      victim: bishop,
      by: 'move',
      captor: pawn,
      square: sq('d5'),
    });
    expect(nested[1]).toMatchObject({
      k: 'MoveMade',
      side: 'black',
      piece: pawn,
      from: sq('e6'),
      to: sq('d5'),
      capture: true,
      bonus: true,
    });
    expect(pieceAt(r.state, 'd5')?.id).toBe(pawn);
    expect(r.state.pieces[bishop]?.square).toBe(-1);
    // Still one action: the turn passes to black once, after the nested capture.
    expect(eventsOf(r.events, 'TurnPassed')).toEqual([
      expect.objectContaining({ side: 'black', ply: 1, depth: 0 }),
    ]);
    expect(r.state.turn).toBe('black');
  });

  it('R-ABIL-005 DD-18 riposte: Decline is the default when the owner does not answer, and nothing is captured', () => {
    const r = scenario({ fen: E6_FEN, black: { abilities: ['riposte'] }, moves: ['b3d5'] });
    const bishop = idAt(r.initial, 'b3');
    expect(r.prompts).toHaveLength(1);
    expect(eventsOf(r.events, 'ChoiceMade')[0]?.option).toEqual({ kind: 'decline' });
    expect(pieceAt(r.state, 'd5')?.id).toBe(bishop);
    expect(r.events.filter((e) => e.depth > 0)).toHaveLength(0);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
  });

  it("R-ABIL-005 DD-21 INV-03 riposte never offers a capture that would leave the acting player's ordinary king in check", () => {
    // The white king stands on d1: Rd8xd5 would check it along the d-file; e6xd5 would not.
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/8/1B6/8/3K4 w - - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
    });
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('e6', 'd5')]);
  });

  it('R-ABIL-005 DD-21 riposte fizzles without a prompt when the only capture would check the acting king', () => {
    const r = scenario({
      fen: '3rk3/8/8/3n4/8/1B6/8/3K4 w - - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
    });
    const bishop = idAt(r.initial, 'b3');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'EffectFizzled')).toContainEqual(
      expect.objectContaining({ ability: 'riposte', side: 'black' }),
    );
    expect(pieceAt(r.state, 'd5')?.id).toBe(bishop);
    expect(pieceAt(r.state, 'd8')?.type).toBe('rook');
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 DD-21 riposte: the capture must be legal for the riposting side, so a pinned piece is not offered', () => {
    // The pawn e6 is pinned to the black king e8 by the white rook e2.
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/8/1B6/4R3/K7 w - - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
    });
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('d8', 'd5')]);
  });

  it('INV-01 DD-12 R-ABIL-005 riposte triggered inside the nested capture fizzles with bonus_in_bonus', () => {
    // Both armies carry Riposte. Black recaptures the bishop at depth 1; the bishop's own Riposte
    // then triggers but may not grant a second bonus action (white's rook d1 could otherwise reply).
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/8/1B6/8/3RK3 w - - 0 1',
      white: { abilities: ['riposte'] },
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const bishop = idAt(r.initial, 'b3');
    const pawn = idAt(r.initial, 'e6');
    expect(r.prompts.map((p) => p.chooser)).toEqual(['black']);
    const fizzled = eventsOf(r.events, 'EffectFizzled').filter((e) => e.ability === 'riposte');
    expect(fizzled).toEqual([
      expect.objectContaining({
        side: 'white',
        piece: bishop,
        reason: 'bonus_in_bonus',
        depth: 1,
      }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(pawn);
    expect(pieceAt(r.state, 'd1')?.type).toBe('rook');
    expect(r.events.filter((e) => e.depth > 1)).toHaveLength(0);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toHaveLength(1);
  });

  it("R-ABIL-003 R-ABIL-005 riposte: the nested capture triggers the original captor's Captured abilities at depth 1", () => {
    // The white bishop carries Poisoned Meat: black's riposting pawn is removed in the nested chain.
    const r = scenario({
      fen: E6_FEN,
      white: { abilities: ['poisoned_meat'] },
      black: { abilities: ['riposte'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const bishop = idAt(r.initial, 'b3');
    const pawn = idAt(r.initial, 'e6');
    const nested = r.events.filter((e) => e.depth === 1);
    expect(nested.map((e) => e.k)).toEqual(
      expect.arrayContaining(['Captured', 'MoveMade', 'AbilityTriggered']),
    );
    expect(eventsOf(nested, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'white', piece: bishop, ability: 'poisoned_meat' }),
    ]);
    expect(eventsOf(nested, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [bishop, 'move'],
      [pawn, 'effect'],
    ]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-003 riposte attuned: when nobody can capture a pawn captor, the Ember victim effect-captures it', () => {
    const r = scenario({
      fen: '7k/8/8/3n4/4P3/8/8/4K3 w - - 0 1',
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['e4d5'],
    });
    const knight = idAt(r.initial, 'd5');
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'black', piece: knight, ability: 'riposte', attuned: true }),
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [knight, 'move'],
      [pawn, 'effect'],
    ]);
    expect(eventsOf(r.events, 'Captured')[1]?.source).toEqual({
      kind: 'ability',
      id: 'riposte',
      piece: knight,
      side: 'black',
    });
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-005 DD-21 riposte attuned: the fallback applies when the only capture would check the acting king', () => {
    // White king e3 is in check from the knight d5; e4xd5 removes it. Nf6xd5 would give check
    // again, so no riposting capture exists and the pawn captor is effect-captured instead.
    const r = scenario({
      fen: '7k/8/5n2/3n4/4P3/4K3/8/8 w - - 0 1',
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['e4d5'],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [idAt(r.initial, 'd5'), 'move'],
      [pawn, 'effect'],
    ]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'f6')?.type).toBe('knight');
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 riposte attuned: no fallback when the captor is not a pawn', () => {
    const r = scenario({
      fen: '7k/8/8/3n4/8/2N5/8/4K3 w - - 0 1',
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });

  it('R-ABIL-005 riposte attuned: no fallback when a capturer exists but the owner declines', () => {
    const r = scenario({
      fen: '7k/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1',
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['e4d5'],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('e6', 'd5')]);
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    expect(pieceAt(r.state, 'd5')?.id).toBe(pawn);
  });

  it('R-ABIL-005 DD-31 riposte: the bonus capture is a real move and updates castling rights', () => {
    // Bc1xh6 takes a Riposte knight; the rook h8 recaptures, so black loses the king-side right.
    const r = scenario({
      fen: '4k2r/8/7n/8/8/8/8/2B1K3 w k - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['c1h6'],
      answers: [mv('h8', 'h6')],
    });
    expect(r.initial.castling & 4).toBe(4);
    expect(pieceAt(r.state, 'h6')?.type).toBe('rook');
    expect(r.state.castling & 4).toBe(0);
    expect(r.engine.toFen(r.state).split(' ')[2]).toBe('-');
    expect(r.state.halfmove).toBe(0);
    expect(r.engine.legalMoves(r.state, 'black')).not.toContainEqual({
      from: sq('e8'),
      to: sq('g8'),
    });
  });

  it('R-ABIL-005 DD-31 riposte: a riposting pawn capture onto the last rank offers each promotion piece as its own option', () => {
    // Ne3xd1 takes a Riposte rook; the black pawn c2 recaptures on d1 and promotes.
    const r = scenario({
      fen: 'k7/8/8/8/8/4N2K/2p5/3r4 w - - 0 1',
      black: { abilities: ['riposte'] },
      moves: ['e3d1'],
      answers: [{ kind: 'move', from: sq('c2'), to: sq('d1'), promotion: 'knight' }],
    });
    const pawn = idAt(r.initial, 'c2');
    const options = r.prompts[0]?.options ?? [];
    expect(options[0]).toEqual({ kind: 'decline' });
    expect(options.slice(1)).toHaveLength(4);
    expect(options.slice(1)).toEqual(
      expect.arrayContaining(
        (['queen', 'rook', 'bishop', 'knight'] as const).map((promotion) => ({
          kind: 'move',
          from: sq('c2'),
          to: sq('d1'),
          promotion,
        })),
      ),
    );
    const piece = pieceAt(r.state, 'd1');
    expect(piece?.id).toBe(pawn);
    expect(piece?.type).toBe('knight');
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'black', to: 'knight', depth: 1 }),
    ]);
  });

  it("R-ABIL-003 R-ABIL-005 riposte: the riposting piece's own Captures abilities fire in the nested pipeline", () => {
    // Black carries Riposte and Cleave: the pawn e6 recaptures on d5 (depth 1) and cleaves the
    // white pawn e4, diagonally adjacent to d5.
    const r = scenario({
      fen: '3rk3/8/4p3/3n4/4P3/1B6/8/4K3 w - - 0 1',
      black: { abilities: ['riposte', 'cleave'] },
      moves: ['b3d5'],
      answers: [mv('e6', 'd5')],
    });
    const riposter = idAt(r.initial, 'e6');
    const whitePawn = idAt(r.initial, 'e4');
    expect(eventsOf(r.events, 'AbilityTriggered')).toContainEqual(
      expect.objectContaining({ side: 'black', piece: riposter, ability: 'cleave', depth: 1 }),
    );
    expect(eventsOf(r.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: whitePawn, by: 'effect', depth: 1 }),
    );
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')?.id).toBe(riposter);
  });

  it('R-ABIL-005 R-ELEM-002 riposte is silenced when a Tide captor beats the Ember victim, and is revealed by name', () => {
    const r = scenario({
      fen: E6_FEN,
      white: { elements: ['tide'] },
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['b3d5'],
    });
    const knight = idAt(r.initial, 'd5');
    const bishop = idAt(r.initial, 'b3');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({
        side: 'black',
        piece: knight,
        ability: 'riposte',
        category: 'CAPTURED',
        by: bishop,
      }),
    ]);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'knight', ability: 'riposte' },
        cause: 'silenced',
      }),
    );
    expect(pieceAt(r.state, 'd5')?.id).toBe(bishop);
  });
});
