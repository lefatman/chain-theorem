/**
 * Ability knowledge for the ability-aware evaluation (3.3, 9.4 R-FMT-005). Profiles come from the
 * abilities' effect primitives, never from their ids, and per-side knowledge is built only from
 * what the viewer may see: its own loadout and the opponent's revealed abilities (R-INFO-005).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Loadout } from '@chain-theorem/rules';
import { abilityById, engine } from '../../content/index.ts';
import { play } from '../../content/src/testing.ts';
import { profileOf, sideKnowledge, silenced } from './knowledge.ts';

function ability(id: string): AbilityDef {
  const def = abilityById.get(id);
  if (!def) throw new Error(`unknown ability ${id}`);
  return def;
}

describe('ability profiles from effect data (R-FMT-005, R-ABIL-002)', () => {
  const cases: [string, Partial<ReturnType<typeof profileOf>>][] = [
    ['poisoned_meat', { killsCaptor: true, killsOther: false }],
    ['backdraft', { killsOther: true, killsCaptor: false }],
    ['cleave', { killsOther: true }],
    ['riposte', { bonus: true }],
    ['momentum', { bonus: true }],
    ['rebirth', { selfRevive: true }],
    ['reinforce', { reviveFriendly: true }],
    ['pierce', { negatesVictim: true }],
    ['antidote', { protectsSelf: true }],
    ['last_word', { reveals: true }],
    ['scout', { reveals: true }],
  ];
  for (const [id, expected] of cases) {
    it(`R-FMT-005 ${id} is profiled from its effect primitives`, () => {
      expect(profileOf(ability(id))).toMatchObject(expected);
    });
  }

  it('R-FMT-005 passives with no capture effect have an empty profile', () => {
    for (const id of ['stalwart', 'veil']) {
      expect(Object.values(profileOf(ability(id))).some(Boolean)).toBe(false);
    }
  });

  it('R-FMT-005 a renamed copy of an ability gets the same profile (data, not ids)', () => {
    const pm = ability('poisoned_meat');
    const clone: AbilityDef = { ...pm, id: 'test_clone', name: 'Test Clone' };
    expect(profileOf(clone)).toEqual(profileOf(pm));
  });
});

describe('side knowledge uses only visible information (R-FMT-005, R-INFO-005)', () => {
  const MEAT: Loadout = { elements: ['grove'], items: [], sets: [['poisoned_meat']] };
  const PLAIN: Loadout = { elements: ['grove'], items: [], sets: [[]] };

  function battle() {
    return engine.newBattle({
      format: 'full',
      white: { level: 20, loadout: PLAIN },
      black: { level: 20, loadout: MEAT },
      fen: '4k3/8/8/3pp3/3P4/8/8/4K3 w - - 0 1',
    }).state;
  }

  it('R-FMT-005 R-INFO-005 a hidden Poisoned Meat is unknown to the NPC and its pawns stay uncertain', () => {
    const state = battle();
    const belief = engine.beliefState(engine.project(state, 'white'), PLAIN);
    const k = sideKnowledge(engine, belief, 'black', 'white');
    expect(k.pawn.captured.killsCaptor).toBe(false);
    expect(k.pawn.count).toBe(0);
    expect(k.pawn.uncertain).toBe(true);
    // Its own side is never uncertain.
    expect(sideKnowledge(engine, belief, 'white', 'white').pawn.uncertain).toBe(false);
  });

  it('R-FMT-005 R-INFO-002 once Poisoned Meat fires it is known on pawns only', () => {
    const state = play(engine, battle(), 'd4e5').state;
    const belief = engine.beliefState(engine.project(state, 'white'), PLAIN);
    const k = sideKnowledge(engine, belief, 'black', 'white');
    expect(k.pawn.captured.killsCaptor).toBe(true);
    expect(k.pawn.count).toBe(1);
    // Knowledge is per piece type (8.2): other black types are still a blank.
    expect(k.knight.captured.killsCaptor).toBe(false);
    expect(k.knight.uncertain).toBe(true);
  });

  it('R-FMT-005 the NPC knows its own abilities in full', () => {
    const state = battle();
    const belief = engine.beliefState(engine.project(state, 'black'), MEAT);
    const k = sideKnowledge(engine, belief, 'black', 'black');
    for (const t of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const) {
      expect(k[t].captured.killsCaptor, t).toBe(true);
      expect(k[t].uncertain, t).toBe(false);
    }
  });

  it('R-FMT-005 R-ELEM-002 silence follows the element triangle (Ember > Grove > Tide > Ember)', () => {
    expect(silenced('ember', 'grove')).toEqual({ victim: true, captor: false });
    expect(silenced('grove', 'ember')).toEqual({ victim: false, captor: true });
    expect(silenced('neutral', 'ember')).toEqual({ victim: false, captor: false });
  });
});
