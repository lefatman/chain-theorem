/**
 * Squall scenario tests (R-ABIL-005, M7 7.3): Captured, neutral, all, replay. When captured, the
 * owner may move one of its pawns (a non-capturing move). Storm's signature until Electric Slide
 * shipped (DD-98, DD-104): its former attuned version (any piece may move) is retired.
 *
 * Expected behaviour comes from spec 4.1 (INV-01, INV-03), 5.1-5.6, 6.1-6.3, 7.2 (Warden's
 * Stopwatch), 8.2 and DD-12, DD-18, DD-21, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const mv = (from: string, to: string): ChoiceOption => ({
  kind: 'move',
  from: sq(from),
  to: sq(to),
});
// White knight c3 takes the black pawn d5 (the Squall bearer). Black also has pawns a7 and h6, a
// knight b8 and its king e8.
const FEN = '1n2k3/p7/7p/3p4/8/2N5/8/4K3 w - - 0 1';

describe('squall (R-ABIL-005)', () => {
  it('R-ABIL-005 DD-104 squall is a level-1, 1-slot neutral When-captured card with the replay tag, no charges and no attuned version', () => {
    const def = abilityById.get('squall');
    expect(def?.attuned).toBeUndefined();
    expect(def).toMatchObject({
      category: 'CAPTURED',
      affinity: 'neutral',
      eligible: 'all',
      tags: ['replay'],
      minLevel: 1,
      slotCost: 1,
    });
    expect(def?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-001 R-ABIL-002 DD-18 when captured, the owner may move a pawn: Decline first, then pawn moves only', () => {
    const r = scenario({
      fen: FEN,
      black: { abilities: ['squall'] },
      moves: ['c3d5'],
      answers: [mv('a7', 'a5')],
    });
    const pawn = idAt(r.initial, 'd5');
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('black');
    expect(req?.kind).toBe('bonusMove');
    expect(req?.source).toEqual({ ability: 'squall', piece: pawn, side: 'black' });
    // Square order from Black's side (a8 first): a7 before h6; the knight and king are not movers.
    expect(req?.options).toEqual([
      { kind: 'decline' },
      mv('a7', 'a6'),
      mv('a7', 'a5'),
      mv('h6', 'h5'),
    ]);
    expect(pieceAt(r.state, 'a5')?.type).toBe('pawn');
    const bonus = eventsOf(r.events, 'MoveMade').filter((e) => e.bonus);
    expect(bonus).toEqual([
      expect.objectContaining({ side: 'black', from: sq('a7'), to: sq('a5'), depth: 1 }),
    ]);
    // INV-01: still one action; the turn passes to Black once.
    expect(eventsOf(r.events, 'TurnPassed')).toEqual([expect.objectContaining({ side: 'black' })]);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['squall']);
  });

  it('R-ABIL-004 DD-18 declining, or not answering, moves nothing', () => {
    for (const answers of [[0], []]) {
      const r = scenario({ fen: FEN, black: { abilities: ['squall'] }, moves: ['c3d5'], answers });
      expect(eventsOf(r.events, 'ChoiceMade')[0]?.option).toEqual({ kind: 'decline' });
      expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([]);
      expect(pieceAt(r.state, 'a7')?.type).toBe('pawn');
    }
  });

  it('R-ELEM-003 DD-104 a Storm bearer gets no attuned version any more: pawns only, not the knight or king', () => {
    const r = scenario({
      fen: FEN,
      black: { elements: ['storm'], abilities: ['squall'] },
      moves: ['c3d5'],
      answers: [mv('a7', 'a5')],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]?.attuned).toBe(false);
    const options = r.prompts[0]?.options ?? [];
    expect(options).toEqual([{ kind: 'decline' }, mv('a7', 'a6'), mv('a7', 'a5'), mv('h6', 'h5')]);
    expect(pieceAt(r.state, 'a5')?.type).toBe('pawn');
  });

  it('INV-03 DD-21 the bonus move may not leave the acting player’s king in check: no checking move is offered', () => {
    // The black pawn b3 could step to b2 and check the king on c1; that move is not offered.
    const r = scenario({
      fen: '4k3/7p/8/3p4/8/1pN5/8/2K5 w - - 0 1',
      black: { abilities: ['squall'] },
      moves: ['c3d5'],
    });
    const options = r.prompts[0]?.options ?? [];
    expect(options).toEqual([{ kind: 'decline' }, mv('h7', 'h6'), mv('h7', 'h5')]);
    expect(options).not.toContainEqual(mv('b3', 'b2'));
  });

  it('R-ELEM-002 a Stone captor silences Squall on a Storm victim (Stone beats Storm), and the silence reveals it', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'] },
      black: { elements: ['storm'], abilities: ['squall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['squall']);
    expect(r.prompts).toEqual([]);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['squall']);
  });

  it('R-LOAD-002 D-39 Warden’s Stopwatch negates Squall (replay), and Pierce negates it too', () => {
    const stop = scenario({
      fen: FEN,
      white: { items: ['wardens_stopwatch'] },
      black: { abilities: ['squall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(stop.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['squall']);
    expect(stop.prompts).toEqual([]);
    const pierce = scenario({
      fen: FEN,
      white: { abilities: ['pierce'] },
      black: { abilities: ['squall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(pierce.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['squall']);
  });

  it('R-INFO-005 R-SEC-001 before it fires, White’s projection never names Squall; after, the prompt options go to Black only', () => {
    const before = scenario({ fen: FEN, black: { abilities: ['squall'] } });
    expect(JSON.stringify(before.engine.project(before.state, 'white'))).not.toContain('squall');
    const r = scenario({ fen: FEN, black: { abilities: ['squall'] }, moves: ['c3d5'] });
    const white = r.engine.projectEvents(r.state, r.events, 'white');
    expect(white.some((e) => e.k === 'ChoiceMade')).toBe(false);
  });
});
