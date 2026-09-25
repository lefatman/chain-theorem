/**
 * Last Word (5.7): Captured, Tide, all. "Reveal all abilities of the captor's piece type." Attuned:
 * "Also reveal the opponent's item names" (DD-40: the complete item list, including that it is
 * empty, so `allItems` becomes true).
 *
 * Expected behaviour comes from spec 5.1-5.7, 6.2, 6.3, 8.2 and DD-17 to DD-40, not from the engine.
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

/** Last Word's own REVEAL events (cause 'effect', source Last Word). */
function lastWordReveals(events: readonly BattleEvent[]) {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.cause === 'effect' && e.source?.kind === 'ability' && e.source.id === 'last_word',
  );
}

// e1 K=0, c3 N=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
const KNIGHT = 1;
const PAWN = 2;
/** Six sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king. */
const sets6 = (by: Partial<Record<PieceType, string[]>>): string[][] =>
  (['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const).map((t) => by[t] ?? []);

describe('Last Word', () => {
  it('R-ABIL-005 R-ABIL-001 module data matches the 5.7 catalogue row (Captured, Tide, all, level 1, 1 slot)', () => {
    const def = abilityById.get('last_word');
    expect(def?.category).toBe('CAPTURED');
    expect(def?.affinity).toBe('tide');
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(1);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
  });

  it("R-ABIL-005 R-ABIL-003 R-INFO-002 base: reveals the captor's piece-type set, before the captor's Captures abilities resolve", () => {
    const r = scenario({
      fen: FEN,
      white: {
        elements: ['neutral'],
        sets: sets6({ pawn: ['poisoned_meat'], knight: ['hit_and_run', 'rebirth'] }),
      },
      black: { elements: ['neutral'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });

    // Victim's Captured first, then the captor's Captures (5.3 phase 4).
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black last_word',
      'Triggered white hit_and_run',
      'PieceMoved #1 d5-c3',
      'TurnPassed black',
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      side: 'black',
      piece: PAWN,
      pieceType: 'pawn',
      ability: 'last_word',
      category: 'CAPTURED',
      attuned: false,
    });
    const reveals = lastWordReveals(r.events);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({
      side: 'white',
      info: { kind: 'set', pieceType: 'knight', abilities: ['hit_and_run', 'rebirth'] },
      cause: 'effect',
      source: { kind: 'ability', id: 'last_word', piece: PAWN, side: 'black' },
    });
    const hr = eventsOf(r.events, 'AbilityTriggered').find(
      (e) => e.ability === 'hit_and_run',
    ) as BattleEvent;
    expect(r.events.indexOf(reveals[0] as BattleEvent)).toBeLessThan(r.events.indexOf(hr));

    // Reveal logs: the whole knight set is known; the white pawn set is not; no items.
    expect([...revealedOn(r.state, 'white', 'knight')].sort()).toEqual(['hit_and_run', 'rebirth']);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(r.state.reveals.white.abilities.pawn).toBeUndefined();
    expect(r.state.reveals.white.items).toEqual([]);
    expect(r.state.reveals.white.allItems).toBe(false);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['last_word']);
    expect(idAt(r.state, 'c3')).toBe(KNIGHT);
  });

  it("R-ABIL-005 R-ABIL-004 earned trigger persists: Last Word still reveals the captor's set after Poisoned Meat removed it", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['c3d5'],
    });
    expect(trace(r.events)).toEqual([
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'Triggered black last_word',
      'Triggered white hit_and_run',
      'Fizzled white hit_and_run no_body',
      'TurnPassed black',
    ]);
    expect(lastWordReveals(r.events)).toMatchObject([
      { side: 'white', info: { kind: 'set', pieceType: 'knight', abilities: ['hit_and_run'] } },
    ]);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
  });

  it('R-ABIL-005 R-ELEM-003 DD-40 attuned (Tide bearer): also reveals every opponent item name (allItems)', () => {
    const r = scenario({
      fen: FEN,
      white: {
        elements: ['neutral'],
        items: ['dual_adepts_glove', 'multitaskers_schedule'],
        abilities: ['hit_and_run'],
      },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'last_word',
      attuned: true,
    });
    const reveals = lastWordReveals(r.events);
    expect(reveals.map((e) => e.info.kind).sort()).toEqual(['items', 'set']);
    const items = reveals.find((e) => e.info.kind === 'items');
    expect(items).toMatchObject({ side: 'white', cause: 'effect' });
    expect(items?.info.kind === 'items' ? [...items.info.items].sort() : null).toEqual([
      'dual_adepts_glove',
      'multitaskers_schedule',
    ]);
    expect([...r.state.reveals.white.items].sort()).toEqual([
      'dual_adepts_glove',
      'multitaskers_schedule',
    ]);
    expect(r.state.reveals.white.allItems).toBe(true);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
  });

  it('R-ABIL-005 R-ELEM-003 DD-40 attuned: an empty item list is disclosed too (allItems true, no items)', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['hit_and_run'] },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const items = lastWordReveals(r.events).filter((e) => e.info.kind === 'items');
    expect(items).toMatchObject([{ side: 'white', info: { kind: 'items', items: [] } }]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect(r.state.reveals.white.items).toEqual([]);
    expect(r.state.reveals.white.allItems).toBe(true);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Tide Last Word is silenced by a Grove captor: revealed by name, nothing about the captor revealed', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['grove'], items: ['dual_adepts_glove'], abilities: ['antidote'] },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      {
        side: 'black',
        piece: PAWN,
        pieceType: 'pawn',
        ability: 'last_word',
        category: 'CAPTURED',
        by: KNIGHT,
      },
    ]);
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) => e.info.kind === 'ability' && e.info.ability === 'last_word',
      ),
    ).toMatchObject([{ side: 'black', cause: 'silenced' }]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).not.toContain('last_word');
    expect(lastWordReveals(r.events)).toEqual([]);
    expect(r.state.reveals.white.complete).toEqual([]);
    expect(r.state.reveals.white.items).toEqual([]);
    expect(r.state.reveals.white.allItems).toBe(false);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['last_word']);
  });

  it('R-ABIL-005 R-ELEM-002 R-ELEM-003 a Tide victim beats an Ember captor: Last Word fires attuned while the captor is silenced', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['ember'], abilities: ['hit_and_run'] },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { side: 'black', ability: 'last_word', attuned: true },
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toMatchObject([
      { side: 'white', ability: 'hit_and_run', category: 'CAPTURES', by: PAWN },
    ]);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['hit_and_run']);
    expect(r.state.reveals.white.allItems).toBe(true);
    // The silenced Hit and Run does not move the knight.
    expect(idAt(r.state, 'd5')).toBe(KNIGHT);
  });

  it("R-ABIL-005 DD-28 Last Word's explicit reveal names a veiled captor's abilities, Veil included", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['veil', 'hit_and_run'] },
      black: { elements: ['neutral'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(lastWordReveals(r.events)).toMatchObject([
      {
        side: 'white',
        info: { kind: 'set', pieceType: 'knight', abilities: ['veil', 'hit_and_run'] },
      },
    ]);
    expect([...revealedOn(r.state, 'white', 'knight')].sort()).toEqual(['hit_and_run', 'veil']);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
    expect(idAt(r.state, 'c3')).toBe(KNIGHT);
  });

  it("R-ABIL-005 R-RULES-002 a captor that promotes while capturing has its new type's set revealed", () => {
    // e1 K=0, h5 k=1, b7 P=2, a8 r=3
    const r = scenario({
      fen: 'r7/1P6/8/7k/8/8/8/4K3 w - - 0 1',
      white: { elements: ['neutral'], sets: sets6({ pawn: ['hit_and_run'], queen: ['rebirth'] }) },
      black: { elements: ['neutral'], abilities: ['last_word'] },
      moves: ['b7a8q'],
    });
    expect(lastWordReveals(r.events)).toMatchObject([
      { side: 'white', info: { kind: 'set', pieceType: 'queen', abilities: ['rebirth'] } },
    ]);
    expect(r.state.reveals.white.complete).toEqual(['queen']);
    expect(r.state.reveals.white.abilities.pawn).toBeUndefined();
    expect(idAt(r.state, 'a8')).toBe(2);
  });

  it("R-ABIL-005 DD-28 a king captor's set is revealed too, Stalwart included", () => {
    // e1 K=0, e2 p=1, e8 k=2
    const r = scenario({
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { elements: ['neutral'], sets: sets6({ king: ['stalwart'], knight: ['scout'] }) },
      black: { elements: ['neutral'], abilities: ['last_word'] },
      moves: ['e1e2'],
    });
    expect(lastWordReveals(r.events)).toMatchObject([
      { side: 'white', info: { kind: 'set', pieceType: 'king', abilities: ['stalwart'] } },
    ]);
    expect(revealedOn(r.state, 'white', 'king')).toEqual(['stalwart']);
    expect(r.state.reveals.white.complete).toEqual(['king']);
    expect(r.state.reveals.white.abilities.knight).toBeUndefined();
    expect(r.state.pieces[0]?.square).toBe(sq('e2'));
    expect(pieceAt(r.state, 'e2')?.type).toBe('king');
  });
});
