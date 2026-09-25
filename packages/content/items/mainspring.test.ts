/**
 * Mainspring scenario tests (R-LOAD-002, M7 7.3): 1 slot, level 11. Every consumable `replay`
 * ability of the wearer has one more charge on each of the wearer's pieces.
 *
 * Expected behaviour comes from spec 5.4 and 5.6 (charges), 6.1 (Overabundance), 7.2, 7.4, 8.2 and
 * DD-17, DD-28, DD-30, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption, Loadout } from '@chain-theorem/rules';
import { engine, itemById } from '../index.ts';
import { eventsOf, idAt, parseSquare, scenario } from '../src/testing.ts';

const sq = parseSquare;
const ID = 'mainspring';
// Knight c3 takes d5 (Momentum or Slipstream on the knight); Black also has a knight b8.
const FEN = '1n2k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1';
const step: ChoiceOption = { kind: 'move', from: sq('d5'), to: sq('e3') };

describe('mainspring (R-LOAD-002)', () => {
  it('R-LOAD-002 R-LOAD-004 a 1-slot utility item that validates at level 11 and is rejected at level 10 (rule 2)', () => {
    expect(itemById.get(ID)).toMatchObject({ slotCost: 1, minLevel: 11, status: 'PLAYTEST' });
    const l: Loadout = { elements: ['storm'], items: [ID], sets: [['squall']] };
    expect(engine.validateLoadout(l, { level: 11 }).errors).toEqual([]);
    expect(engine.validateLoadout(l, { level: 10 }).errors).toContainEqual(
      expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
    );
  });

  it('R-LOAD-002 R-ELEM-007 consumable replay abilities get one more charge (after Overabundance doubles them)', () => {
    const counts = (elements: Loadout['elements'], ability: string, items: string[]) => {
      const r = scenario({ fen: FEN, white: { elements, abilities: [ability], items } });
      return r.engine.remainingCharges(r.state, idAt(r.state, 'c3'), ability);
    };
    expect(counts(['neutral'], 'momentum', [ID])).toBe(3);
    expect(counts(['neutral'], 'slipstream', [ID])).toBe(2);
    expect(counts(['grove'], 'momentum', [ID])).toBe(5);
    expect(counts(['neutral'], 'momentum', [])).toBe(2);
    // Not replay (Rebirth, Rebuild: revive) or not consumable (Squall): unchanged.
    expect(counts(['neutral'], 'rebirth', [ID])).toBe(1);
    expect(counts(['neutral'], 'rebuild', [ID])).toBe(1);
  });

  it('R-LOAD-002 only the wearer’s pieces gain the charge', () => {
    const r = scenario({
      fen: FEN,
      white: { items: [ID] },
      black: { abilities: ['momentum'] },
    });
    expect(r.engine.remainingCharges(r.state, idAt(r.state, 'd5'), 'momentum')).toBe(2);
  });

  it('R-INFO-002 DD-30 the Mainspring is revealed when a named ability’s public remaining count shows the extra charge', () => {
    const r = scenario({
      fen: FEN,
      white: { items: [ID], abilities: ['momentum'] },
      moves: ['c3d5'],
      answers: [step],
    });
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'momentum', remaining: 2 }),
    ]);
    expect(r.state.reveals.white.items).toEqual([ID]);
    const pub = r.engine.projectEvents(r.state, r.events, 'black');
    expect(pub.some((e) => e.k === 'Revealed' && e.info.kind === 'item')).toBe(true);
  });

  it('R-INFO-002 DD-28 under Veil the count is not public, so the Mainspring stays hidden', () => {
    const r = scenario({
      fen: FEN,
      white: { items: [ID], abilities: ['momentum', 'veil'] },
      moves: ['c3d5'],
      answers: [step],
    });
    expect(eventsOf(r.events, 'ChargeSpent')).toHaveLength(1);
    expect(r.state.reveals.white.items).toEqual([]);
    expect(JSON.stringify(r.engine.project(r.state, 'black'))).not.toContain(ID);
  });
});
