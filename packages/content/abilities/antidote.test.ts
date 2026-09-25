/**
 * Antidote (5.7): Capturing, Grove, all. "The first effect capture targeting this piece this action
 * fizzles." Attuned: "Every effect capture targeting it this action fizzles." PROTECT (5.2) makes
 * matching effects fizzle within this action; DD-35 fixes the intercept order: Royal Immunity,
 * INV-03, traits (Bulwark), items, abilities, then PROTECT (Antidote); the first fizzle wins and later
 * interceptors are not consumed.
 *
 * Expected behaviour comes from spec 4.1, 4.4, 5.1-5.7, 6.1, 6.2, 6.3, 8.2 and DD-17 to DD-40, not
 * from the engine.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type ChoiceRequest,
  type GameState,
  type PieceType,
  type Side,
  squareName,
  uciToMove,
} from '@chain-theorem/rules';
import type { BulwarkState } from '../traits/bulwark.ts';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;

function revealedOn(state: GameState, side: Side, pieceType: PieceType): string[] {
  return state.reveals[side].abilities[pieceType] ?? [];
}

function trace(events: readonly BattleEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const d = e.depth > 0 ? `d${e.depth} ` : '';
    switch (e.k) {
      case 'Captured':
        out.push(`${d}Captured ${e.victimSide} ${e.victimType}#${e.victim} by ${e.by}`);
        break;
      case 'MoveMade':
        out.push(
          `${d}MoveMade ${e.side} ${e.pieceType}#${e.piece} ${squareName(e.from)}-${squareName(e.to)}`,
        );
        break;
      case 'AbilityTriggered':
        out.push(`${d}Triggered ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'AbilityNegated':
        out.push(`${d}Negated ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'AbilitySilenced':
        out.push(`${d}Silenced ${e.side} ${e.ability ?? '?'}`);
        break;
      case 'EffectFizzled':
        out.push(`${d}Fizzled ${e.side} ${e.ability ?? '?'} ${e.reason}`);
        break;
      case 'TurnPassed':
        out.push(`${d}TurnPassed ${e.side}`);
        break;
      default:
        break;
    }
  }
  return out;
}

function pickMove(uci: string) {
  const m = uciToMove(uci);
  return (req: ChoiceRequest): number => {
    const idx = req.options.findIndex(
      (o) => o.kind === 'move' && o.from === m.from && o.to === m.to,
    );
    if (idx < 0) throw new Error(`move ${uci} is not offered: ${JSON.stringify(req.options)}`);
    return idx;
  };
}

// e1 K=0, c3 N=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
const KNIGHT = 1;
const PAWN = 2;
const ANTIDOTE_KNIGHT = { kind: 'ability', id: 'antidote', piece: KNIGHT, side: 'white' } as const;
/**
 * e1 K=0, e4 P=1, d5 n=2, h8 k=3. The e4 pawn takes an Ember knight carrying Poisoned Meat and
 * Riposte; no black piece can recapture on d5, so attuned Riposte effect-captures the pawn: two
 * effect captures target the same captor in one action.
 */
const TWO_FEN = '7k/8/8/3n4/4P3/8/8/4K3 w - - 0 1';
const TWO_BLACK = { elements: ['ember' as const], abilities: ['poisoned_meat', 'riposte'] };

describe('Antidote', () => {
  it('R-ABIL-005 R-ABIL-001 module data matches the 5.7 catalogue row (Capturing, Grove, all, level 5, 1 slot)', () => {
    const def = abilityById.get('antidote');
    expect(def?.category).toBe('CAPTURING');
    expect(def?.affinity).toBe('grove');
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(5);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it('R-ABIL-005 R-ABIL-002 R-INFO-002 base: Poisoned Meat against the captor fizzles (protected) and the knight survives', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Triggered white antidote',
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Fizzled black poisoned_meat protected',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'white',
      piece: KNIGHT,
      pieceType: 'knight',
      ability: 'antidote',
      category: 'CAPTURING',
      attuned: false,
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      {
        side: 'black',
        piece: PAWN,
        ability: 'poisoned_meat',
        reason: 'protected',
        target: KNIGHT,
        source: ANTIDOTE_KNIGHT,
      },
    ]);
    expect(idAt(r.state, 'd5')).toBe(KNIGHT);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['antidote']);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
  });

  it('R-ABIL-005 R-ABIL-002 base: only the first effect capture fizzles; a second one in the same action removes the captor', () => {
    const r = scenario({
      fen: TWO_FEN,
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: TWO_BLACK,
      moves: ['e4d5'],
    });
    expect(r.prompts).toEqual([]);
    const pmFizzle = eventsOf(r.events, 'EffectFizzled').filter(
      (e) => e.ability === 'poisoned_meat',
    );
    expect(pmFizzle).toMatchObject([{ reason: 'protected', target: 1 }]);
    expect(eventsOf(r.events, 'Captured')).toMatchObject([
      { victim: 2, by: 'move' },
      { victim: 1, by: 'effect', source: { kind: 'ability', id: 'riposte', side: 'black' } },
    ]);
    expect(
      eventsOf(r.events, 'EffectFizzled').filter((e) => e.reason === 'protected'),
    ).toHaveLength(1);
    expect(r.state.pieces[1]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-003 R-ELEM-002 attuned (Grove bearer): every effect capture on it this action fizzles', () => {
    // REACTIONS_ONLY spares the Grove captor's Capturing ability against the Ember victim, so the
    // attuned Antidote resolves; the Ember victim's Captured abilities are not silenced either.
    const r = scenario({
      fen: TWO_FEN,
      caps: { SILENCE_SCOPE: 'REACTIONS_ONLY' },
      white: { elements: ['grove'], abilities: ['antidote'] },
      black: TWO_BLACK,
      moves: ['e4d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'antidote',
      attuned: true,
    });
    const protectedFizzles = eventsOf(r.events, 'EffectFizzled').filter(
      (e) => e.reason === 'protected',
    );
    expect(protectedFizzles.map((e) => e.ability)).toEqual(['poisoned_meat', 'riposte']);
    for (const f of protectedFizzles)
      expect(f).toMatchObject({
        target: 1,
        source: { kind: 'ability', id: 'antidote', piece: 1, side: 'white' },
      });
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(idAt(r.state, 'd5')).toBe(1);
  });

  it('R-ABIL-005 R-ELEM-003 R-LOAD-002 attuned through Attunement Charm (grove) on a neutral pawn: both effect captures fizzle', () => {
    const r = scenario({
      fen: TWO_FEN,
      white: {
        elements: ['neutral'],
        items: ['attunement_charm'],
        itemParams: { attunement_charm: { element: 'grove' } },
        abilities: ['antidote'],
      },
      black: TWO_BLACK,
      moves: ['e4d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'antidote',
      attuned: true,
    });
    expect(
      eventsOf(r.events, 'EffectFizzled')
        .filter((e) => e.reason === 'protected')
        .map((e) => e.ability),
    ).toEqual(['poisoned_meat', 'riposte']);
    expect(idAt(r.state, 'd5')).toBe(1);
    // The Charm's effect is observable, so it is revealed (8.2).
    expect(r.state.reveals.white.items).toContain('attunement_charm');
  });

  it('R-ABIL-005 R-ELEM-003 attuned Antidote vs attuned Poisoned Meat (both Grove): the surviving captor has its set revealed', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['grove'], abilities: ['antidote'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { ability: 'antidote', attuned: true },
      { ability: 'poisoned_meat', attuned: true },
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { ability: 'poisoned_meat', reason: 'protected', target: KNIGHT },
    ]);
    expect(idAt(r.state, 'd5')).toBe(KNIGHT);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['antidote']);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Grove Antidote is silenced by an Ember victim, so Poisoned Meat removes the knight', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['grove'], abilities: ['antidote'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Silenced white antidote',
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      {
        side: 'white',
        piece: KNIGHT,
        pieceType: 'knight',
        ability: 'antidote',
        category: 'CAPTURING',
        by: PAWN,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'antidote',
      ),
    ).toMatchObject([{ side: 'white', cause: 'silenced' }]);
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
  });

  it('R-ABIL-005 DD-35 R-RULES-004 INV-07 Royal Immunity intercepts before Antidote: a king captor fizzles the retaliation as royal_immunity', () => {
    // e1 K=0, e2 p=1, e8 k=2
    const r = scenario({
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual([
      'antidote',
      'poisoned_meat',
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { ability: 'poisoned_meat', reason: 'royal_immunity', target: 0 },
    ]);
    expect(idAt(r.state, 'e2')).toBe(0);
  });

  it('R-ABIL-005 DD-35 INV-03 INV-03 intercepts before Antidote: a shielding captor fizzles the retaliation as inv03', () => {
    // a1 K=0, f3 N=1, e5 p=2, a8 k=3, h8 q=4
    const r = scenario({
      fen: 'k6q/8/8/4p3/8/5N2/8/K7 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['f3e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { ability: 'poisoned_meat', reason: 'inv03', target: 1 },
    ]);
    expect(idAt(r.state, 'e5')).toBe(1);
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 DD-35 R-ELEM-001 a Stone captor: Bulwark fizzles the first effect capture and Antidote (not consumed) fizzles the second', () => {
    const r = scenario({
      fen: TWO_FEN,
      white: { elements: ['stone'], abilities: ['antidote'] },
      black: TWO_BLACK,
      moves: ['e4d5'],
    });
    // Stone and Ember are in different triangles: nothing is silenced.
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(
      eventsOf(r.events, 'EffectFizzled')
        .filter((e) => e.target === 1)
        .map((e) => `${e.ability} ${e.reason}`),
    ).toEqual(['poisoned_meat bulwark', 'riposte protected']);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(idAt(r.state, 'd5')).toBe(1);
    expect((r.state.slices['bulwark'] as BulwarkState).spent).toEqual([1]);
  });

  it('R-ABIL-005 R-ABIL-002 Antidote protects only its bearer: Backdraft still removes a neighbouring pawn', () => {
    // e1 K=0, a2 P=1, c3 N=2, e4 P=3, d5 p=4, e8 k=5
    const r = scenario({
      fen: '4k3/8/8/3p4/4P3/2N5/P7/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured')).toMatchObject([
      { victim: 4, by: 'move' },
      { victim: 3, by: 'effect', source: { id: 'backdraft' } },
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(idAt(r.state, 'd5')).toBe(2);
  });

  it('R-ABIL-005 R-ABIL-002 the protection lasts only for this action: a later Cleave removes the pawn', () => {
    // e1 K=0, c4 N=1, e4 P=2, d5 p=3, c8 r=4, h8 k=5
    const r = scenario({
      fen: '2r4k/8/8/3p4/2N1P3/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['cleave'] },
      moves: ['e4d5', 'c8c4'],
    });
    // Ply 1: Antidote fires for the capturing pawn, with nothing to stop.
    expect(eventsOf(r.steps[0]?.events ?? [], 'AbilityTriggered')).toMatchObject([
      { side: 'white', piece: 2, ability: 'antidote' },
    ]);
    // Ply 2: Cleave effect-captures the d5 pawn (diagonally adjacent to c4); nothing fizzles.
    const ply2 = r.steps[1]?.events ?? [];
    expect(eventsOf(ply2, 'Captured')).toMatchObject([
      { victim: 1, by: 'move', square: sq('c4') },
      { victim: 2, by: 'effect', square: sq('d5'), source: { id: 'cleave' } },
    ]);
    expect(eventsOf(ply2, 'EffectFizzled')).toEqual([]);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ABIL-005 R-ABIL-002 Antidote does not stop move captures: a Riposte bonus capture still takes the bishop', () => {
    // e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6
    const r = scenario({
      fen: '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['antidote'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['d3g6'],
      answers: [pickMove('h7g6')],
    });
    expect(eventsOf(r.events, 'Captured')).toMatchObject([
      { victim: 2, by: 'move', depth: 0 },
      { victim: 1, by: 'move', depth: 1, captor: 4 },
    ]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(idAt(r.state, 'g6')).toBe(4);
  });
});
