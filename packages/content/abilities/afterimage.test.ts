/**
 * Afterimage scenario tests (R-ABIL-005, M7 7.3): Captures, neutral, knights, bishops, rooks and
 * queens. After capturing, move to an empty square adjacent to the landing square (the owner
 * chooses), and the first effect capture targeting this piece this action fizzles. Neutral since
 * DD-98: the guard, formerly the Storm Attuned bonus, is part of the base card for every bearer.
 *
 * Expected behaviour comes from spec 5.3 (phase 4 queue order), 5.4, 6.1 (Always First, Stillness),
 * 6.2, 6.3, 7.2 (Attunement Charm) and DD-18, DD-19, DD-35, DD-98, not from the engine's current
 * output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
/** Knight c3 takes the pawn d5; kings e1 and e8. */
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('afterimage (R-ABIL-005)', () => {
  it('R-ABIL-005 afterimage is a level-5, 1-slot neutral After-capturing card for knights, bishops, rooks and queens: a sidestep plus a one-capture guard, no attuned version (DD-98)', () => {
    const def = abilityById.get('afterimage');
    expect(def).toMatchObject({
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: ['knight', 'bishop', 'rook', 'queen'],
      tags: [],
      minLevel: 5,
      slotCost: 1,
    });
    expect(def?.limits.charges).toBeUndefined();
    expect(def?.effects.map((e) => e.op)).toEqual(['move', 'protect']);
    expect(def?.effects[1]).toMatchObject({ op: 'protect', count: 1 });
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-001 R-ABIL-002 after capturing, the owner picks an empty square next to the landing square, in square order', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['afterimage'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('e4') }],
    });
    const knight = idAt(r.initial, 'c3');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.chooser).toBe('white');
    expect(r.prompts[0]?.options).toEqual(
      ['c4', 'd4', 'e4', 'c5', 'e5', 'c6', 'd6', 'e6'].map((s) => ({
        kind: 'square',
        square: sq(s),
      })),
    );
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('d5'), to: sq('e4') }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(knight);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.reveals.white.abilities.knight).toEqual(['afterimage']);
  });

  it('R-ABIL-004 DD-18 one empty neighbour: no prompt; none: the move fizzles (no target) and the piece stays', () => {
    // Knight b6 takes the rook a8; of its neighbours a7, b7 and b8, only a7 is empty.
    const one = scenario({
      fen: 'rn2k3/1p6/1N6/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['afterimage'] },
      moves: ['b6a8'],
    });
    expect(one.prompts).toEqual([]);
    expect(pieceAt(one.state, 'a7')?.type).toBe('knight');
    const none = scenario({
      fen: 'rn2k3/pp6/1N6/8/8/8/8/4K3 w - - 0 1',
      white: { abilities: ['afterimage'] },
      moves: ['b6a8'],
    });
    expect(eventsOf(none.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'afterimage', effect: 'move', reason: 'no_target' }),
    ]);
    expect(pieceAt(none.state, 'a8')?.type).toBe('knight');
  });

  it('R-ABIL-005 pawns and kings are not eligible: the card uses the slot but never fires for them', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
      white: { abilities: ['afterimage'] },
      moves: ['e4d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('pawn');
  });

  it('R-ELEM-001 R-ELEM-003 Storm bearer: Always First resolves the plain card (attuned: false, DD-98) first, so it steps aside and guards before Poisoned Meat, which fizzles (protected)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['storm'], abilities: ['afterimage'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('e4') }],
    });
    const knight = idAt(r.initial, 'c3');
    const order = eventsOf(r.events, 'AbilityTriggered').map((e) => [e.ability, e.attuned]);
    expect(order).toEqual([
      ['afterimage', false],
      ['poisoned_meat', false],
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'protected', target: knight }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(knight);
  });

  it('R-ELEM-003 the guard is in the base card for every element (DD-98): a Tide knight resolves after Poisoned Meat, so its step and its guard both fizzle (no body); a Storm Charm attunes nothing', () => {
    const run = (items: string[] = []) =>
      scenario({
        fen: FEN,
        white: {
          elements: ['tide'],
          items,
          itemParams: items.length > 0 ? { attunement_charm: { element: 'storm' } } : undefined,
          abilities: ['afterimage'],
        },
        black: { abilities: ['poisoned_meat'] },
        moves: ['c3d5'],
      });
    for (const r of [run(), run(['attunement_charm'])]) {
      // The order comes from the Storm trait, which a Tide piece lacks: the victim's reaction first.
      expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.ability, e.attuned])).toEqual([
        ['poisoned_meat', false],
        ['afterimage', false],
      ]);
      // Both self-acting effects fizzle without a body (5.4): the step and the base guard.
      expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
        expect.objectContaining({ ability: 'afterimage', effect: 'move', reason: 'no_body' }),
        expect.objectContaining({ ability: 'afterimage', effect: 'protect', reason: 'no_body' }),
      ]);
      expect(pieceAt(r.state, 'd5')).toBeUndefined();
    }
    // A neutral card is never attuned, so the Charm has nothing observable and stays hidden (8.2).
    expect(run(['attunement_charm']).state.reveals.white.items).not.toContain('attunement_charm');
  });

  it('R-ELEM-002 a Storm captor is silenced by a Stone victim (Stone beats Storm); Stillness negates it on a Frost victim', () => {
    const stone = scenario({
      fen: FEN,
      white: { elements: ['storm'], abilities: ['afterimage'] },
      black: { elements: ['stone'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(stone.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['afterimage']);
    expect(pieceAt(stone.state, 'd5')?.type).toBe('knight');
    const frost = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['afterimage'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(frost.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({
        ability: 'afterimage',
        source: expect.objectContaining({ id: 'stillness' }),
      }),
    ]);
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Afterimage', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['afterimage'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('afterimage');
  });
});
