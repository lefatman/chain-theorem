/**
 * Always First scenario tests (Storm trait, R-ELEM-001, R-ABIL-003 step 4, R-ABIL-004 ordering).
 * The engine supports all six elements (6.5); tests use Storm directly (DD-23 bypasses the MVP
 * element list).
 *
 * Expected behaviour comes from spec 5.3, 5.4, 5.5 E1, 6.1 (Always First), 6.2 and 6.4, not from
 * the engine's current output. Storm is in the second triangle, so against Ember, Tide, Grove and
 * neutral pieces nothing is silenced (6.2).
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, ElementId } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const order = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'AbilityTriggered').map((e) => e.ability);

/** Knight c3 (Hit and Run) takes a Poisoned Meat pawn on d5 (5.5 E1 with elements). */
function e1(white: ElementId[], black: ElementId[]) {
  return scenario({
    fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
    white: {
      elements: white,
      abilities: ['hit_and_run'],
      ...(white.length === 2 ? { items: ['blended_family'] } : {}),
    },
    black: { elements: black, abilities: ['poisoned_meat'] },
    moves: ['c3d5'],
  });
}

describe('always_first (R-ELEM-001)', () => {
  it("R-ELEM-001 R-ABIL-004 a Storm captor's Captures abilities resolve before the victim's Captured abilities", () => {
    const r = e1(['storm'], ['neutral']);
    const knight = idAt(r.initial, 'c3');
    expect(order(r.events)).toEqual(['hit_and_run', 'poisoned_meat']);
    // Hit and Run carries the knight back to c3 first; Poisoned Meat then removes it there.
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('d5'), to: sq('c3') }),
    ]);
    expect(eventsOf(r.events, 'Captured')).toEqual([
      expect.objectContaining({ victimType: 'pawn', by: 'move', square: sq('d5') }),
      expect.objectContaining({ victim: knight, by: 'effect', square: sq('c3') }),
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it("R-ELEM-001 R-ABIL-004 E1 without Storm the victim's side resolves first", () => {
    const r = e1(['neutral'], ['neutral']);
    expect(order(r.events)).toEqual(['poisoned_meat', 'hit_and_run']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', reason: 'no_body' }),
    ]);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
  });

  it('R-ELEM-001 a Storm victim already resolves first; Always First changes nothing there', () => {
    const r = e1(['tide'], ['storm']);
    expect(order(r.events)).toEqual(['poisoned_meat', 'hit_and_run']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', reason: 'no_body' }),
    ]);
  });

  it('R-ELEM-001 R-ABIL-004 when both sides have Storm triggers the default order applies among them (victim first)', () => {
    const r = e1(['storm'], ['storm']);
    expect(order(r.events)).toEqual(['poisoned_meat', 'hit_and_run']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', reason: 'no_body' }),
    ]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it("R-ELEM-001 R-ABIL-004 Storm triggers move to the front as a block: the captor's loadout order and the victim's order are kept", () => {
    const fen = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';
    const run = (white: ElementId, set: string[]) =>
      scenario({
        fen,
        white: { elements: [white], abilities: set },
        black: { elements: ['neutral'], abilities: ['last_word', 'poisoned_meat'] },
        moves: ['c3d5'],
      });
    const storm = run('storm', ['cleave', 'hit_and_run']);
    expect(order(storm.events)).toEqual(['cleave', 'hit_and_run', 'last_word', 'poisoned_meat']);
    // Cleave (from d5) takes the e6 pawn, the knight returns to c3, Poisoned Meat takes it there.
    expect(eventsOf(storm.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('d5'), by: 'move' }),
      expect.objectContaining({ square: sq('e6'), by: 'effect' }),
      expect.objectContaining({
        victim: idAt(storm.initial, 'c3'),
        square: sq('c3'),
        by: 'effect',
      }),
    ]);

    const swapped = run('storm', ['hit_and_run', 'cleave']);
    expect(order(swapped.events)).toEqual(['hit_and_run', 'cleave', 'last_word', 'poisoned_meat']);

    const plain = run('neutral', ['cleave', 'hit_and_run']);
    expect(order(plain.events).slice(0, 2)).toEqual(['last_word', 'poisoned_meat']);
  });

  it('R-ELEM-001 R-ELEM-004 Always First applies per piece under Blended Family', () => {
    // Tide knight (group A): default order. Storm rook (group B): its trigger goes first.
    const knight = e1(['tide', 'storm'], ['neutral']);
    expect(order(knight.events)).toEqual(['poisoned_meat', 'hit_and_run']);

    const rook = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { elements: ['tide', 'storm'], items: ['blended_family'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    });
    const id = idAt(rook.initial, 'd1');
    expect(order(rook.events)).toEqual(['hit_and_run', 'poisoned_meat']);
    expect(eventsOf(rook.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('d5'), by: 'move' }),
      expect.objectContaining({ victim: id, square: sq('d1'), by: 'effect' }),
    ]);
  });

  it("R-ABIL-003 R-ELEM-001 Always First only reorders the reaction queue: the captor's Capturing abilities still resolve before a Storm victim's reactions", () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['scout'] },
      black: { elements: ['storm'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(order(r.events)).toEqual(['scout', 'last_word']);
  });

  it('R-ELEM-001 Always First changes the outcome: a Storm knight retreats before Riposte, so the riposte capture lands on c3 instead of d5', () => {
    const fen = '4k3/8/8/q2p4/8/2N5/8/6K1 w - - 0 1';
    const storm = scenario({
      fen,
      white: { elements: ['storm'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['c3d5'],
      answers: [{ kind: 'move', from: sq('a5'), to: sq('c3') }],
    });
    const knight = idAt(storm.initial, 'c3');
    expect(order(storm.events)).toEqual(['hit_and_run', 'riposte']);
    expect(storm.prompts[0]?.options).toEqual([
      { kind: 'decline' },
      { kind: 'move', from: sq('a5'), to: sq('c3') },
    ]);
    expect(eventsOf(storm.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('d5'), by: 'move' }),
      expect.objectContaining({ victim: knight, square: sq('c3'), by: 'move' }),
    ]);
    expect(pieceAt(storm.state, 'c3')?.type).toBe('queen');

    const plain = scenario({
      fen,
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['c3d5'],
      answers: [{ kind: 'move', from: sq('a5'), to: sq('d5') }],
    });
    expect(order(plain.events)).toEqual(['riposte', 'hit_and_run']);
    expect(plain.prompts[0]?.options).toEqual([
      { kind: 'decline' },
      { kind: 'move', from: sq('a5'), to: sq('d5') },
    ]);
    expect(pieceAt(plain.state, 'd5')?.type).toBe('queen');
    expect(eventsOf(plain.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', reason: 'no_body' }),
    ]);
  });
});
