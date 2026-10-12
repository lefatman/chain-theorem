/**
 * Ricochet (5.7; designer brief 2026-10-09, plan item C6; DD-124): Captures, neutral, bishops, rooks
 * and queens, 2 charges. "After capturing, continue one square past the capture square in the
 * direction of the move, if that square is empty." The CONTINUE square selector names that square.
 *
 * Expected behaviour comes from spec 5.2 (MOVE), 5.4 (INV-03 before any effect; self-acting effects;
 * charges), 6.1 (Hot Foot: leaving the capture square ignites it, burning squares cannot be entered),
 * 7.3 (ineligible types idle), DD-17 (a fizzle spends no charge), DD-111 (turned paths) and DD-124,
 * not from the engine.
 */
import { describe, expect, it } from 'vitest';
import { squareName } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, scenario } from '../src/testing.ts';

const moved = (events: readonly { k: string }[]) =>
  eventsOf(events as never, 'PieceMoved').map(
    (e) => `${e.piece}:${squareName(e.from)}-${squareName(e.to)}`,
  );
const fizzles = (events: readonly { k: string }[]) =>
  eventsOf(events as never, 'EffectFizzled').map((e) => `${e.ability}:${e.reason}`);
const charges = (events: readonly { k: string }[]) =>
  eventsOf(events as never, 'ChargeSpent').map((e) => [e.ability, e.remaining]);

describe('Ricochet (5.7, DD-124)', () => {
  it('R-ABIL-005 module data: Captures, neutral, bishops, rooks and queens, level 8, 1 slot, 2 charges, moves itself to the CONTINUE square', () => {
    const def = abilityById.get('ricochet');
    expect(def).toMatchObject({
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: ['bishop', 'rook', 'queen'],
      tags: [],
      minLevel: 8,
      slotCost: 1,
      limits: { perAction: 1, charges: 2 },
      effects: [{ op: 'move', piece: { t: 'self' }, to: { s: 'continue' } }],
    });
    expect(def?.conditions).toBeUndefined();
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-003 DD-124 a rook takes along the file and continues one square: d1xd5, then d6; a charge is spent and Ricochet is revealed on the rooks', () => {
    // Ids: d1 R=0, e1 K=1, d5 p=2, e8 k=3.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['d1d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([[2, 'move']]);
    expect(moved(r.events)).toEqual(['0:d5-d6']);
    expect(idAt(r.state, 'd6')).toBe(0);
    expect(idAt(r.state, 'd5')).toBe(-1);
    expect(charges(r.events)).toEqual([['ricochet', 1]]);
    expect(r.state.reveals.white.abilities.rook).toEqual(['ricochet']);
    expect(fizzles(r.events)).toEqual([]);
  });

  it('DD-124 a bishop continues along its diagonal: c1xe3, then f4', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/4p3/8/2B1K3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['c1e3'],
    });
    expect(moved(r.events)).toEqual(['0:e3-f4']);
    expect(idAt(r.state, 'f4')).toBe(0);
  });

  it('DD-124 the square beyond is occupied: the move fizzles occupied and no charge is spent (queen a1xd1, e1 holds the king)', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/8/8/Q2nK3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['a1d1'],
    });
    expect(fizzles(r.events)).toEqual(['ricochet:occupied']);
    expect(moved(r.events)).toEqual([]);
    expect(idAt(r.state, 'd1')).toBe(0);
    expect(charges(r.events)).toEqual([]);
  });

  it('DD-124 the step leaves the board: a1xa8 has no square beyond and fizzles no_target', () => {
    const r = scenario({
      fen: 'n3k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['a1a8'],
    });
    expect(fizzles(r.events)).toEqual(['ricochet:no_target']);
    expect(idAt(r.state, 'a8')).toBe(0);
    expect(charges(r.events)).toEqual([]);
  });

  it('DD-124 DD-111 a capture made through an Electric Slide turn has no line to continue on: the Storm bishop c1 turns at its rook e3 to take c5 and stays there (no_target)', () => {
    // Ids: c1 B=0, e1 K=1, e3 R=2, c5 p=3, e8 k=4. c1-c5 is a file, which a bishop does not slide on.
    const r = scenario({
      fen: '4k3/8/8/2p5/8/4R3/8/2B1K3 w - - 0 1',
      white: { elements: ['storm'], abilities: ['electric_slide', 'ricochet'] },
      moves: ['c1c5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([[3, 'move']]);
    expect(fizzles(r.events)).toEqual(['ricochet:no_target']);
    expect(idAt(r.state, 'c5')).toBe(0);
    expect(charges(r.events)).toEqual([]);
  });

  it('INV-03 the continuation would uncover the own king: the rook that took d5 shields a5 from the rook h5 and stays (inv03)', () => {
    // Ids: d1 R=0, a5 K=1, d5 p=2, h5 r=3, e8 k=4.
    const r = scenario({
      fen: '4k3/8/8/K2p3r/8/8/8/3R4 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['d1d5'],
    });
    expect(fizzles(r.events)).toEqual(['ricochet:inv03']);
    expect(idAt(r.state, 'd5')).toBe(0);
    expect(charges(r.events)).toEqual([]);
  });

  it('R-ELEM-005 a burning square stops it: the Ember knight ignited d6, so the rook that takes d5 fizzles burning', () => {
    // Black (Ember) knight c4 takes the pawn d6 and leaves it two plies later, igniting d6; White's
    // rook then takes d5 and cannot continue onto the burning square.
    // Ids: d1 R=0, e1 K=1, h2 P=2, c4 n=3, d5 p=4, d6 P=5, e8 k=6.
    const r = scenario({
      fen: '4k3/8/3P4/3p4/2n5/8/7P/3RK3 b - - 0 1',
      white: { abilities: ['ricochet'] },
      black: { elements: ['ember'] },
      moves: ['c4d6', 'h2h3', 'd6b7', 'd1d5'],
    });
    expect(eventsOf(r.events, 'SquareIgnited').map((e) => squareName(e.square))).toEqual(['d6']);
    const last = r.steps[3]?.events ?? [];
    expect(fizzles(last)).toEqual(['ricochet:burning']);
    expect(idAt(r.state, 'd5')).toBe(0);
    expect(charges(last)).toEqual([]);
  });

  it('R-ELEM-005 and the other way round: an Ember rook that ricochets off its capture square ignites it', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['ricochet'] },
      moves: ['d1d5'],
    });
    expect(moved(r.events)).toEqual(['0:d5-d6']);
    expect(eventsOf(r.events, 'SquareIgnited').map((e) => squareName(e.square))).toEqual(['d5']);
  });

  it('R-ABIL-004 DD-17 two charges per piece: the rook continues twice, the third capture stays put', () => {
    // Ids: a1 R=0, e1 K=1, a3 p=2, a6 p=3, b7 p=4, e8 k=5.
    const r = scenario({
      fen: '4k3/1p6/p7/8/8/p7/8/R3K3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['a1a3', 'e8f8', 'a4a6', 'f8e8', 'a7b7'],
    });
    expect(moved(r.events)).toEqual(['0:a3-a4', '0:a6-a7']);
    expect(charges(r.events)).toEqual([
      ['ricochet', 1],
      ['ricochet', 0],
    ]);
    const last = r.steps[4]?.events ?? [];
    expect(eventsOf(last, 'AbilityTriggered')).toEqual([]);
    expect(idAt(r.state, 'b7')).toBe(0);
    expect(r.state.usage['0:ricochet']).toBe(2);
  });

  it('R-LOAD-003 7.3 a knight in an army-wide set with Ricochet idles: c3xd5 triggers nothing', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['ricochet'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    // Ids: e1 K=0, c3 N=1, d5 p=2, e8 k=3.
    expect(idAt(r.state, 'd5')).toBe(1);
  });
});
