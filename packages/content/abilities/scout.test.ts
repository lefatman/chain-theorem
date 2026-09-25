/**
 * Scout (5.7): Capturing, Tide, all. "Reveal the victim's abilities before they resolve." Attuned:
 * "Also reveal the opponent's highest-cost item" (DD-40: ties by item id, fizzles with no items).
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

/** Revealed ability names logged about `side` for `pieceType` (8.2). */
function revealedOn(state: GameState, side: Side, pieceType: PieceType): string[] {
  return state.reveals[side].abilities[pieceType] ?? [];
}

/** Order-preserving trace of the board- and ability-level events whose order the spec fixes. */
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
      case 'BattleEnded':
        out.push(`${d}BattleEnded ${e.result.winner ?? 'draw'} ${e.result.reason}`);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Scout's own REVEAL events (cause 'effect', source Scout). */
function scoutReveals(events: readonly BattleEvent[]) {
  return eventsOf(events, 'Revealed').filter(
    (e) => e.cause === 'effect' && e.source?.kind === 'ability' && e.source.id === 'scout',
  );
}

// e1 K=0, c3 N=1, d5 p=2, e8 k=3
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
const KNIGHT = 1;
const PAWN = 2;
/** Six sets in PIECE_TYPES order: pawn, knight, bishop, rook, queen, king. */
const sets6 = (pawn: string[], knight: string[] = []): string[][] => [pawn, knight, [], [], [], []];

describe('Scout', () => {
  it('R-ABIL-005 R-ABIL-001 module data matches the 5.7 catalogue row (Capturing, Tide, all, level 1, 1 slot)', () => {
    const def = abilityById.get('scout');
    expect(def).toBeDefined();
    expect(def?.category).toBe('CAPTURING');
    expect(def?.affinity).toBe('tide');
    expect(def?.eligible).toBe('all');
    expect(def?.tags).toEqual([]);
    expect(def?.minLevel).toBe(1);
    expect(def?.slotCost).toBe(1);
    expect(def?.limits).toEqual({ perAction: 1 });
    expect(def?.attuned).toBeDefined();
  });

  it("R-ABIL-005 R-ABIL-001 R-INFO-002 base: reveals the victim's full piece-type set before the victim is removed", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['scout'] },
      // Black pawns carry two After-capturing abilities (they never fire for a victim) and black
      // knights carry Poisoned Meat: only the victim's own type set may be revealed.
      black: { elements: ['neutral'], sets: sets6(['hit_and_run', 'momentum'], ['poisoned_meat']) },
      moves: ['c3d5'],
    });

    expect(idAt(r.state, 'd5')).toBe(KNIGHT);
    expect(r.state.pieces[PAWN]?.square).toBe(-1);

    // CAPTURING fires after commit, before the victim is removed (5.1, 5.3 phase 2).
    expect(trace(r.events)).toEqual([
      'Triggered white scout',
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'TurnPassed black',
    ]);
    const triggered = eventsOf(r.events, 'AbilityTriggered')[0];
    expect(triggered).toMatchObject({
      side: 'white',
      piece: KNIGHT,
      pieceType: 'knight',
      ability: 'scout',
      category: 'CAPTURING',
      attuned: false,
    });

    const reveals = scoutReveals(r.events);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({
      side: 'black',
      info: { kind: 'set', pieceType: 'pawn', abilities: ['hit_and_run', 'momentum'] },
      cause: 'effect',
      source: { kind: 'ability', id: 'scout', piece: KNIGHT, side: 'white' },
    });
    const captured = eventsOf(r.events, 'Captured')[0] as BattleEvent;
    expect(r.events.indexOf(reveals[0] as BattleEvent)).toBeLessThan(r.events.indexOf(captured));

    // Reveal log: the pawn set is known and complete; nothing about knights or items.
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['hit_and_run', 'momentum']);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
    expect(r.state.reveals.black.abilities.knight).toBeUndefined();
    expect(r.state.reveals.black.items).toEqual([]);
    expect(r.state.reveals.black.allItems).toBe(false);
    // Scout itself is revealed on the knight by activating (8.2).
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['scout']);
  });

  it("R-ABIL-005 R-ABIL-003 R-ABIL-004 Scout's reveal lands before the victim's Captured abilities resolve, which still resolve", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['scout'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'last_word'] },
      moves: ['c3d5'],
    });

    expect(trace(r.events)).toEqual([
      'Triggered white scout',
      'Captured black pawn#2 by move',
      'MoveMade white knight#1 c3-d5',
      'Triggered black poisoned_meat',
      'Captured white knight#1 by effect',
      'Triggered black last_word',
      'TurnPassed black',
    ]);
    const setReveal = scoutReveals(r.events)[0] as BattleEvent;
    expect(setReveal).toMatchObject({
      side: 'black',
      info: { kind: 'set', pieceType: 'pawn', abilities: ['poisoned_meat', 'last_word'] },
    });
    const pmTrigger = eventsOf(r.events, 'AbilityTriggered').find(
      (e) => e.ability === 'poisoned_meat',
    ) as BattleEvent;
    expect(r.events.indexOf(setReveal)).toBeLessThan(r.events.indexOf(pmTrigger));

    // Scout does not stop anything: Poisoned Meat removes the knight.
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat', 'last_word']);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
    // Last Word revealed the knight's set (Scout only).
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['scout']);
    expect(r.state.reveals.white.complete).toEqual(['knight']);
  });

  it('R-ABIL-005 R-INFO-002 an empty victim set is disclosed as complete', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['scout'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    const reveals = scoutReveals(r.events);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({
      side: 'black',
      info: { kind: 'set', pieceType: 'pawn', abilities: [] },
    });
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual([]);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
  });

  it("R-ABIL-005 R-ELEM-003 DD-40 attuned (Tide bearer): also reveals the opponent's highest-cost item", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout'] },
      black: {
        elements: ['neutral'],
        // Slot costs: Dual Adept's Glove 1, Journeyman's Medallion 3, Multitasker's Schedule 1.
        items: ['dual_adepts_glove', 'journeymans_medallion', 'multitaskers_schedule'],
        abilities: ['hit_and_run'],
      },
      moves: ['c3d5'],
    });

    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'scout',
      attuned: true,
    });
    const reveals = scoutReveals(r.events);
    // Append mode: the base set reveal plus exactly one item reveal.
    expect(reveals.map((e) => e.info.kind).sort()).toEqual(['item', 'set']);
    expect(reveals.find((e) => e.info.kind === 'item')).toMatchObject({
      side: 'black',
      info: { kind: 'item', item: 'journeymans_medallion' },
      cause: 'effect',
      source: { kind: 'ability', id: 'scout', piece: KNIGHT, side: 'white' },
    });
    expect(r.state.reveals.black.items).toEqual(['journeymans_medallion']);
    expect(r.state.reveals.black.allItems).toBe(false);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['hit_and_run']);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
    // Both item reveals happen before the capture (phase 2).
    const captured = eventsOf(r.events, 'Captured')[0] as BattleEvent;
    for (const e of reveals) expect(r.events.indexOf(e)).toBeLessThan(r.events.indexOf(captured));
  });

  it('R-ABIL-005 R-ELEM-003 R-ELEM-002 DD-40 attuned: ties on slot cost are broken by item id; same element silences nothing', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout'] },
      black: {
        // Same element as the captor: nothing is silenced (6.2).
        elements: ['tide'],
        items: ['wardens_stopwatch', 'multitaskers_schedule', 'dual_adepts_glove'],
      },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    const itemReveals = scoutReveals(r.events).filter((e) => e.info.kind === 'item');
    expect(itemReveals).toHaveLength(1);
    expect(itemReveals[0]?.info).toEqual({ kind: 'item', item: 'dual_adepts_glove' });
    expect(r.state.reveals.black.items).toEqual(['dual_adepts_glove']);
    expect(r.state.reveals.black.allItems).toBe(false);
  });

  it('R-ABIL-005 R-ELEM-003 DD-40 attuned: the item reveal fizzles when the opponent has no items, the set reveal still resolves', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout'] },
      black: { elements: ['neutral'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    const fizzles = eventsOf(r.events, 'EffectFizzled');
    expect(fizzles).toHaveLength(1);
    expect(fizzles[0]).toMatchObject({
      side: 'white',
      piece: KNIGHT,
      ability: 'scout',
      reason: 'no_target',
    });
    const reveals = scoutReveals(r.events);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.info).toEqual({ kind: 'set', pieceType: 'pawn', abilities: ['last_word'] });
    expect(r.state.reveals.black.items).toEqual([]);
    expect(r.state.reveals.black.allItems).toBe(false);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
  });

  it('R-ABIL-005 R-ELEM-002 R-INFO-002 a Tide Scout is silenced against a Grove victim: revealed by name, nothing about the victim is revealed', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout'] },
      black: {
        elements: ['grove'],
        items: ['journeymans_medallion'],
        abilities: ['poisoned_meat', 'last_word'],
      },
      moves: ['c3d5'],
    });

    const silenced = eventsOf(r.events, 'AbilitySilenced');
    expect(silenced).toHaveLength(1);
    expect(silenced[0]).toMatchObject({
      side: 'white',
      piece: KNIGHT,
      pieceType: 'knight',
      ability: 'scout',
      category: 'CAPTURING',
      by: PAWN,
    });
    // Silenced in phase 2, before the victim is removed.
    const captured = eventsOf(r.events, 'Captured')[0] as BattleEvent;
    expect(r.events.indexOf(silenced[0] as BattleEvent)).toBeLessThan(r.events.indexOf(captured));
    expect(
      eventsOf(r.events, 'Revealed').filter(
        (e) =>
          e.side === 'white' &&
          e.info.kind === 'ability' &&
          e.info.ability === 'scout' &&
          e.cause === 'silenced',
      ),
    ).toHaveLength(1);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).not.toContain('scout');
    expect(scoutReveals(r.events)).toEqual([]);
    expect(revealedOn(r.state, 'white', 'knight')).toEqual(['scout']);

    // Nothing Scout would have revealed is known: no complete set, no items.
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(r.state.reveals.black.items).toEqual([]);
    // The Grove pawn's Captured abilities are not silenced (Tide does not beat Grove) and resolve.
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['poisoned_meat', 'last_word']);
  });

  it('R-ABIL-005 R-ELEM-002 R-ELEM-004 silence is computed per piece: a Tide Scout is not silenced by the Tide rook of a Grove/Tide Blended Family', () => {
    // e1 K=0, c3 N=1, d5 r=2, e8 k=3. Black pawns/knights/bishops are Grove, rooks/queen/king Tide.
    const r = scenario({
      fen: '4k3/8/8/3r4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['tide'], abilities: ['scout'] },
      black: {
        elements: ['grove', 'tide'],
        items: ['blended_family'],
        sets: [['poisoned_meat'], [], [], ['last_word'], [], []],
      },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'scout',
      attuned: true,
    });
    expect(scoutReveals(r.events)).toMatchObject([
      { side: 'black', info: { kind: 'set', pieceType: 'rook', abilities: ['last_word'] } },
      { side: 'black', info: { kind: 'item', item: 'blended_family' } },
    ]);
    expect(r.state.reveals.black.complete).toEqual(['rook']);
    expect(r.state.reveals.black.abilities.pawn).toBeUndefined();
  });

  it('R-ABIL-005 R-ELEM-002 silenceScope REACTIONS_ONLY spares Scout (a Capturing ability) against its foil', () => {
    const r = scenario({
      fen: FEN,
      caps: { SILENCE_SCOPE: 'REACTIONS_ONLY' },
      white: { elements: ['tide'], abilities: ['scout'] },
      black: { elements: ['grove'], items: ['triple_adepts_gloves'], abilities: ['hit_and_run'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(eventsOf(r.events, 'AbilityTriggered')[0]).toMatchObject({
      ability: 'scout',
      attuned: true,
    });
    expect(revealedOn(r.state, 'black', 'pawn')).toEqual(['hit_and_run']);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
    expect(r.state.reveals.black.items).toEqual(['triple_adepts_gloves']);
  });

  it('R-ABIL-005 R-ELEM-002 DD-28 R-INFO-005 a silenced Scout on a veiled knight is not named: the knight type is marked veiled', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout', 'veil'] },
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toHaveLength(1);
    expect(revealedOn(r.state, 'white', 'knight')).not.toContain('scout');
    expect(r.state.reveals.white.veiled).toEqual(['knight']);
    const blackView = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(blackView, 'AbilitySilenced')).toMatchObject([{ ability: null }]);
    expect(JSON.stringify(blackView)).not.toContain('scout');
  });

  it("R-ABIL-005 DD-28 Scout's explicit reveal names a veiled victim's abilities, Veil included", () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['neutral'], abilities: ['scout'] },
      black: { elements: ['neutral'], abilities: ['poisoned_meat', 'veil'] },
      moves: ['c3d5'],
    });
    const reveals = scoutReveals(r.events);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.info).toEqual({
      kind: 'set',
      pieceType: 'pawn',
      abilities: ['poisoned_meat', 'veil'],
    });
    expect([...revealedOn(r.state, 'black', 'pawn')].sort()).toEqual(['poisoned_meat', 'veil']);
    expect(r.state.reveals.black.complete).toEqual(['pawn']);
    // Poisoned Meat still resolves (Veil hides names, not effects).
    expect(r.state.pieces[KNIGHT]?.square).toBe(-1);
  });

  it('R-ABIL-005 R-INFO-005 R-SEC-001 projections carry what Scout revealed and nothing else of the hidden loadout', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['tide'], abilities: ['scout'] },
      black: {
        elements: ['neutral'],
        items: ['dual_adepts_glove', 'journeymans_medallion', 'multitaskers_schedule'],
        sets: sets6(['hit_and_run'], ['poisoned_meat']),
      },
      moves: ['c3d5'],
    });
    const pub = r.engine.project(r.state, 'white');
    expect(pub.armies.black.loadout).toBeUndefined();
    expect(pub.armies.black.revealed.items).toEqual(['journeymans_medallion']);
    expect(pub.armies.black.revealed.complete).toEqual(['pawn']);
    const json = JSON.stringify([pub, r.engine.projectEvents(r.state, r.events, 'white')]);
    expect(json).toContain('journeymans_medallion');
    expect(json).toContain('hit_and_run');
    // Unrevealed opponent ids never reach the viewer.
    expect(json).not.toContain('dual_adepts_glove');
    expect(json).not.toContain('multitaskers_schedule');
    expect(json).not.toContain('poisoned_meat');
    // The victim's owner sees Scout by name (revealed on activation).
    const blackView = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(blackView, 'AbilityTriggered')).toMatchObject([{ ability: 'scout' }]);
  });

  it('R-ABIL-005 Scout is eligible on every piece type, the king included', () => {
    // e1 K=0, e2 p=1, e8 k=2
    const r = scenario({
      fen: '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1',
      white: { elements: ['neutral'], abilities: ['scout'] },
      black: { elements: ['neutral'], abilities: ['cleave'] },
      moves: ['e1e2'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toMatchObject([
      { side: 'white', piece: 0, pieceType: 'king', ability: 'scout' },
    ]);
    expect(scoutReveals(r.events)[0]?.info).toEqual({
      kind: 'set',
      pieceType: 'pawn',
      abilities: ['cleave'],
    });
    expect(revealedOn(r.state, 'white', 'king')).toEqual(['scout']);
    expect(r.state.pieces[0]?.square).toBe(sq('e2'));
  });
});
