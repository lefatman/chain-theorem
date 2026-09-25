/**
 * Momentum scenario tests (R-ABIL-005, spec 5.7): Captures, Ember, non-king, replay, 2 charges.
 * Bonus action: this piece makes one non-capturing move. Attuned (Ember bearer): the bonus move may
 * be made by any friendly pawn instead.
 *
 * Expected behaviour comes from spec 4.1 (INV-01, INV-03), 5.1-5.7, 6.1 (Overabundance), 6.2, 6.3,
 * 8.2 and DD-12, DD-17, DD-18, DD-31, not from the engine's current output.
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

// Knight c3 takes d5. A white pawn b4 and a black pawn f6 sit on knight squares of d5; a white pawn
// h2 shows that other pieces may not make the (non-attuned) bonus move.
const BASE_FEN = '4k3/8/5p2/3p4/1P6/2N5/7P/4K3 w - - 0 1';

describe('momentum (R-ABIL-005)', () => {
  it('R-ABIL-005 DD-18 momentum offers Decline first plus only the bearer’s non-capturing moves, and the chosen bonus move is made at depth 1', () => {
    const r = scenario({
      fen: BASE_FEN,
      white: { abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [mv('d5', 'e3')],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('white');
    expect(req?.kind).toBe('bonusMove');
    expect(req?.source).toEqual({ ability: 'momentum', piece: knight, side: 'white' });
    expect(req?.options[0]).toEqual({ kind: 'decline' });
    expect(req?.defaultOption).toBe(0);
    // Knight moves from d5, square order; b4 (own piece) and f6 (a capture) are excluded, and the
    // h2 pawn is not a mover for the base version.
    expect(req?.options.slice(1)).toEqual([
      mv('d5', 'c3'),
      mv('d5', 'e3'),
      mv('d5', 'f4'),
      mv('d5', 'b6'),
      mv('d5', 'c7'),
      mv('d5', 'e7'),
    ]);

    expect(pieceAt(r.state, 'e3')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    const moves = eventsOf(r.events, 'MoveMade');
    expect(moves).toHaveLength(2);
    expect(moves[1]).toMatchObject({
      side: 'white',
      piece: knight,
      from: sq('d5'),
      to: sq('e3'),
      capture: false,
      bonus: true,
      depth: 1,
    });
    // One action only (INV-01): the turn passes to black once.
    expect(eventsOf(r.events, 'TurnPassed')).toEqual([
      expect.objectContaining({ side: 'black', ply: 1 }),
    ]);
    expect(r.state.turn).toBe('black');
  });

  it('R-ABIL-005 DD-17 momentum spends one charge when the bonus move is made, visible to the opponent once revealed', () => {
    const r = scenario({
      fen: BASE_FEN,
      white: { abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [mv('d5', 'e3')],
    });
    const knight = idAt(r.initial, 'c3');
    const spent = eventsOf(r.events, 'ChargeSpent');
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({
      side: 'white',
      piece: knight,
      ability: 'momentum',
      remaining: 1,
    });
    expect(r.state.usage[`${knight}:momentum`]).toBe(1);
    expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(1);
    expect(r.state.reveals.white.abilities.knight).toContain('momentum');
    const pub = r.engine.projectEvents(r.state, r.events, 'black');
    expect(pub.find((e) => e.k === 'ChargeSpent')).toMatchObject({
      ability: 'momentum',
      remaining: 1,
    });
  });

  it('R-ABIL-005 DD-17 DD-18 momentum: declining, or not answering, keeps the piece in place and spends no charge', () => {
    for (const answers of [[0], []]) {
      const r = scenario({
        fen: BASE_FEN,
        white: { abilities: ['momentum'] },
        moves: ['c3d5'],
        answers,
      });
      const knight = idAt(r.initial, 'c3');
      expect(r.prompts).toHaveLength(1);
      expect(eventsOf(r.events, 'ChoiceMade')[0]?.option).toEqual({ kind: 'decline' });
      expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
      expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toHaveLength(0);
      expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
      expect(r.state.usage[`${knight}:momentum`] ?? 0).toBe(0);
      expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(2);
      expect(r.state.turn).toBe('black');
    }
  });

  it('R-ABIL-005 R-ELEM-007 momentum has 2 charges on a neutral or Ember piece and 4 on a Grove piece (Overabundance)', () => {
    for (const [element, charges] of [
      ['neutral', 2],
      ['ember', 2],
      ['tide', 2],
      ['grove', 4],
    ] as const) {
      const r = scenario({
        fen: BASE_FEN,
        white: { elements: [element], abilities: ['momentum'] },
      });
      expect(r.engine.remainingCharges(r.state, idAt(r.state, 'c3'), 'momentum')).toBe(charges);
    }
    const grove = scenario({
      fen: BASE_FEN,
      white: { elements: ['grove'], abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [mv('d5', 'e3')],
    });
    expect(eventsOf(grove.events, 'ChargeSpent')[0]).toMatchObject({
      ability: 'momentum',
      remaining: 3,
    });
  });

  it('R-ABIL-005 DD-17 momentum no longer triggers once both charges are spent', () => {
    // Rook a1 captures three pawns in turn, using both bonus moves on the way.
    const r = scenario({
      fen: '7k/8/8/2p5/8/p3p3/8/R6K w - - 0 1',
      white: { abilities: ['momentum'] },
      moves: ['a1a3', 'h8g8', 'c3c5', 'g8h8', 'e5e3'],
      answers: [mv('a3', 'c3'), mv('c5', 'e5')],
    });
    const rook = idAt(r.initial, 'a1');
    expect(r.prompts).toHaveLength(2);
    expect(eventsOf(r.events, 'ChargeSpent').map((e) => e.remaining)).toEqual([1, 0]);
    const last = r.steps[4];
    expect(last?.prompts).toHaveLength(0);
    expect(eventsOf(last?.events ?? [], 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(last?.events ?? [], 'EffectFizzled')).toHaveLength(0);
    expect(pieceAt(r.state, 'e3')?.id).toBe(rook);
    expect(r.engine.remainingCharges(r.state, rook, 'momentum')).toBe(0);
  });

  it('R-ABIL-005 DD-31 momentum: a bonus pawn move to the last rank promotes, each promotion piece being its own option', () => {
    // Pawn f6 takes the knight on e7; the bonus move pushes it to e8.
    const r = scenario({
      fen: '8/4n3/5P2/k7/8/8/8/K7 w - - 0 1',
      white: { abilities: ['momentum'] },
      moves: ['f6e7'],
      answers: [{ kind: 'move', from: sq('e7'), to: sq('e8'), promotion: 'knight' }],
    });
    const pawn = idAt(r.initial, 'f6');
    const req = r.prompts[0];
    expect(req?.options[0]).toEqual({ kind: 'decline' });
    const promos = req?.options.slice(1) ?? [];
    expect(promos).toHaveLength(4);
    expect(promos).toEqual(
      expect.arrayContaining(
        (['queen', 'rook', 'bishop', 'knight'] as const).map((promotion) => ({
          kind: 'move',
          from: sq('e7'),
          to: sq('e8'),
          promotion,
        })),
      ),
    );
    const piece = pieceAt(r.state, 'e8');
    expect(piece?.id).toBe(pawn);
    expect(piece?.type).toBe('knight');
    expect(eventsOf(r.events, 'MoveMade')[1]).toMatchObject({
      piece: pawn,
      pieceType: 'pawn',
      promotion: 'knight',
      bonus: true,
    });
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, to: 'knight' }),
    ]);
  });

  it('R-ABIL-005 R-ELEM-003 DD-31 momentum attuned: a friendly pawn may make the bonus move, and its double push sets the en passant square', () => {
    const fen = '4k3/8/8/3p4/3p4/2N5/4P2P/R3K3 w - - 0 1';
    const r = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [mv('e2', 'e4')],
    });
    const knight = idAt(r.initial, 'c3');
    const pawn = idAt(r.initial, 'e2');
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'momentum',
      attuned: true,
    });
    const options = (r.prompts[0]?.options ?? []).slice(1);
    const froms = new Set(options.map((o) => (o.kind === 'move' ? o.from : -1)));
    expect(froms).toEqual(new Set([sq('d5'), sq('e2'), sq('h2')]));
    expect(options).toEqual(
      expect.arrayContaining([mv('e2', 'e3'), mv('e2', 'e4'), mv('h2', 'h3'), mv('h2', 'h4')]),
    );

    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(pieceAt(r.state, 'e4')?.id).toBe(pawn);
    expect(eventsOf(r.events, 'MoveMade')[1]).toMatchObject({
      piece: pawn,
      from: sq('e2'),
      to: sq('e4'),
      bonus: true,
    });
    // DD-31: the bonus move is a real move.
    expect(r.state.ep).toBe(sq('e3'));
    expect(r.state.halfmove).toBe(0);
    const black = r.engine.legalMoves(r.state, 'black');
    expect(black).toContainEqual({ from: sq('d4'), to: sq('e3') });
    const after = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['momentum'] },
      moves: ['c3d5', 'd4e3'],
      answers: [mv('e2', 'e4')],
    });
    const last = after.steps[1]?.events ?? [];
    expect(eventsOf(last, 'Captured')).toEqual([
      expect.objectContaining({ victim: pawn, square: sq('e4'), by: 'move' }),
    ]);
    expect(eventsOf(last, 'MoveMade')[0]).toMatchObject({ enPassant: true });
  });

  it('R-ABIL-005 momentum base: a non-Ember bearer cannot hand the bonus move to a pawn', () => {
    const fen = '4k3/8/8/3p4/3p4/2N5/4P2P/R3K3 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['momentum'] }, moves: ['c3d5'] });
    const options = (r.prompts[0]?.options ?? []).slice(1);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.kind === 'move' && o.from === sq('d5'))).toBe(true);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({ attuned: false });
  });

  it('R-ABIL-005 INV-03 momentum: a bearer pinned after its capture has no legal bonus move, so the bonus fizzles with no prompt and no charge', () => {
    // Knight c3 takes e4 and lands pinned between the black rook e8 and the white king e1.
    const r = scenario({
      fen: 'k3r3/8/8/8/4p3/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['momentum'] },
      moves: ['c3e4'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'EffectFizzled')).toContainEqual(
      expect.objectContaining({ ability: 'momentum', side: 'white' }),
    );
    expect(eventsOf(r.events, 'MoveMade')).toHaveLength(1);
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(pieceAt(r.state, 'e4')?.id).toBe(knight);
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-004 R-ABIL-005 momentum: an earned trigger whose bearer was removed by Riposte fizzles without a body and costs no charge', () => {
    // Knight c3 takes a Riposte knight on d5; black recaptures with the rook d8 (depth 1). The
    // queued Momentum then has no body (5.4).
    const r = scenario({
      fen: '3rk3/8/8/3n4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['momentum'] },
      black: { abilities: ['riposte'] },
      moves: ['c3d5'],
      answers: [mv('d8', 'd5')],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts.map((p) => p.source.ability)).toEqual(['riposte']);
    expect(r.state.pieces[knight]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')?.type).toBe('rook');
    const fizzled = eventsOf(r.events, 'EffectFizzled').filter((e) => e.ability === 'momentum');
    expect(fizzled).toHaveLength(1);
    expect(fizzled[0]).toMatchObject({ side: 'white', piece: knight, reason: 'no_body' });
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(r.state.usage[`${knight}:momentum`] ?? 0).toBe(0);
  });

  it('INV-01 DD-12 R-ABIL-005 momentum triggered inside a bonus action fizzles with bonus_in_bonus', () => {
    // Bishop b3 takes a Riposte knight on d5; the black rook d8 recaptures at depth 1 and its own
    // Momentum (Captures) triggers there. Bonus actions cannot grant further bonus actions.
    const r = scenario({
      fen: '3rk3/8/8/3n4/8/1B6/8/4K3 w - - 0 1',
      black: { abilities: ['riposte', 'momentum'] },
      moves: ['b3d5'],
      answers: [mv('d8', 'd5')],
    });
    const rook = idAt(r.initial, 'd8');
    expect(r.prompts.map((p) => p.source.ability)).toEqual(['riposte']);
    const fizzled = eventsOf(r.events, 'EffectFizzled').filter((e) => e.ability === 'momentum');
    expect(fizzled).toHaveLength(1);
    expect(fizzled[0]).toMatchObject({
      side: 'black',
      piece: rook,
      reason: 'bonus_in_bonus',
      depth: 1,
    });
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(r.state.usage[`${rook}:momentum`] ?? 0).toBe(0);
    expect(pieceAt(r.state, 'd5')?.id).toBe(rook);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toHaveLength(1);
  });

  it('R-ABIL-005 momentum is ineligible on kings: an army-wide Momentum never triggers for a capturing king', () => {
    const r = scenario({
      fen: '4k3/8/8/8/3p4/3K4/8/8 w - - 0 1',
      white: { abilities: ['momentum'] },
      moves: ['d3d4'],
    });
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(0);
    expect(eventsOf(r.events, 'EffectFizzled')).toHaveLength(0);
    expect(pieceAt(r.state, 'd4')?.type).toBe('king');
  });

  it('R-ABIL-005 R-ELEM-002 DD-17 momentum silenced by a Tide victim: no prompt, no charge, revealed by name', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['momentum'] },
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', piece: knight, ability: 'momentum' }),
    ]);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'knight', ability: 'momentum' },
        cause: 'silenced',
      }),
    );
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(0);
    expect(r.engine.remainingCharges(r.state, knight, 'momentum')).toBe(2);
  });
});
