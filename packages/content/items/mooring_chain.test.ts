/**
 * Mooring Chain scenario tests (R-LOAD-002, M7 7.3): 1 slot, level 8. The first time one of the
 * opponent's abilities would move one of the wearer's pieces this battle, that move fizzles.
 *
 * Expected behaviour comes from spec 5.2 (MOVE), 7.2 (every non-capacity item costs 1 slot), 7.4
 * (R-LOAD-004), 8.2 (items are revealed when their effect is observable) and DD-35, not from the
 * engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import type { MooringState } from './mooring_chain.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
const ID = 'mooring_chain';
/** Knight c3 takes the Frost Heave pawn d5; later the knight takes another Frost Heave pawn f5. */
const FEN = '4k3/8/8/3p1p2/8/2N5/8/4K3 w - - 0 1';

describe('mooring stone (R-LOAD-002)', () => {
  it('R-LOAD-002 R-LOAD-004 a 1-slot utility item that validates at level 8 and is rejected at level 7 (rule 2)', () => {
    const def = itemById.get(ID);
    expect(def).toMatchObject({ slotCost: 1, minLevel: 8, status: 'PLAYTEST' });
    expect(def?.capacity).toBeUndefined();
    const l: Loadout = { elements: ['stone'], items: [ID], sets: [['buttress']] };
    expect(engine.validateLoadout(l, { level: 8 }).errors).toEqual([]);
    expect(engine.validateLoadout(l, { level: 7 }).errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-INFO-002 the first enemy push fizzles (protected) and reveals the Chain; the second push works', () => {
    const r = scenario({
      fen: FEN,
      white: { items: [ID] },
      black: { abilities: ['frost_heave'] },
      moves: ['c3d5', 'e8d8', 'd5e3', 'd8e8', 'e3f5'],
    });
    const knight = idAt(r.initial, 'c3');
    const first = r.steps[0]?.events ?? [];
    expect(eventsOf(first, 'EffectFizzled')).toEqual([
      expect.objectContaining({
        ability: 'frost_heave',
        reason: 'protected',
        target: knight,
        source: { kind: 'item', id: ID, side: 'white' },
      }),
    ]);
    expect(r.steps[0]?.events.some((e) => e.k === 'Revealed' && e.side === 'white')).toBe(true);
    expect(r.state.reveals.white.items).toContain(ID);
    expect((r.state.slices[ID] as MooringState).used).toEqual({ white: true, black: false });
    // The second capture's push is not stopped: the knight goes back to e3.
    const last = r.steps[4]?.events ?? [];
    expect(eventsOf(last, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('f5'), to: sq('e3') }),
    ]);
    expect(pieceAt(r.state, 'e3')?.id).toBe(knight);
  });

  it('R-LOAD-002 the wearer’s own moves are never stopped and do not use it up', () => {
    const r = scenario({
      fen: FEN,
      white: { items: [ID], abilities: ['hit_and_run'] },
      moves: ['c3d5'],
    });
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
    expect((r.state.slices[ID] as MooringState).used.white).toBe(false);
    expect(r.state.reveals.white.items).toEqual([]);
  });

  it('R-LOAD-002 it guards only its wearer: Black’s Chain does not stop a push of White’s knight', () => {
    const r = scenario({
      fen: FEN,
      black: { items: [ID], abilities: ['frost_heave'] },
      moves: ['c3d5'],
    });
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
    expect(r.state.reveals.black.items).toEqual([]);
  });

  it('R-INFO-005 R-SEC-001 before it acts, Black’s projection never names the Mooring Chain', () => {
    const r = scenario({ fen: FEN, white: { items: [ID] } });
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain(ID);
  });
});
