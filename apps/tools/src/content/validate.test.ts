/**
 * content:validate (13.5): the shipped registry passes, and the effect rules the types cannot
 * express are caught (INV-01, tags read by Warden's Stopwatch and the revive rules).
 */
import { describe, expect, it } from 'vitest';
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';
import { effectProblems, validateContent } from './validate.ts';

const base = {
  id: 'x',
  name: 'X',
  version: 1,
  category: 'CAPTURES' as const,
  affinity: 'ember' as const,
  eligible: 'all' as const,
  minLevel: 1,
  slotCost: 1,
  limits: { perAction: 1 as const },
  text: { short: 'x', rules: 'x' },
  status: 'PLAYTEST' as const,
};
const bonus = fx.bonusAction({ movers: 'self', capture: 'none', optional: true });

describe('content:validate', () => {
  it('R-DATA-005 INV-01 the shipped registry is valid', () => {
    expect(validateContent()).toEqual([]);
  });

  it('INV-01 two bonus actions in one activation are rejected, also through append attunement', () => {
    expect(
      effectProblems(defineAbility({ ...base, tags: ['replay'], effects: [bonus, bonus] })),
    ).toContain('at most one bonusAction per activation (INV-01)');
    const appended = defineAbility({
      ...base,
      tags: ['replay'],
      effects: [bonus],
      attuned: { mode: 'append', effects: [fx.when({ survives: 'self' }, [bonus])] },
    });
    expect(effectProblems(appended)).toContain('at most one bonusAction per activation (INV-01)');
  });

  it('R-DATA-005 tags must match the effects', () => {
    expect(effectProblems(defineAbility({ ...base, tags: [], effects: [bonus] }))).toEqual([
      "a bonusAction needs the 'replay' tag",
    ]);
    const revive = fx.atChainEnd([fx.revive(target.self(), square.start())]);
    expect(effectProblems(defineAbility({ ...base, tags: [], effects: [revive] }))).toEqual([
      "a revive effect needs the 'revive' tag",
    ]);
    expect(
      effectProblems(
        defineAbility({
          ...base,
          tags: ['revive'],
          effects: [fx.move(target.self(), square.origin())],
        }),
      ),
    ).toEqual(["'revive' tag without a revive effect"]);
  });
});
