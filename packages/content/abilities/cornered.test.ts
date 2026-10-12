/**
 * Cornered (5.7; designer brief 2026-10-09, plan item C6; DD-123): Captured, neutral, all, 1 charge.
 * "When captured on a rim square (the a- or h-file, the first or eighth rank), effect-capture the
 * captor." The rim test is the ZONE trigger condition: off the rim the card does not trigger at all.
 *
 * Expected behaviour comes from spec 4.1 (INV-07), 5.1-5.6 (conditions gate the trigger: no event,
 * no reveal, no charge), 5.4 (a captured piece uses the square it was captured on), 8.2, DD-17
 * (a fizzle spends no charge), DD-36 (negation), DD-102 (Stalwart: no venom tag) and DD-123, not
 * from the engine.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, scenario } from '../src/testing.ts';

describe('Cornered (5.7, DD-123)', () => {
  it('R-ABIL-005 module data: Captured, neutral, all, level 4, 1 slot, 1 charge, a rim ZONE condition on the victim, effect-captures the captor', () => {
    const def = abilityById.get('cornered');
    expect(def).toMatchObject({
      category: 'CAPTURED',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 4,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ zone: { of: 'victim', is: 'rim' } }],
      effects: [{ op: 'effectCapture', target: { t: 'captor' } }],
    });
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-003 R-ABIL-004 DD-123 captured on the a-file: the pawn takes the rook with it, the charge is spent and Cornered is revealed on the pawns', () => {
    // Ids: a1 R=0, e1 K=1, a5 p=2, e8 k=3.
    const r = scenario({
      fen: '4k3/8/8/p7/8/8/8/R3K3 w - - 0 1',
      black: { abilities: ['cornered'] },
      moves: ['a1a5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [2, 'move'],
      [0, 'effect'],
    ]);
    expect(idAt(r.state, 'a5')).toBe(-1);
    expect(r.state.pieces[0]?.square).toBe(-1);
    expect(eventsOf(r.events, 'ChargeSpent').map((e) => [e.ability, e.remaining])).toEqual([
      ['cornered', 0],
    ]);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['cornered']);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
  });

  it('R-ABIL-004 DD-123 off the rim the condition fails and nothing happens: no trigger, no reveal, no charge, the rook stays', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      black: { abilities: ['cornered'] },
      moves: ['d1d5'],
    });
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([[2, 'move']]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.events, 'Revealed')).toEqual([]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(0);
    expect(r.state.reveals.black.abilities.pawn ?? []).toEqual([]);
  });

  it.each([
    ['the h-file', '4k3/8/8/7p/8/8/8/4K2R w - - 0 1', 'h1h5', 'white'],
    ['the eighth rank', '3nk3/8/8/8/8/8/8/3RK3 w - - 0 1', 'd1d8', 'white'],
    ['the first rank', '1r2k3/8/8/8/8/8/8/1N2K3 b - - 0 1', 'b8b1', 'black'],
  ])(
    'DD-123 every edge is the rim: a capture on %s removes the captor',
    (_edge, fen, move, captorSide) => {
      const victimSide = captorSide === 'white' ? 'black' : 'white';
      const r = scenario({
        fen,
        [victimSide]: { abilities: ['cornered'] },
        moves: [move],
      });
      const captured = eventsOf(r.events, 'Captured');
      expect(captured.map((e) => e.by)).toEqual(['move', 'effect']);
      expect(captured[1]?.victimSide).toBe(captorSide);
      expect(idAt(r.state, move.slice(2))).toBe(-1);
    },
  );

  it('R-RULES-004 INV-07 a king capturing on the rim is immune: the effect fizzles royal_immunity, the king stays and no charge is spent', () => {
    // Ids: h1 K=0, h2 n=1, e8 k=2.
    const r = scenario({
      fen: '4k3/8/8/8/8/8/7n/7K w - - 0 1',
      black: { abilities: ['cornered'] },
      moves: ['h1h2'],
    });
    expect(eventsOf(r.events, 'EffectFizzled').map((e) => [e.ability, e.reason])).toEqual([
      ['cornered', 'royal_immunity'],
    ]);
    expect(idAt(r.state, 'h2')).toBe(0);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    // The trigger itself is public (8.2): the knights are known to carry Cornered.
    expect(r.state.reveals.black.abilities.knight).toEqual(['cornered']);
  });

  it('R-ABIL-002 DD-36 Pierce negates Cornered: the rook survives and the negated card spends no charge', () => {
    const r = scenario({
      fen: '4k3/8/8/p7/8/8/8/R3K3 w - - 0 1',
      white: { abilities: ['pierce'] },
      black: { abilities: ['cornered'] },
      moves: ['a1a5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['cornered']);
    expect(idAt(r.state, 'a5')).toBe(0);
    expect(eventsOf(r.events, 'ChargeSpent').map((e) => e.ability)).toEqual(['pierce']);
  });

  it('DD-102 a Stalwart captor is not removed (Cornered has no venom tag): the effect fizzles stalwart_guard and no charge is spent', () => {
    const r = scenario({
      fen: '4k3/8/8/p7/8/8/8/R3K3 w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['cornered'] },
      moves: ['a1a5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled').map((e) => [e.ability, e.reason])).toEqual([
      ['cornered', 'stalwart_guard'],
    ]);
    expect(idAt(r.state, 'a5')).toBe(0);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });

  it('R-ABIL-004 DD-17 one charge per piece: a Cornered pawn revived by Rebirth and captured on the rim again bites no second time', () => {
    // White rooks a1 and b1, king e1; Black pawn a5 (Cornered, Rebirth; start a5), king e8. The rook a1
    // takes the pawn and dies; Rebirth puts the pawn back on a5 at chain end; the rook b1 comes round
    // by b5 and takes it again on the same rim square.
    // Ids: a1 R=0, b1 R=1, e1 K=2, a5 p=3, e8 k=4.
    const r = scenario({
      fen: '4k3/8/8/p7/8/8/8/RR2K3 w - - 0 1',
      black: { abilities: ['cornered', 'rebirth'] },
      moves: ['a1a5', 'e8f8', 'b1b5', 'f8e8', 'b5a5'],
    });
    expect(eventsOf(r.events, 'PieceRevived').map((e) => e.piece)).toEqual([3]);
    const last = r.steps[4];
    expect(eventsOf(last?.events ?? [], 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [3, 'move'],
    ]);
    expect(eventsOf(last?.events ?? [], 'AbilityTriggered').map((e) => e.ability)).toEqual([]);
    expect(idAt(r.state, 'a5')).toBe(1);
    expect(r.state.usage['3:cornered']).toBe(1);
  });

  it('INV-03 the captor is spared when removing it would expose the acting side’s king: the effect fizzles inv03', () => {
    // White king h1, white rook h4 takes the Cornered pawn h7 (a rim square); the black rook h8 looks
    // down the h-file and the white rook on h7 is now the only piece between it and the king, so
    // effect-capturing the rook would expose h1: Cornered fizzles inv03.
    // Ids: h1 K=0, h4 R=1, h7 p=2, e8 k=3, h8 r=4.
    const r = scenario({
      fen: '4k2r/7p/8/8/7R/8/8/7K w - - 0 1',
      black: { abilities: ['cornered'] },
      moves: ['h4h7'],
    });
    expect(eventsOf(r.events, 'EffectFizzled').map((e) => [e.ability, e.reason])).toEqual([
      ['cornered', 'inv03'],
    ]);
    expect(idAt(r.state, 'h7')).toBe(1);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });
});
