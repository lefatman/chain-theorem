/**
 * Buttress scenario tests (R-ABIL-005, M7 7.3; neutral since DD-98): Capturing, neutral, all. When
 * capturing, the owner chooses one of its other pieces adjacent to the landing square: every effect
 * capture targeting it this action fizzles. The first effect capture targeting this piece this
 * action also fizzles (the former attuned bonus, folded into the base by DD-98; there is no attuned
 * version, whatever the bearer's element).
 *
 * Expected behaviour comes from spec 5.2 (PROTECT), 5.3 (phase 2), 5.4, 6.1 (Bulwark), 6.2, 6.3,
 * 7.2 (Attunement Charm) and DD-18, DD-19, DD-35, DD-98, not from the engine's current output.
 */
import type { ChoiceRequest } from '@chain-theorem/rules';
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// Knight c3 takes the pawn d5; White's pawn e4 stands next to the landing square.
const FEN = '4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1';
// As FEN, plus a white bishop c4 next to d5 and the white king on e1 far away.
const TWO = '4k3/8/8/3p4/2B1P3/2N5/8/4K3 w - - 0 1';

describe('buttress (R-ABIL-005)', () => {
  it('R-ABIL-005 buttress is a level-2, 1-slot neutral When-capturing card without an attuned version (DD-98)', () => {
    expect(abilityById.get('buttress')).toMatchObject({
      category: 'CAPTURING',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 2,
      slotCost: 1,
    });
    expect(abilityById.get('buttress')?.limits.charges).toBeUndefined();
    expect(abilityById.get('buttress')?.attuned).toBeUndefined();
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
    // White guards the pawn e4; Backdraft (which may take the bishop c4 or the pawn e4) goes for e4.
    const pickE4 = (req: ChoiceRequest) =>
      req.options.findIndex((o) => o.kind === 'piece' && o.square === sq('e4'));
    const r = scenario({
      fen: TWO,
      white: { abilities: ['buttress'] },
      black: { abilities: ['backdraft'] },
      moves: ['c3d5'],
      answers: [pickE4, pickE4],
    });
    const pawn = idAt(r.initial, 'e4');
    expect(r.prompts[0]?.chooser).toBe('white');
    expect(r.prompts[0]?.purpose).toBe('protect');
    expect(r.prompts[0]?.options.map((o) => (o.kind === 'piece' ? o.square : -1))).toEqual([
      sq('c4'),
      sq('e4'),
    ]);
    expect(r.prompts[1]?.chooser).toBe('black');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'backdraft', reason: 'protected', target: pawn }),
    ]);
    expect(pieceAt(r.state, 'e4')?.id).toBe(pawn);
    expect(pieceAt(r.state, 'c4')?.type).toBe('bishop');
  });

  it('R-ABIL-004 with no friendly neighbour the neighbour guard fizzles (no target) and costs nothing else', () => {
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

  it('R-ABIL-002 DD-98 the self-guard is base behaviour: on a neutral bearer, Poisoned Meat on the captor fizzles (protected)', () => {
    const r = scenario({
      fen: FEN,
      white: { abilities: ['buttress'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'buttress',
      attuned: false,
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        ability: 'poisoned_meat',
        reason: 'protected',
        target: knight,
        source: expect.objectContaining({ kind: 'ability', id: 'buttress' }),
      }),
    ]);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
  });

  it('R-ELEM-003 R-LOAD-002 DD-98 a Tide bearer gets the same self-guard, and a Stone Charm attunes nothing (no attuned version)', () => {
    for (const items of [[], ['attunement_charm']]) {
      const r = scenario({
        fen: FEN,
        white: {
          elements: ['tide'],
          items,
          itemParams: { attunement_charm: { element: 'stone' } },
          abilities: ['buttress'],
        },
        black: { abilities: ['poisoned_meat'] },
        moves: ['c3d5'],
      });
      const knight = idAt(r.initial, 'c3');
      expect(eventsOf(r.events, 'AbilityTriggered')[0], items.join()).toMatchObject({
        ability: 'buttress',
        attuned: false,
      });
      expect(eventsOf(r.events, 'EffectFizzled'), items.join()).toEqual([
        expect.objectContaining({ ability: 'poisoned_meat', reason: 'protected', target: knight }),
      ]);
      expect(pieceAt(r.state, 'd5')?.id, items.join()).toBe(knight);
    }
  });

  it('R-ELEM-001 DD-35 on a Stone bearer, Bulwark answers the first effect capture before the self-guard', () => {
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
