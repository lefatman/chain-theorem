/**
 * Pierce (5.7): Capturing, neutral, all. "Negate the victim's Captured abilities for this capture."
 * Neutral since DD-98: the former Tide Attuned bonus (also reveal all abilities of the victim's piece
 * type) is dropped; no bearer is attuned and Pierce has no explicit reveal of its own.
 *
 * Expected behaviour comes from spec 5.1-5.7, 6.2 (and its design note on Pierce vs Grove), 6.3, 8.2,
 * DD-17 to DD-40 (DD-28 explicit reveals, DD-36 negation beats silence) and DD-98, not from the
 * engine.
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

/**
 * Pierce's own REVEAL events (cause 'effect', source Pierce). Always empty since DD-98: negated
 * abilities are revealed with cause 'negated', never by an explicit Pierce reveal.
 */
function pierceReveals(events: readonly BattleEvent[]) {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.cause === 'effect' && e.source?.kind === 'ability' && e.source.id === 'pierce',
  );
}

// e1 K=0, b3 B=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1';
const BISHOP = 1;
const PAWN = 2;
const PIERCE_SOURCE = { kind: 'ability', id: 'pierce', piece: BISHOP, side: 'white' } as const;

describe('Pierce', () => {
  it('R-ABIL-005 R-ABIL-001 DD-98 module data matches the 5.7 catalogue row (Capturing, neutral, all, level 3, 1 slot)', () => {
    const def = abilityById.get('pierce');
    expect(def?.category).toBe('CAPTURING');
    expect(def?.affinity).toBe('neutral');
    expect(def?.attuned).toBeUndefined();
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(3);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it("R-ABIL-005 R-ABIL-002 R-INFO-002 base: negates the victim's Poisoned Meat (revealed as negated); the bishop survives", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      moves: ['b3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Triggered white pierce',
      'Captured black pawn#2 by move',
      'MoveMade white bishop#1 b3-d5',
      'Negated black poisoned_meat',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'white',
      piece: BISHOP,
      pieceType: 'bishop',
      ability: 'pierce',
      category: 'CAPTURING',
      attuned: false,
    });
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      {
        side: 'black',
        piece: PAWN,
        pieceType: 'pawn',
        ability: 'poisoned_meat',
        category: 'CAPTURED',
        source: PIERCE_SOURCE,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat',
      ),
    ).toMatchObject([{ side: 'black', cause: 'negated' }]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
    // Pierce reveals only what was negated, never the whole set (DD-98).
    expect(pierceReveals(r.events)).toEqual([]);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat']);
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(revealedOn(r.state, 'white', 'bishop')).toEqual(['pierce']);
  });

  it('R-ABIL-005 R-ABIL-002 every Captured ability of the victim is negated, none resolves', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['b3d5'],
    });
    expect(
      eventsOf(r.events, 'AbilityNegated')
        .map((e) => e.ability)
        .sort(),
    ).toEqual(['last_word', 'poisoned_meat']);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['pierce']);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
    // Last Word never resolved: nothing about white's bishops is complete.
    expect(r.state.reveals.white.complete).toEqual([]);
    expect([...revealedOn(r.state, 'black', 'pawn')].sort()).toEqual([
      'last_word',
      'poisoned_meat',
    ]);
  });

  it('R-ABIL-005 R-ABIL-002 INV-01 Pierce negates a Riposte victim: no bonus prompt, no nested capture', () => {
    // e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6
    const r = scenario({
      fen: '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['riposte'] },
      moves: ['d3g6'],
    });
    expect(r.prompts).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      { side: 'black', piece: 2, ability: 'riposte', source: { id: 'pierce', piece: 1 } },
    ]);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(idAt(r.state, 'g6')).toBe(1);
    expect(Math.max(...r.events.map((e) => e.depth))).toBe(0);
  });

  it("R-ABIL-005 R-ABIL-003 R-ABIL-004 Pierce also works in a nested bonus capture: it negates the recaptured bishop's Poisoned Meat", () => {
    // e1 K=0, d3 B=1, g6 n=2, f7 p=3, h7 p=4, e8 k=5, g8 r=6. The black knight's Riposte lets the
    // h7 pawn (carrying Pierce) take the bishop at depth 1; Pierce negates the bishop's Captured.
    const r = scenario({
      fen: '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['poisoned_meat'] },
      black: { elements: ['neutral'], abilities: ['riposte', 'pierce'] },
      moves: ['d3g6'],
      answers: [
        (req) =>
          req.options.findIndex(
            (o) => o.kind === 'move' && o.from === sq('h7') && o.to === sq('g6'),
          ),
      ],
    });
    expect(trace(r.events)).toEqual([
      'Captured black knight#2 by move',
      'MoveMade white bishop#1 d3-g6',
      'Triggered black riposte',
      'd1 Triggered black pierce',
      'd1 Captured white bishop#1 by move',
      'd1 MoveMade black pawn#4 h7-g6',
      'd1 Negated white poisoned_meat',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      {
        depth: 1,
        side: 'white',
        piece: 1,
        ability: 'poisoned_meat',
        source: { kind: 'ability', id: 'pierce', piece: 4, side: 'black' },
      },
    ]);
    expect(idAt(r.state, 'g6')).toBe(4);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(2);
  });

  it('R-ABIL-005 R-ELEM-003 R-INFO-002 DD-98 neutral: a Tide bearer negates the same way, never attuned, and reveals no set beyond the negated names', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['b3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { ability: 'pierce', attuned: false },
    ]);
    expect(pierceReveals(r.events)).toEqual([]);
    expect(eventsOf(r.events, 'AbilityNegated')).toHaveLength(2);
    expect([...revealedOn(r.state, 'black', 'pawn')].sort()).toEqual([
      'last_word',
      'poisoned_meat',
    ]);
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
  });

  it('R-ABIL-005 DD-98 a victim without Captured abilities: nothing is negated and nothing about it is revealed', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['hit_and_run'] },
      moves: ['b3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { ability: 'pierce', attuned: false },
    ]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([]);
    expect(pierceReveals(r.events)).toEqual([]);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual([]);
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Pierce on a Tide piece is silenced against a Grove victim, so Poisoned Meat resolves (6.2 design note)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['pierce'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['b3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Silenced white pierce',
      'Captured black pawn#2 by move',
      'MoveMade white bishop#1 b3-d5',
      'Triggered black poisoned_meat',
      'Captured white bishop#1 by effect',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      {
        side: 'white',
        piece: BISHOP,
        pieceType: 'bishop',
        ability: 'pierce',
        category: 'CAPTURING',
        by: PAWN,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'pierce',
      ),
    ).toMatchObject([{ side: 'white', cause: 'silenced' }]);
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([]);
    expect(pierceReveals(r.events)).toEqual([]);
    expect(r.state.pieces[BISHOP]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(r.state.reveals.black.complete).toEqual([]);
  });

  it('R-ABIL-005 R-ELEM-002 DD-36 negation takes precedence over silence: a Tide Pierce negates an Ember victim (not silenced)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['pierce'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['b3d5'],
    });
    // Tide beats Ember, so Poisoned Meat would be silenced; Pierce's NEGATE wins.
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      { side: 'black', ability: 'poisoned_meat', source: PIERCE_SOURCE },
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    // The negation names it (cause 'negated'); no reveal is attributed to a silence.
    expect(
      eventsOf(r.events, 'Revealed')
        .filter((e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat')
        .map((e) => e.cause),
    ).toEqual(['negated']);
    expect(eventsOf(r.events, 'Revealed').filter((e) => e.cause === 'silenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['pierce']);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 DD-36 base Pierce on an Ember captor negates a Grove victim that would be silenced; revealed as negated', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['ember'], abilities: ['pierce'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['b3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { ability: 'pierce', attuned: false },
    ]);
    expect(eventsOf(r.events, 'AbilityNegated')).toMatchObject([
      { side: 'black', piece: PAWN, ability: 'poisoned_meat', source: PIERCE_SOURCE },
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(
      eventsOf(r.events, 'Revealed')
        .filter((e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat')
        .map((e) => e.cause),
    ).toEqual(['negated']);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
  });

  it('R-ABIL-005 DD-28 R-INFO-005 base Pierce negating a veiled ability does not name it: the pawn type is marked veiled', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'veil'] },
      moves: ['b3d5'],
    });
    // The negation happens (the bishop survives) ...
    expect(eventsOf(r.events, 'AbilityNegated')).toHaveLength(1);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
    // ... but its name is not revealed; white learns that pawns are veiled.
    expect(revealedOn(r.state, 'black', 'pawn')).not.toContain('poisoned_meat');
    expect(r.state.reveals.black.veiled).toEqual(['pawn']);
    const whiteView = r.engine.projectEvents(r.state, r.events, 'white');
    expect(eventsOf(whiteView, 'AbilityNegated')).toMatchObject([{ ability: null }]);
    expect(JSON.stringify(whiteView)).not.toContain('poisoned_meat');
  });

  it("R-ABIL-005 DD-28 DD-98 a Pierce on a Tide piece has no explicit reveal either: a veiled victim's negated ability stays unnamed", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['pierce'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'veil'] },
      moves: ['b3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated')).toHaveLength(1);
    expect(pierceReveals(r.events)).toEqual([]);
    expect(revealedOn(r.state, 'black', 'pawn')).not.toContain('poisoned_meat');
    expect(revealedOn(r.state, 'black', 'pawn')).not.toContain('veil');
    expect(r.state.reveals.black.veiled).toEqual(['pawn']);
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(idAt(r.state, 'd5')).toBe(BISHOP);
    expect(r.state.pieces[BISHOP]?.square).toBe(sq('d5'));
  });
});
