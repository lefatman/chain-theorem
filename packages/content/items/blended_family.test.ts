/**
 * Blended Family scenario tests (R-LOAD-002, R-ELEM-004, spec 6.4 and 7.2): 1 slot, min level 15,
 * two different elements split by group. Group A (pawns, knights, bishops) takes element A; group B
 * (rooks, queen, king) takes element B. Silence, traits and attunement are per piece; a promoted
 * pawn joins its new type's group (R-RULES-002); the opponent sees both elements and the mapping.
 *
 * Expected behaviour comes from spec 4.2, 6.1-6.4, 7.2-7.4, 8.1 and DD-13, DD-36, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { type Loadout, type PieceType, moveToUci } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario, setup } from '../src/testing.ts';

const ID = 'blended_family';
const sq = parseSquare;
const GROUP_A: PieceType[] = ['pawn', 'knight', 'bishop'];

function loadout(items: string[], elements: Loadout['elements'], sets: string[][] = [['scout']]) {
  return { elements, items, sets } satisfies Loadout;
}

describe('blended family (R-LOAD-002, R-ELEM-004)', () => {
  it('R-LOAD-002 DD-13 Blended Family costs 1 slot at min level 15 and grants a second element', () => {
    const def = itemById.get(ID);
    expect(def).toBeDefined();
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(15);
    expect(def?.grants?.secondElement).toBe(true);
    expect(def?.capacity).toBeUndefined();
  });

  it('R-LOAD-002 R-LOAD-004 R-ELEM-004 at level 15 Blended Family validates with two different elements', () => {
    const v = engine.validateLoadout(loadout([ID], ['tide', 'ember']), { level: 15 });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.consumedSlots).toBe(1);
  });

  it('R-LOAD-002 R-LOAD-004 R-ELEM-004 Blended Family requires two different elements (rule 6)', () => {
    const same = engine.validateLoadout(loadout([ID], ['tide', 'tide']), { level: 15 });
    expect(same.ok).toBe(false);
    expect(same.errors).toContainEqual(expect.objectContaining({ rule: 6, code: 'elements_same' }));
    const one = engine.validateLoadout(loadout([ID], ['tide']), { level: 15 });
    expect(one.ok).toBe(false);
    expect(one.errors).toContainEqual(expect.objectContaining({ rule: 6 }));
  });

  it('R-LOAD-002 R-LOAD-004 R-ELEM-004 two elements without Blended Family are rejected (rule 6)', () => {
    const v = engine.validateLoadout(loadout([], ['tide', 'ember']), { level: 15 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(expect.objectContaining({ rule: 6 }));
  });

  it('R-LOAD-002 R-LOAD-004 below level 15 Blended Family is rejected (rule 2)', () => {
    const v = engine.validateLoadout(loadout([ID], ['tide', 'ember']), { level: 14 });
    expect(v.ok).toBe(false);
    expect(v.errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-ELEM-004 group A (pawns, knights, bishops) takes element A and group B (rooks, queen, king) element B', () => {
    const { state } = setup({
      white: { items: [ID], elements: ['tide', 'ember'] },
      black: { elements: ['grove'] },
    });
    const white = state.pieces.filter((p) => p.side === 'white');
    expect(white).toHaveLength(16);
    for (const p of white) {
      expect([p.type, p.element]).toEqual([p.type, GROUP_A.includes(p.type) ? 'tide' : 'ember']);
    }
    expect(white.filter((p) => p.element === 'tide')).toHaveLength(12);
    expect(white.filter((p) => p.element === 'ember')).toHaveLength(4);
    expect(state.pieces.filter((p) => p.side === 'black').every((p) => p.element === 'grove')).toBe(
      true,
    );
  });

  it('R-LOAD-002 R-ELEM-004 R-INFO-001 the opponent sees both elements and which group holds each', () => {
    const { engine: e, state } = setup({
      white: { items: [ID], elements: ['tide', 'ember'] },
      black: { elements: ['grove'] },
    });
    const pub = e.project(state, 'black');
    expect(pub.armies.white.elements).toEqual(['tide', 'ember']);
    for (const p of pub.pieces.filter((x) => x.side === 'white')) {
      expect([p.type, p.element]).toEqual([p.type, GROUP_A.includes(p.type) ? 'tide' : 'ember']);
    }
  });

  it('R-LOAD-002 R-ELEM-004 R-ELEM-002 silence is per piece: a group-A Tide knight is silenced by a Grove victim', () => {
    // Grove beats Tide: the Tide knight's Hit and Run is silenced; the Grove pawn's Poisoned Meat
    // is not, so it takes the knight.
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    const pawn = idAt(r.initial, 'd5');
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.side, e.ability, e.by])).toEqual([
      ['white', 'hit_and_run', pawn],
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.side, e.ability])).toEqual([
      ['black', 'poisoned_meat'],
    ]);
    expect(r.state.pieces[knight]?.square).toBe(-1);
  });

  it('R-LOAD-002 R-ELEM-004 R-ELEM-002 R-ELEM-005 silence and traits are per piece: a group-B Ember rook silences the Grove victim and ignites Hot Foot', () => {
    // Ember beats Grove: Poisoned Meat is silenced; the rook's Hit and Run (Tide affinity, not
    // attuned on an Ember rook) returns it to d1, which ignites d5 (Hot Foot is an Ember trait).
    const r = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['d1d5'],
    });
    const rook = idAt(r.initial, 'd1');
    expect(r.initial.pieces[rook]?.element).toBe('ember');
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.side, e.ability, e.by])).toEqual([
      ['black', 'poisoned_meat', rook],
    ]);
    expect(
      eventsOf(r.events, 'AbilityTriggered').map((e) => [e.side, e.ability, e.attuned]),
    ).toEqual([['white', 'hit_and_run', false]]);
    expect(pieceAt(r.state, 'd1')?.id).toBe(rook);
    expect(eventsOf(r.events, 'SquareIgnited').map((e) => e.square)).toEqual([sq('d5')]);
  });

  it('R-LOAD-002 R-ELEM-004 R-ELEM-003 attunement is per piece: Hit and Run is attuned on the Tide knight, not on the Ember rook', () => {
    const white = { items: [ID], elements: ['tide', 'ember'] as Loadout['elements'] };
    const knightRun = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { ...white, abilities: ['hit_and_run'] },
      black: {},
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('d4') }],
    });
    expect(eventsOf(knightRun.events, 'AbilityTriggered').map((e) => e.attuned)).toEqual([true]);
    expect(knightRun.prompts).toHaveLength(1);
    expect(knightRun.prompts[0]?.kind).toBe('square');
    expect(pieceAt(knightRun.state, 'd4')?.type).toBe('knight');

    const rookRun = scenario({
      fen: '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1',
      white: { ...white, abilities: ['hit_and_run'] },
      black: {},
      moves: ['d1d5'],
    });
    expect(eventsOf(rookRun.events, 'AbilityTriggered').map((e) => e.attuned)).toEqual([false]);
    expect(rookRun.prompts).toEqual([]);
    expect(pieceAt(rookRun.state, 'd1')?.type).toBe('rook');
  });

  it('R-LOAD-002 R-ELEM-004 R-ELEM-006 traits are per piece: Flow lets the Tide bishop pass its pawn, not the Ember rook', () => {
    const { engine: e, state } = setup({
      fen: '4k3/8/8/8/8/8/P2P4/R1B1K3 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'] },
      black: {},
    });
    const legal = e.legalMoves(state, 'white').map(moveToUci);
    expect(legal).toContain('c1e3');
    expect(legal).toContain('c1f4');
    expect(legal).not.toContain('a1a3');
    expect(legal).toContain('a1b1');
  });

  it('R-LOAD-002 R-ELEM-004 R-RULES-002 a promoted pawn takes group B’s element, and the opponent sees it', () => {
    const r = scenario({
      fen: '8/1P6/8/1r5k/8/8/8/K7 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'] },
      black: { elements: ['tide'] },
      moves: ['b7b8q'],
    });
    const pawn = idAt(r.initial, 'b7');
    expect(r.initial.pieces[pawn]?.element).toBe('tide');
    expect(r.state.pieces[pawn]?.type).toBe('queen');
    expect(r.state.pieces[pawn]?.element).toBe('ember');
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, side: 'white', to: 'queen', element: 'ember' }),
    ]);
    const seen = r.engine.project(r.state, 'black').pieces[pawn];
    expect(seen?.element).toBe('ember');
  });

  it('R-LOAD-002 R-ELEM-004 R-RULES-002 R-ELEM-002 after promotion silence uses the new group-B element', () => {
    // The promoted queen is Ember; it takes a Tide rook, and Tide beats Ember, so its Hit and Run is
    // silenced (as a Tide pawn it would not have been).
    const r = scenario({
      fen: '8/1P6/8/1r5k/8/8/8/K7 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'], abilities: ['hit_and_run'] },
      black: { elements: ['tide'] },
      moves: ['b7b8q', 'h5h4', 'b8b5'],
    });
    const queen = idAt(r.initial, 'b7');
    const rook = idAt(r.initial, 'b5');
    const last = r.steps[2]?.events ?? [];
    expect(eventsOf(last, 'AbilitySilenced').map((e) => [e.piece, e.ability, e.by])).toEqual([
      [queen, 'hit_and_run', rook],
    ]);
    expect(eventsOf(last, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'b5')?.id).toBe(queen);
  });

  it('R-LOAD-002 R-ELEM-004 DD-36 a promoting capture is judged with the pawn’s pre-promotion group-A element', () => {
    // A Tide pawn (group A) takes an Ember rook while promoting to an Ember queen (group B). Silence
    // uses the elements fixed at commit: Tide beats Ember, so the rook's Poisoned Meat is silenced
    // and the new queen survives.
    const r = scenario({
      fen: 'r7/1P6/7k/8/8/8/8/K7 w - - 0 1',
      white: { items: [ID], elements: ['tide', 'ember'] },
      black: { elements: ['ember'], abilities: ['poisoned_meat'] },
      moves: ['b7a8q'],
    });
    const pawn = idAt(r.initial, 'b7');
    const rook = idAt(r.initial, 'a8');
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => [e.piece, e.ability, e.by])).toEqual([
      [rook, 'poisoned_meat', pawn],
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(pieceAt(r.state, 'a8')?.id).toBe(pawn);
    expect(r.state.pieces[pawn]?.element).toBe('ember');
  });
});
