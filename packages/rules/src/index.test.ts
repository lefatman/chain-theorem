import { describe, expect, it } from 'vitest';

describe('skeleton', () => {
  it('R-DATA-001 rules package loads', async () => {
    const mod = await import('./index.ts');
    expect(mod).toBeDefined();
  });
});
