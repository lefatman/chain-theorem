import { describe, expect, it } from 'vitest';
import { setup } from '../src/testing.ts';

describe('overabundance', () => {
  it('R-ELEM-007 consumable abilities have double charges on Grove pieces only', () => {
    const grove = setup({ white: { elements: ['grove'], abilities: ['momentum'] } });
    const ember = setup({ white: { elements: ['ember'], abilities: ['momentum'] } });
    const knight = 1; // b1 knight in the start position
    expect(grove.engine.remainingCharges(grove.state, knight, 'momentum')).toBe(4);
    expect(ember.engine.remainingCharges(ember.state, knight, 'momentum')).toBe(2);
  });

  it('R-ELEM-007 abilities without charges are unaffected', () => {
    const grove = setup({ white: { elements: ['grove'], abilities: ['poisoned_meat'] } });
    expect(grove.engine.remainingCharges(grove.state, 1, 'poisoned_meat')).toBe(Infinity);
  });
});
