/**
 * Snowbound scenario tests (R-ABIL-005, M7 7.3): Capturing, Frost, all. When capturing, before the
 * victim is removed, the owner sends one enemy knight, bishop, rook or queen adjacent to the landing
 * square back to its starting square, if empty. Attuned (Frost bearer): an enemy pawn may be chosen.
 *
 * Starting squares are the pieces' identities' starts (DD-22), so these battles begin from the
 * standard position. Expected behaviour comes from spec 5.2, 5.3 (phase 2), 5.4, 6.2, 6.3 and DD-18,
 * DD-22, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// 1.e4 e5 2.Nf3 d6 3.d4 Qf6 4.dxe5: the black queen f6 (and the pawn d6) stand next to e5.
const OPENING = ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'd2d4', 'd8f6'];
const CAPTURE = 'd4e5';

describe('snowbound (R-ABIL-005)', () => {
  it('R-ABIL-005 snowbound is a level-14, 1-slot Frost When-capturing card with 2 charges', () => {
    expect(abilityById.get('snowbound')).toMatchObject({
      category: 'CAPTURING',
      affinity: 'frost',
      eligible: 'all',
      tags: [],
      minLevel: 14,
      slotCost: 1,
      limits: { perAction: 1, charges: 2 },
    });
  });

  it('R-ABIL-005 DD-17 R-ELEM-007 a resolved send-home spends a charge; Overabundance doubles them on a Grove piece', () => {
    const r = scenario({ white: { abilities: ['snowbound'] }, moves: [...OPENING, CAPTURE] });
    const pawn = idAt(r.initial, 'd2');
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ piece: pawn, ability: 'snowbound', remaining: 1 }),
    ]);
    const grove = scenario({ white: { elements: ['grove'], abilities: ['snowbound'] } });
    expect(grove.engine.remainingCharges(grove.state, idAt(grove.state, 'd2'), 'snowbound')).toBe(
      4,
    );
  });

  it('R-ABIL-002 R-ABIL-003 before the capture resolves, the queen next to e5 is sent home to d8, so it cannot recapture', () => {
    const r = scenario({ white: { abilities: ['snowbound'] }, moves: [...OPENING, CAPTURE] });
    const queen = idAt(r.initial, 'd8');
    const events = r.steps[6]?.events ?? [];
    expect(events.map((e) => e.k).slice(0, 6)).toEqual([
      'ActionStarted',
      'AbilityTriggered',
      'Revealed',
      'PieceMoved',
      'ChargeSpent',
      'Captured',
    ]);
    expect(eventsOf(events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: queen, from: sq('f6'), to: sq('d8') }),
    ]);
    expect(pieceAt(r.state, 'd8')?.id).toBe(queen);
    expect(pieceAt(r.state, 'e5')?.side).toBe('white');
    // The pawn d6 is not a candidate for the base version.
    expect(pieceAt(r.state, 'd6')?.type).toBe('pawn');
  });

  it('R-ELEM-003 DD-18 attuned (Frost bearer): the pawn d6 is offered too, and the mover chooses in square order', () => {
    const r = scenario({
      white: { elements: ['frost'], abilities: ['snowbound'] },
      moves: [...OPENING, CAPTURE],
      answers: [0],
    });
    expect(r.prompts[0]?.chooser).toBe('white');
    expect(r.prompts[0]?.options.map((o) => (o.kind === 'piece' ? o.square : -1))).toEqual([
      sq('d6'),
      sq('f6'),
    ]);
    expect(pieceAt(r.state, 'd7')?.type).toBe('pawn');
    expect(pieceAt(r.state, 'f6')?.type).toBe('queen');
  });

  it('R-ABIL-004 an occupied starting square makes the move fizzle (occupied)', () => {
    // 4...Kd8 first: the queen's home square is taken.
    const r = scenario({
      white: { abilities: ['snowbound'] },
      moves: [...OPENING, 'b1c3', 'e8d8', CAPTURE],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'snowbound', effect: 'move', reason: 'occupied' }),
    ]);
    expect(pieceAt(r.state, 'f6')?.type).toBe('queen');
    // DD-17: a fully fizzled activation spends no charge.
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
  });

  it('R-ELEM-002 a Storm victim silences a Frost captor’s Snowbound (Storm beats Frost)', () => {
    const r = scenario({
      white: { elements: ['frost'], abilities: ['snowbound'] },
      black: { elements: ['storm'] },
      moves: [...OPENING, CAPTURE],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['snowbound']);
    expect(pieceAt(r.state, 'f6')?.type).toBe('queen');
  });

  it('R-INFO-005 R-SEC-001 before it fires, Black’s projection never names Snowbound', () => {
    const r = scenario({ white: { abilities: ['snowbound'] }, moves: OPENING });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain('snowbound');
  });
});
