/**
 * Poisoned Meat (5.7, 13.5 example): Captured, Grove, all. "Effect-capture the captor." Attuned:
 * "If the captor survives, reveal all its abilities."
 *
 * Expected behaviour comes from spec 4.1 (INV-03, INV-07), 4.2, 4.4, 5.1-5.7, 6.2, 6.3, 8.2 and
 * DD-17 to DD-40, not from the engine.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type GameState,
  type PieceType,
  type Side,
  squareName,
} from '@chain-theorem/rules';
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
      case 'PieceMoved':
        out.push(`${d}PieceMoved #${e.piece} ${squareName(e.from)}-${squareName(e.to)}`);
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

/** Poisoned Meat's own REVEAL events (the attuned set reveal). */
function pmReveals(events: readonly BattleEvent[]) {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.cause === 'effect' && e.source?.kind === 'ability' && e.source.id === 'poisoned_meat',
  );
}

// e1 K=0, c3 N=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
const KNIGHT = 1;
const PAWN = 2;
// e1 K=0, e2 p=1, e8 k=2
const KING_FEN = '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1';
// a1 K=0, f3 N=1, e5 p=2, a8 k=3, h8 q=4. On e5 the knight blocks the h8 queen's diagonal to a1.
const PIN_FEN = 'k6q/8/8/4p3/8/5N2/8/K7 w - - 0 1';
/** Six sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king. */
const sets6 = (by: Partial<Record<PieceType, string[]>>): string[][] =>
  (['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const).map((t) => by[t] ?? []);

describe('Poisoned Meat', () => {
  it('R-ABIL-005 R-ABIL-001 module data matches the 5.7 catalogue row (Captured, Grove, all, level 2, 1 slot)', () => {
    const def = abilityById.get('poisoned_meat');
    expect(def?.category).toBe('CAPTURED');
    expect(def?.affinity).toBe('grove');
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(2);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it('R-ABIL-005 R-ABIL-002 R-INFO-002 base: effect-captures the captor; the effect capture names its source', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'black',
      piece: PAWN,
      pieceType: 'pawn',
      category: 'CAPTURED',
      attuned: false,
    });
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({
      victim: KNIGHT,
      victimSide: 'white',
      victimType: 'knight',
      square: sq('d5'),
      by: 'effect',
      captor: PAWN,
      source: { kind: 'ability', id: 'poisoned_meat', piece: PAWN, side: 'black' },
    });
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
    expect(r.state.pieces[PAWN]?.square).toBe(-1);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat',
      ),
    ).toMatchObject([{ side: 'black', cause: 'activated' }]);
    // Base version reveals nothing about the captor.
    expect(pmReveals(r.events)).toEqual([]);
  });

  it("R-ABIL-005 R-ABIL-004 an effect capture never triggers the removed captor's Captured abilities", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['last_word', 'poisoned_meat'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => `${e.side} ${e.ability}`)).toEqual([
      'black poisoned_meat',
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(2);
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual([]);
  });

  it('R-ABIL-005 R-RULES-004 INV-02 INV-07 a king captor survives: the retaliation fizzles by Royal Immunity', () => {
    const r = scenario({
      fen: KING_FEN,
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    expect(idAt(r.state, 'e2')).toBe(0);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { side: 'black', piece: 1, ability: 'poisoned_meat', reason: 'royal_immunity', target: 0 },
    ]);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(r.state.result).toBeNull();
  });

  it('R-ABIL-005 INV-03 removing a captor that shields its own king fizzles (knight on the a1-h8 diagonal)', () => {
    const r = scenario({
      fen: PIN_FEN,
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['f3e5'],
    });
    expect(idAt(r.state, 'e5')).toBe(1);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { side: 'black', piece: 2, ability: 'poisoned_meat', reason: 'inv03', target: 1 },
    ]);
    expect(r.state.inCheck).toBeNull();
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
  });

  it('R-ABIL-005 INV-03 R-RULES-003 DD-32 INV-03 guards only an ordinary king: with a Stalwart king the retaliation resolves and Stalwart is revealed', () => {
    const r = scenario({
      fen: PIN_FEN,
      white: { elements: ['neutral'], sets: sets6({ king: ['stalwart'] }) },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['f3e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(r.events, 'Captured')).toMatchObject([
      { victim: 2, by: 'move' },
      { victim: 1, by: 'effect', square: sq('e5') },
    ]);
    expect(revealedOn(r.state, 'white', 'king')).toEqual(['stalwart']);
    expect(eventsOf(r.events, 'Check')).toMatchObject([{ side: 'white', square: sq('a1') }]);
    expect(r.state.inCheck).toBe('white');
    expect(r.state.result).toBeNull();
  });

  it("R-ABIL-005 R-ELEM-003 R-RULES-004 DD-28 attuned (Grove bearer): the surviving king captor's set is revealed, Stalwart included", () => {
    const r = scenario({
      fen: KING_FEN,
      white: { elements: ['neutral'], sets: sets6({ king: ['stalwart'], knight: ['scout'] }) },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { side: 'black', ability: 'poisoned_meat', attuned: true },
    ]);
    const fizzle = eventsOf(r.events, 'EffectFizzled');
    expect(fizzle).toMatchObject([{ ability: 'poisoned_meat', reason: 'royal_immunity' }]);
    const reveals = pmReveals(r.events);
    expect(reveals).toMatchObject([
      {
        side: 'white',
        info: { kind: 'set', pieceType: 'king', abilities: ['stalwart'] },
        cause: 'effect',
        source: { kind: 'ability', id: 'poisoned_meat', piece: 1, side: 'black' },
      },
    ]);
    expect(r.events.indexOf(fizzle[0] as BattleEvent)).toBeLessThan(
      r.events.indexOf(reveals[0] as BattleEvent),
    );
    expect(revealedOn(r.state, 'white', 'king')).toEqual(['stalwart']);
    expect(r.state.reveals.white.complete).toEqual(['king']);
    expect(r.state.reveals.white.abilities.knight).toBeUndefined();
    expect(idAt(r.state, 'e2')).toBe(0);
  });

  it('R-ABIL-005 R-ELEM-003 INV-03 attuned: a captor saved by INV-03 has its set revealed', () => {
    const r = scenario({
      fen: PIN_FEN,
      white: { elements: ['neutral'], sets: sets6({ knight: ['last_word'] }) },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['f3e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([{ reason: 'inv03', target: 1 }]);
    expect(pmReveals(r.events)).toMatchObject([
      { side: 'white', info: { kind: 'set', pieceType: 'knight', abilities: ['last_word'] } },
    ]);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(idAt(r.state, 'e5')).toBe(1);
  });

  it('R-ABIL-005 R-ELEM-003 attuned: a removed captor is not revealed (the condition "if the captor survives" fails)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], sets: sets6({ knight: ['hit_and_run', 'rebirth'] }) },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'poisoned_meat',
      attuned: true,
    });
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
    expect(pmReveals(r.events)).toEqual([]);
    expect(r.state.reveals.white.complete).toEqual([]);
    // Only the knight's activated / fizzled ability is known, not its whole set.
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['hit_and_run']);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Grove Poisoned Meat is silenced by an Ember captor: revealed by name, the captor survives', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['ember'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Silenced black poisoned_meat',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      {
        side: 'black',
        piece: PAWN,
        pieceType: 'pawn',
        ability: 'poisoned_meat',
        category: 'CAPTURED',
        by: KNIGHT,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat',
      ),
    ).toMatchObject([{ side: 'black', cause: 'silenced' }]);
    expect(idAt(r.state, 'd5')).toBe(KNIGHT);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
  });

  it('R-ABIL-005 R-ELEM-001 Bulwark stops only the first Poisoned Meat against a Stone piece each battle', () => {
    // e1 K=0, c3 N=1, d5 p=2, f6 p=3, e8 k=4
    const r = scenario({
      fen: '4k3/8/5p2/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8d8', 'd5f6'],
    });
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'EffectFizzled')).toMatchObject([
      {
        side: 'black',
        piece: 2,
        ability: 'poisoned_meat',
        reason: 'bulwark',
        target: 1,
        source: { kind: 'trait', id: 'bulwark' },
      },
    ]);
    expect(eventsOf(first, 'Captured')).toHaveLength(1);
    const third = r.steps[2]?.events ?? [];
    expect(eventsOf(third, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(third, 'Captured')).toMatchObject([
      { victim: 3, by: 'move' },
      { victim: 1, by: 'effect', square: sq('f6'), captor: 3 },
    ]);
    expect(r.state.pieces[1]?.square).toBe(-1);
  });

  it('R-ABIL-005 R-RULES-001 en passant is a move capture: Poisoned Meat removes the capturing pawn from d6', () => {
    // e1 K=0, e5 P=1, d7 p=2, e8 k=3
    const r = scenario({
      fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['d7d5', 'e5d6'],
    });
    const caps = eventsOf(r.steps[1]?.events ?? [], 'Captured');
    expect(caps).toMatchObject([
      { victim: 2, by: 'move', captor: 1, square: sq('d5') },
      { victim: 1, by: 'effect', captor: 2, square: sq('d6') },
    ]);
    expect(eventsOf(r.steps[1]?.events ?? [], 'MoveMade')[0]).toMatchObject({ enPassant: true });
    expect(pieceAt(r.state, 'd6')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });
});
