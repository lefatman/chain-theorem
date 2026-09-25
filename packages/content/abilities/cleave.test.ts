/**
 * Cleave scenario tests (R-ABIL-005, spec 5.7): Captures, Ember, all pieces. After a move capture,
 * effect-capture one enemy pawn diagonally adjacent to the landing square. Attuned (Ember bearer):
 * an orthogonally adjacent pawn may be picked instead.
 *
 * Expected behaviour comes from spec 4.1 (INV-03), 4.4, 5.1-5.7, 6.2, 6.3, 8.2 and DD-17/18/19, not
 * from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '@chain-theorem/rules';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;

function indexOf(events: readonly BattleEvent[], pred: (e: BattleEvent) => boolean): number {
  return events.findIndex(pred);
}

describe('cleave (R-ABIL-005)', () => {
  it('R-ABIL-005 R-ABIL-003 cleave effect-captures the single enemy pawn diagonally adjacent to the landing square, without a prompt (DD-18)', () => {
    // Knight c3 takes d5. Black pawns on c6 (diagonal to d5) and d6 (orthogonal).
    const fen = '4k3/8/2pp4/3p4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    const knight = idAt(r.initial, 'c3');
    const c6 = idAt(r.initial, 'c6');

    expect(r.prompts).toHaveLength(0);
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(pieceAt(r.state, 'c6')).toBeUndefined();
    expect(pieceAt(r.state, 'd6')?.type).toBe('pawn');
    expect(r.state.pieces[c6]?.square).toBe(-1);

    const captured = eventsOf(r.events, 'Captured');
    expect(captured.map((e) => [e.square, e.by])).toEqual([
      [sq('d5'), 'move'],
      [sq('c6'), 'effect'],
    ]);
    const cut = captured[1];
    expect(cut?.victim).toBe(c6);
    expect(cut?.captor).toBe(knight);
    expect(cut?.source).toEqual({ kind: 'ability', id: 'cleave', piece: knight, side: 'white' });

    // Phase order (5.3): Captured (move) -> MoveMade -> Captures trigger -> effect capture.
    const iMoveCap = indexOf(r.events, (e) => e.k === 'Captured' && e.by === 'move');
    const iMove = indexOf(r.events, (e) => e.k === 'MoveMade');
    const iTrig = indexOf(r.events, (e) => e.k === 'AbilityTriggered' && e.ability === 'cleave');
    const iCut = indexOf(r.events, (e) => e.k === 'Captured' && e.by === 'effect');
    expect(iMoveCap).toBeGreaterThanOrEqual(0);
    expect(iMoveCap).toBeLessThan(iMove);
    expect(iMove).toBeLessThan(iTrig);
    expect(iTrig).toBeLessThan(iCut);
    const trig = eventsOf(r.events, 'AbilityTriggered')[0];
    expect(trig).toMatchObject({
      side: 'white',
      piece: knight,
      pieceType: 'knight',
      category: 'CAPTURES',
      attuned: false,
    });
  });

  it('R-ABIL-005 R-INFO-002 cleave is revealed by name with the piece type it fired on', () => {
    const fen = '4k3/8/2pp4/3p4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    const revealed = eventsOf(r.events, 'Revealed').filter((e) => e.side === 'white');
    expect(revealed).toContainEqual(
      expect.objectContaining({
        info: { kind: 'ability', pieceType: 'knight', ability: 'cleave' },
        cause: 'activated',
      }),
    );
    expect(r.state.reveals.white.abilities.knight).toContain('cleave');
    // The opponent's projection names it once revealed (8.5).
    const pub = r.engine.projectEvents(r.state, r.events, 'black');
    expect(pub.find((e) => e.k === 'AbilityTriggered')).toMatchObject({ ability: 'cleave' });
  });

  it("R-ABIL-005 DD-18 cleave with several diagonal pawns prompts the captor's owner in square order; the chosen pawn is captured", () => {
    // Diagonal to d5: black pawns e4 and c6 (targets), black knight e6 (not a pawn), white pawn c4
    // (friendly). Neither the knight nor the friendly pawn is ever offered.
    const fen = '4k3/8/2p1n3/3p4/2P1p3/2N5/8/4K3 w - - 0 1';
    const probe = scenario({ fen, white: { abilities: ['cleave'] } });
    const e4 = idAt(probe.initial, 'e4');
    const c6 = idAt(probe.initial, 'c6');
    const r = scenario({
      fen,
      white: { abilities: ['cleave'] },
      moves: ['c3d5'],
      answers: [{ kind: 'piece', piece: c6, square: sq('c6') }],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0];
    expect(req?.chooser).toBe('white');
    expect(req?.kind).toBe('target');
    expect(req?.source.ability).toBe('cleave');
    // Mandatory selection: no Decline (DD-18); white's square order a1..h8 (5.4).
    expect(req?.options).toEqual([
      { kind: 'piece', piece: e4, square: sq('e4') },
      { kind: 'piece', piece: c6, square: sq('c6') },
    ]);
    expect(req?.defaultOption).toBe(0);

    expect(pieceAt(r.state, 'c6')).toBeUndefined();
    expect(pieceAt(r.state, 'e4')?.id).toBe(e4);
    expect(pieceAt(r.state, 'e6')?.type).toBe('knight');
    expect(pieceAt(r.state, 'c4')?.side).toBe('white');
    expect(eventsOf(r.events, 'ChoiceMade')).toHaveLength(1);
    expect(eventsOf(r.events, 'Captured').filter((e) => e.by === 'effect')).toHaveLength(1);
  });

  it('R-ABIL-005 5.4 cleave: an unanswered prompt takes the first valid option in square order', () => {
    const fen = '4k3/8/2p1n3/3p4/2P1p3/2N5/8/4K3 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    expect(r.prompts).toHaveLength(1);
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(pieceAt(r.state, 'c6')?.type).toBe('pawn');
  });

  it("R-ABIL-005 5.4 cleave for black orders options from black's side (a8 first) and defaults to the first", () => {
    // Black knight f6 takes e4; white pawns d3 and f5 are diagonal to e4. From black's side f5 comes
    // before d3 (rank 5 is nearer black's back rank).
    const fen = '4k3/8/5n2/5P2/4P3/3P4/8/4K3 b - - 0 1';
    const r = scenario({ fen, black: { abilities: ['cleave'] }, moves: ['f6e4'] });
    const f5 = idAt(r.initial, 'f5');
    const d3 = idAt(r.initial, 'd3');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.chooser).toBe('black');
    expect(r.prompts[0]?.options).toEqual([
      { kind: 'piece', piece: f5, square: sq('f5') },
      { kind: 'piece', piece: d3, square: sq('d3') },
    ]);
    expect(pieceAt(r.state, 'f5')).toBeUndefined();
    expect(pieceAt(r.state, 'd3')?.id).toBe(d3);
  });

  it('R-ABIL-005 cleave with no enemy pawn diagonally adjacent fizzles without a target and removes nothing', () => {
    // Diagonal to d5: black bishop c6 (not a pawn) and white pawn e6 (friendly); d6 is orthogonal.
    const fen = '4k3/8/2bpP3/3p4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    expect(r.prompts).toHaveLength(0);
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    const fizzled = eventsOf(r.events, 'EffectFizzled');
    expect(fizzled).toHaveLength(1);
    expect(fizzled[0]).toMatchObject({ ability: 'cleave', reason: 'no_target', side: 'white' });
    expect(pieceAt(r.state, 'c6')?.type).toBe('bishop');
    expect(pieceAt(r.state, 'd6')?.type).toBe('pawn');
    expect(pieceAt(r.state, 'e6')?.side).toBe('white');
  });

  it('R-ABIL-005 R-ELEM-003 cleave attuned: an Ember bearer cuts an orthogonally adjacent pawn that the base version cannot reach', () => {
    // Only d6 (orthogonal to d5) holds an enemy pawn.
    const fen = '4k3/8/3p4/3p4/8/2N5/8/4K3 w - - 0 1';
    const attuned = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['cleave'] },
      moves: ['c3d5'],
    });
    const d6 = idAt(attuned.initial, 'd6');
    expect(eventsOf(attuned.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'cleave',
      attuned: true,
    });
    expect(attuned.prompts).toHaveLength(0);
    expect(pieceAt(attuned.state, 'd6')).toBeUndefined();
    expect(eventsOf(attuned.events, 'Captured').find((e) => e.by === 'effect')?.victim).toBe(d6);

    const base = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    expect(eventsOf(base.events, 'AbilityTriggered')[0]).toMatchObject({ attuned: false });
    expect(pieceAt(base.state, 'd6')?.id).toBe(d6);
    expect(eventsOf(base.events, 'Captured').filter((e) => e.by === 'effect')).toHaveLength(0);
  });

  it('R-ABIL-005 R-ELEM-003 DD-18 cleave attuned offers diagonal and orthogonal pawns together in square order', () => {
    const fen = '4k3/8/2pp4/3p4/8/2N5/8/4K3 w - - 0 1';
    const probe = scenario({ fen });
    const c6 = idAt(probe.initial, 'c6');
    const d6 = idAt(probe.initial, 'd6');
    const r = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['cleave'] },
      moves: ['c3d5'],
      answers: [{ kind: 'piece', piece: d6, square: sq('d6') }],
    });
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.options).toEqual([
      { kind: 'piece', piece: c6, square: sq('c6') },
      { kind: 'piece', piece: d6, square: sq('d6') },
    ]);
    expect(pieceAt(r.state, 'd6')).toBeUndefined();
    expect(pieceAt(r.state, 'c6')?.id).toBe(c6);
  });

  it('R-ABIL-005 R-ELEM-002 cleave is silenced when a Tide victim beats the Ember captor, and is revealed by name', () => {
    const fen = '4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['cleave'] },
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const victim = idAt(r.initial, 'd5');
    expect(eventsOf(r.events, 'AbilityTriggered')).toHaveLength(0);
    const silenced = eventsOf(r.events, 'AbilitySilenced');
    expect(silenced).toHaveLength(1);
    expect(silenced[0]).toMatchObject({
      side: 'white',
      piece: knight,
      ability: 'cleave',
      category: 'CAPTURES',
      by: victim,
    });
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'ability', pieceType: 'knight', ability: 'cleave' },
        cause: 'silenced',
      }),
    );
    expect(pieceAt(r.state, 'c6')?.type).toBe('pawn');
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
  });

  it('R-ABIL-004 R-ABIL-005 cleave: an earned trigger resolves from the last known landing square after Poisoned Meat removes the captor', () => {
    // Knight takes a Poisoned Meat pawn on d5; the victim's Captured trigger resolves first (5.3)
    // and removes the knight. Cleave stays queued and cuts c6, measured from d5 (5.4).
    const fen = '4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({
      fen,
      white: { abilities: ['cleave'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const c6 = idAt(r.initial, 'c6');
    expect(
      eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by, e.source?.kind ?? null]),
    ).toEqual([
      [idAt(r.initial, 'd5'), 'move', null],
      [knight, 'effect', 'ability'],
      [c6, 'effect', 'ability'],
    ]);
    const triggered = eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability);
    // Poisoned Meat fires once: Cleave's effect capture of c6 never chains (5.4).
    expect(triggered).toEqual(['poisoned_meat', 'cleave']);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(pieceAt(r.state, 'c6')).toBeUndefined();
  });

  it("R-ABIL-004 R-ABIL-005 cleave's effect capture never triggers the pawn's Captured abilities", () => {
    // Only black pawns carry Poisoned Meat (per-type sets: pawn, knight, bishop, rook, queen, king).
    const fen = '4k3/8/2p5/3n4/8/2N5/8/4K3 w - - 0 1';
    const r = scenario({
      fen,
      white: { abilities: ['cleave'] },
      black: { sets: [['poisoned_meat'], [], [], [], [], []] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(pieceAt(r.state, 'c6')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')?.id).toBe(knight);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['cleave']);
    expect(r.state.reveals.black.abilities.pawn ?? []).not.toContain('poisoned_meat');
  });

  it('R-ABIL-005 INV-03 DD-19 cleave never offers a pawn whose removal would expose the acting king; the remaining option resolves without a prompt', () => {
    // The black pawn c4 shields the white king a4 from the rook h4; e6 is the other diagonal pawn.
    const fen = '4k3/8/4p3/3p4/K1p4r/2N5/8/8 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    expect(r.prompts).toHaveLength(0);
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
    expect(pieceAt(r.state, 'c4')?.type).toBe('pawn');
    expect(r.state.inCheck).toBeNull();
    expect(eventsOf(r.events, 'Check')).toHaveLength(0);
  });

  it('R-ABIL-005 INV-03 cleave fizzles when its only target shields the acting king', () => {
    const fen = '4k3/8/8/3p4/K1p4r/2N5/8/8 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['c3d5'] });
    expect(r.prompts).toHaveLength(0);
    expect(pieceAt(r.state, 'c4')?.type).toBe('pawn');
    expect(eventsOf(r.events, 'Captured').map((e) => e.by)).toEqual(['move']);
    expect(eventsOf(r.events, 'EffectFizzled')).toContainEqual(
      expect.objectContaining({ ability: 'cleave', side: 'white' }),
    );
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 cleave is eligible on every piece type, the king included', () => {
    // White king d4 takes the pawn d5; black pawn e4 is diagonal to the landing square.
    const fen = '4k3/8/8/3p4/3Kp3/8/8/8 w - - 0 1';
    const r = scenario({ fen, white: { abilities: ['cleave'] }, moves: ['d4d5'] });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'cleave',
      pieceType: 'king',
    });
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')?.type).toBe('king');
  });
});
