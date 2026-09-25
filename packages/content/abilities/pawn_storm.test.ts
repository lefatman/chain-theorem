/**
 * Pawn Storm scenario tests (R-ABIL-005, M7 7.3): Captures, Storm, pawn, replay. After capturing,
 * this pawn may make one non-capturing move. Attuned (Storm bearer): any friendly pawn may make the
 * move instead.
 *
 * Expected behaviour comes from spec 4.1 (INV-01), 4.2 (promotion), 5.1-5.6, 6.1-6.3, 7.2 (Warden's
 * Stopwatch) and DD-12, DD-18, DD-31, R-RULES-002, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const mv = (
  from: string,
  to: string,
  promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
): ChoiceOption =>
  promotion
    ? { kind: 'move', from: sq(from), to: sq(to), promotion }
    : { kind: 'move', from: sq(from), to: sq(to) };
// White pawn e4 takes d5; another white pawn waits on h2, a knight on b1.
const FEN = '4k3/8/8/3p4/4P3/8/7P/1N2K3 w - - 0 1';

describe('pawn storm (R-ABIL-005)', () => {
  it('R-ABIL-005 pawn storm is a level-7, 1-slot Storm After-capturing card for pawns, with the replay tag', () => {
    expect(abilityById.get('pawn_storm')).toMatchObject({
      category: 'CAPTURES',
      affinity: 'storm',
      eligible: ['pawn'],
      tags: ['replay'],
      minLevel: 7,
      slotCost: 1,
    });
    expect(abilityById.get('pawn_storm')?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-001 DD-18 after capturing, the pawn may push once more: Decline first, then its own moves only', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['pawn_storm'] },
      moves: ['e4d5'],
      answers: [mv('d5', 'd6')],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts[0]?.options).toEqual([{ kind: 'decline' }, mv('d5', 'd6')]);
    expect(pieceAt(r.state, 'd6')?.id).toBe(pawn);
    expect(eventsOf(r.events, 'MoveMade').filter((e) => e.bonus)).toEqual([
      expect.objectContaining({ piece: pawn, from: sq('d5'), to: sq('d6'), depth: 1 }),
    ]);
    expect(eventsOf(r.events, 'TurnPassed')).toHaveLength(1);
  });

  it('DD-31 a push onto the last rank promotes, each promotion piece a separate option', () => {
    // Pawn g6 takes h7, then may push h7-h8.
    const r = scenario({
      fen: '4k3/7p/6P1/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['pawn_storm'] },
      moves: ['g6h7'],
      answers: [mv('h7', 'h8', 'knight')],
    });
    expect(r.prompts[0]?.options).toEqual([
      { kind: 'decline' },
      mv('h7', 'h8', 'queen'),
      mv('h7', 'h8', 'rook'),
      mv('h7', 'h8', 'bishop'),
      mv('h7', 'h8', 'knight'),
    ]);
    expect(pieceAt(r.state, 'h8')?.type).toBe('knight');
  });

  it('R-ELEM-003 attuned (Storm bearer): any friendly pawn may make the move', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'], abilities: ['pawn_storm'] },
      moves: ['e4d5'],
      answers: [mv('h2', 'h4')],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]?.attuned).toBe(true);
    expect(r.prompts[0]?.options).toEqual([
      { kind: 'decline' },
      mv('h2', 'h3'),
      mv('h2', 'h4'),
      mv('d5', 'd6'),
    ]);
    expect(pieceAt(r.state, 'h4')?.type).toBe('pawn');
  });

  it('R-ABIL-005 R-RULES-002 a knight never uses it, and a pawn that promotes while capturing uses its new set', () => {
    const knight = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['pawn_storm'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(knight.events, 'AbilityTriggered')).toEqual([]);
    const promo = scenario({
      fen: '3rk3/4P3/8/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['pawn_storm'] },
      moves: ['e7d8q'],
    });
    expect(eventsOf(promo.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(promo.state, 'd8')?.type).toBe('queen');
  });

  it('R-LOAD-002 D-39 Warden’s Stopwatch negates Pawn Storm (replay); Stillness negates it on a Frost victim', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['pawn_storm'] },
      black: { items: ['wardens_stopwatch'] },
      moves: ['e4d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['pawn_storm']);
    expect(r.prompts).toEqual([]);
    const frost = scenario({
      fen: FEN,
      white: { abilities: ['pawn_storm'] },
      black: { elements: ['frost'] },
      moves: ['e4d5'],
    });
    expect(eventsOf(frost.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['pawn_storm']);
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Pawn Storm', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['pawn_storm'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('pawn_storm');
  });
});
