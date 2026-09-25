/**
 * Buttress scenario tests (R-ABIL-005, M7 7.3): Capturing, Stone, all. When capturing, the owner
 * chooses one of its other pieces adjacent to the landing square: every effect capture targeting it
 * this action fizzles. Attuned (Stone bearer): the first effect capture targeting this piece this
 * action also fizzles.
 *
 * Expected behaviour comes from spec 5.2 (PROTECT), 5.3 (phase 2), 5.4, 6.1 (Bulwark), 6.2, 6.3,
 * 7.2 (Attunement Charm) and DD-18, DD-19, DD-35, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// Knight c3 takes the pawn d5; White's pawn e4 stands next to the landing square.
const FEN = '4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1';
// As FEN, plus a white bishop c4 next to d5 and the white king on e1 far away.
const TWO = '4k3/8/8/3p4/2B1P3/2N5/8/4K3 w - - 0 1';

describe('buttress (R-ABIL-005)', () => {
  it('R-ABIL-005 buttress is a level-2, 1-slot Stone When-capturing card', () => {
    expect(abilityById.get('buttress')).toMatchObject({
      category: 'CAPTURING',
      affinity: 'stone',
      eligible: 'all',
      tags: [],
      minLevel: 2,
      slotCost: 1,
    });
    expect(abilityById.get('buttress')?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-003 the only neighbour is guarded without a prompt, so Backdraft’s capture of it fizzles (protected)', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['buttress'] },
      black: { abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'buttress',
      'backdraft',
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        ability: 'backdraft',
        reason: 'protected',
        target: pawn,
        source: expect.objectContaining({ kind: 'ability', id: 'buttress' }),
      }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(pawn);
  });

  it('R-ABIL-004 DD-18 the mover chooses among its other neighbours of the landing square, in square order, never the king or itself', () => {
    const r = scenario({
      fen: TWO,
      white: { abilities: ['buttress'] },
      black: { abilities: ['backdraft'] },
      moves: ['c3d5'],
      answers: [1],
    });
    expect(r.prompts[0]?.chooser).toBe('white');
    expect(r.prompts[0]?.purpose).toBe('protect');
    expect(r.prompts[0]?.options.map((o) => (o.kind === 'piece' ? o.square : -1))).toEqual([
      sq('c4'),
      sq('e4'),
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'backdraft', reason: 'protected' }),
    ]);
  });

  it('R-ABIL-004 with no friendly neighbour it fizzles (no target) and costs nothing else', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['buttress'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'buttress', effect: 'protect', reason: 'no_target' }),
    ]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
  });

  it('R-ELEM-003 R-LOAD-002 attuned through a Stone Charm: Poisoned Meat on the captor fizzles (protected)', () => {
    const r = scenario({
      fen: FEN,
      white: {
        elements: ['tide'],
        items: ['attunement_charm'],
        itemParams: { attunement_charm: { element: 'stone' } },
        abilities: ['buttress'],
      },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'buttress',
      attuned: true,
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'protected', target: knight }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });

  it('R-ELEM-001 DD-35 on a Stone bearer, Bulwark answers the first effect capture before the attuned guard', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['buttress'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        ability: 'poisoned_meat',
        reason: 'bulwark',
        source: expect.objectContaining({ kind: 'trait', id: 'bulwark' }),
      }),
    ]);
  });

  it('R-ELEM-002 a Frost victim silences a Stone captor’s Buttress (Frost beats Stone)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'], abilities: ['buttress'] },
      black: { elements: ['frost'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['buttress']);
    expect(r.state.reveals.white.abilities.knight).toEqual(['buttress']);
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Buttress', () => {
    const r = scenario({ fen: FEN, white: { abilities: ['buttress'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('buttress');
  });
});
