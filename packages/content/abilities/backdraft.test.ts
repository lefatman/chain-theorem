/**
 * Backdraft (5.7): Captured, Ember, all. "Effect-capture one enemy pawn adjacent to this square,
 * other than the captor." Attuned: "May target an adjacent knight or bishop instead." The owner
 * chooses (5.2); the selection is mandatory and auto-resolves with a single option (DD-18); options
 * are filtered by public rules only (occupancy, Royal Immunity, INV-03), never by hidden protections
 * (DD-19), so a chosen target can still fizzle.
 *
 * Expected behaviour comes from spec 4.1, 4.2, 5.1-5.7, 6.1 (Bulwark), 6.2, 6.3, 8.2 and DD-17 to
 * DD-40, not from the engine.
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
import { eventsOf, idAt, parseSquare, pieceAt, scenario, setup } from '../src/testing.ts';

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

function pickPiece(id: number) {
  return (req: ChoiceRequest): number => {
    const idx = req.options.findIndex((o) => o.kind === 'piece' && o.piece === id);
    if (idx < 0) throw new Error(`piece ${id} is not offered: ${JSON.stringify(req.options)}`);
    return idx;
  };
}

/** Piece ids offered by a target prompt, sorted. */
function offeredPieces(req: ChoiceRequest): number[] {
  return req.options.map((o) => (o.kind === 'piece' ? o.piece : -100)).sort((a, b) => a - b);
}

// e1 K=0, a2 P=1, c3 N=2, e4 P=3, d5 p=4, e8 k=5. Only the e4 pawn is adjacent to d5.
const FEN = '4k3/8/8/3p4/4P3/2N5/P7/4K3 w - - 0 1';

describe('Backdraft', () => {
  it('R-ABIL-005 R-ABIL-001 module data matches the 5.7 catalogue row (Captured, Ember, all, level 4, 1 slot)', () => {
    const def = abilityById.get('backdraft');
    expect(def?.category).toBe('CAPTURED');
    expect(def?.affinity).toBe('ember');
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(4);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it('R-ABIL-005 R-ABIL-002 DD-18 base: the single adjacent enemy pawn is effect-captured without a prompt', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(trace(r.events)).toEqual([
      'Captured black pawn#4 by move',
      'MoveMade white knight#2 c3-d5',
      'Triggered black backdraft',
      'Captured white pawn#3 by effect',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({
      victim: 3,
      victimSide: 'white',
      victimType: 'pawn',
      square: sq('e4'),
      by: 'effect',
      captor: 4,
      source: { kind: 'ability', id: 'backdraft', piece: 4, side: 'black' },
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'black',
      piece: 4,
      pieceType: 'pawn',
      category: 'CAPTURED',
      attuned: false,
    });
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(idAt(r.state, 'a2')).toBe(1);
    expect(idAt(r.state, 'd5')).toBe(2);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['backdraft']);
  });

  it('R-ABIL-005 DD-18 R-INFO-002 several adjacent pawns: the owner is prompted (mandatory) and the chosen pawn is removed', () => {
    // e1 K=0, c3 N=1, c4 P=2, e4 P=3, d5 p=4, e8 k=5
    const r = scenario({
      fen: '4k3/8/8/3p4/2P1P3/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
      answers: [pickPiece(3)],
    });
    expect(r.prompts).toHaveLength(1);
    const req = r.prompts[0] as ChoiceRequest;
    expect(req.chooser).toBe('black');
    expect(req.kind).toBe('target');
    expect(req.source).toEqual({ ability: 'backdraft', piece: 4, side: 'black' });
    expect(req.options.some((o) => o.kind === 'decline')).toBe(false);
    expect(offeredPieces(req)).toEqual([2, 3]);
    // Default: first valid option in square order from the owner's (black's) side (5.4): c4.
    expect(req.options[req.defaultOption]).toEqual({ kind: 'piece', piece: 2, square: sq('c4') });

    expect(eventsOf(r.events, 'ChoiceMade')).toMatchObject([
      { side: 'black', option: { kind: 'piece', piece: 3 } },
    ]);
    expect(eventsOf(r.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [4, 'move'],
      [3, 'effect'],
    ]);
    expect(pieceAt(r.state, 'e4')).toBeUndefined();
    expect(idAt(r.state, 'c4')).toBe(2);
  });

  it('R-ABIL-005 DD-39 R-INFO-005 the captor cannot pre-answer Backdraft; the pending options go only to the chooser', () => {
    // e1 K=0, c3 N=1, c4 P=2, e4 P=3, d5 p=4, e8 k=5
    const s0 = setup({
      fen: '4k3/8/8/3p4/2P1P3/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
    });
    const r = s0.engine.applyAction(s0.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('c3d5'),
      choices: [{ kind: 'piece', piece: 3, square: sq('e4') }],
    });
    expect(r.kind).toBe('needsChoice');
    if (r.kind !== 'needsChoice') return;
    expect(r.request.chooser).toBe('black');
    expect(offeredPieces(r.request)).toEqual([2, 3]);
    // Nothing has been removed yet besides the victim.
    expect(idAt(r.state, 'c4')).toBe(2);
    expect(idAt(r.state, 'e4')).toBe(3);

    const whiteView = s0.engine.project(r.state, 'white');
    expect(whiteView.pending).toEqual({ chooser: 'black', request: null });
    const blackView = s0.engine.project(r.state, 'black');
    expect(blackView.pending?.chooser).toBe('black');
    expect(blackView.pending?.request?.options).toEqual(r.request.options);

    const done = s0.engine.applyAction(r.state, {
      kind: 'choice',
      side: 'black',
      promptId: r.request.promptId,
      option: pickPiece(2)(r.request),
    });
    expect(done.kind).toBe('done');
    expect(pieceAt(done.state, 'c4')).toBeUndefined();
    expect(idAt(done.state, 'e4')).toBe(3);
  });

  it('R-ABIL-005 base: an orthogonally adjacent pawn is a target; a pawn two files away is not', () => {
    // e1 K=0, c3 N=1, d5 p=2, e5 P=3, f5 P=4, e8 k=5
    const r = scenario({
      fen: '4k3/8/8/3pPP2/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({
      victim: 3,
      by: 'effect',
      square: sq('e5'),
    });
    expect(idAt(r.state, 'f5')).toBe(4);
  });

  it('R-ABIL-005 R-ABIL-004 R-RULES-001 "other than the captor": an en passant captor beside the square is excluded', () => {
    // e1 K=0, c4 P=1, e5 P=2, d7 p=3, e8 k=4. After d7-d5, e5xd6 e.p. lands on d6, adjacent to d5.
    const r = scenario({
      fen: '4k3/3p4/8/4P3/2P5/8/8/4K3 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['d7d5', 'e5d6'],
    });
    expect(r.prompts).toEqual([]);
    const ev = r.steps[1]?.events ?? [];
    expect(eventsOf(ev, 'Captured')).toMatchObject([
      { victim: 3, by: 'move', square: sq('d5') },
      { victim: 1, by: 'effect', square: sq('c4'), captor: 3 },
    ]);
    // Measured from the victim's last square (d5, R-ABIL-004), not the captor's landing square.
    expect(idAt(r.state, 'd6')).toBe(2);
    expect(pieceAt(r.state, 'c4')).toBeUndefined();
  });

  it('R-ABIL-005 R-ABIL-004 fizzles (no target) when the only adjacent enemy pawn is the captor', () => {
    // e1 K=0, e5 P=1, d7 p=2, e8 k=3
    const r = scenario({
      fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['d7d5', 'e5d6'],
    });
    const ev = r.steps[1]?.events ?? [];
    expect(eventsOf(ev, 'Captured')).toHaveLength(1);
    expect(eventsOf(ev, 'EffectFizzled')).toMatchObject([
      { side: 'black', piece: 2, ability: 'backdraft', reason: 'no_target' },
    ]);
    expect(idAt(r.state, 'd6')).toBe(1);
    // A fizzle still reveals the ability (8.2).
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['backdraft']);
  });

  it('R-ABIL-005 base: adjacent knights and bishops are not targets, so it fizzles (no target)', () => {
    // d1 R=0, e1 K=1, d5 p=2, c6 N=3, e6 B=4, e8 k=5
    const r = scenario({
      fen: '4k3/8/2N1B3/3p4/8/8/8/3RK3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['d1d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { side: 'black', piece: 2, ability: 'backdraft', reason: 'no_target' },
    ]);
    expect(idAt(r.state, 'c6')).toBe(3);
    expect(idAt(r.state, 'e6')).toBe(4);
  });

  it('R-ABIL-005 R-ELEM-003 R-RULES-004 DD-19 attuned (Ember bearer): adjacent knights and bishops join the pawns; queens and the captor do not', () => {
    // d1 R=0, e1 K=1, c4 P=2, e4 Q=3, d5 p=4, c6 N=5, e6 B=6, e8 k=7
    const r = scenario({
      fen: '4k3/8/2N1B3/3p4/2P1Q3/8/8/3RK3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['ember'], abilities: ['backdraft'] },
      moves: ['d1d5'],
      answers: [pickPiece(6)],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { ability: 'backdraft', attuned: true },
    ]);
    expect(r.prompts).toHaveLength(1);
    expect(offeredPieces(r.prompts[0] as ChoiceRequest)).toEqual([2, 5, 6]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({
      victim: 6,
      victimType: 'bishop',
      by: 'effect',
      square: sq('e6'),
    });
    expect(pieceAt(r.state, 'e6')).toBeUndefined();
    expect(idAt(r.state, 'c6')).toBe(5);
    expect(idAt(r.state, 'c4')).toBe(2);
    expect(idAt(r.state, 'e4')).toBe(3);
    expect(idAt(r.state, 'd5')).toBe(0);
  });

  it('R-ABIL-005 R-ELEM-003 attuned: a lone adjacent knight is taken without a prompt', () => {
    const r = scenario({
      fen: '4k3/8/2N5/3p4/8/8/8/3RK3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['ember'], abilities: ['backdraft'] },
      moves: ['d1d5'],
    });
    // d1 R=0, e1 K=1, d5 p=2, c6 N=3, e8 k=4
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({ victim: 3, by: 'effect' });
    expect(pieceAt(r.state, 'c6')).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 an Ember Backdraft is silenced by a Tide captor: revealed by name, the pawn survives', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'] },
      black: { elements: ['ember'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Captured black pawn#4 by move',
      'MoveMade white knight#2 c3-d5',
      'Silenced black backdraft',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      {
        side: 'black',
        piece: 4,
        pieceType: 'pawn',
        ability: 'backdraft',
        category: 'CAPTURED',
        by: 2,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'backdraft',
      ),
    ).toMatchObject([{ side: 'black', cause: 'silenced' }]);
    expect(idAt(r.state, 'e4')).toBe(3);
  });

  it('R-ABIL-005 INV-03 DD-19 a pawn shielding its own king is not offered: the other pawn is taken without a prompt', () => {
    // e1 K=0, c3 N=1, c4 P=2, e4 P=3, d5 p=4, a8 k=5, e8 r=6. The e4 pawn blocks the e8 rook.
    const r = scenario({
      fen: 'k3r3/8/8/3p4/2P1P3/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')[1]).toMatchObject({ victim: 2, by: 'effect' });
    expect(idAt(r.state, 'e4')).toBe(3);
    expect(pieceAt(r.state, 'c4')).toBeUndefined();
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 INV-03 DD-19 when the only candidate shields its own king, Backdraft fizzles and the king stays safe', () => {
    // e1 K=0, c3 N=1, e4 P=2, d5 p=3, a8 k=4, e8 r=5
    const r = scenario({
      fen: 'k3r3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    const fizzles = eventsOf(r.events, 'EffectFizzled');
    expect(fizzles).toHaveLength(1);
    expect(fizzles[0]).toMatchObject({ side: 'black', piece: 3, ability: 'backdraft' });
    expect(['inv03', 'no_target']).toContain(fizzles[0]?.reason);
    expect(idAt(r.state, 'e4')).toBe(2);
    expect(r.state.inCheck).toBeNull();
  });

  it('R-ABIL-005 R-ELEM-001 DD-19 DD-35 a Stone target is still chosen, and Bulwark makes the capture fizzle', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['stone'] },
      black: { elements: ['neutral'], abilities: ['backdraft'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(r.events, 'EffectFizzled')).toMatchObject([
      { side: 'black', piece: 4, ability: 'backdraft', reason: 'bulwark', target: 3 },
    ]);
    expect(idAt(r.state, 'e4')).toBe(3);
    expect((r.state.slices['bulwark'] as BulwarkState).spent).toEqual([3]);
  });

  it('R-ABIL-005 R-ABIL-004 an effect-captured Backdraft carrier does not trigger (effect captures do not chain)', () => {
    // e1 K=0, c3 N=1, d5 p=2, e6 p=3, e8 k=4
    const r = scenario({
      fen: '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['backdraft'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.pieces[1]?.square).toBe(-1);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['poisoned_meat']);
    expect(idAt(r.state, 'e6')).toBe(3);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual([]);
  });
});
