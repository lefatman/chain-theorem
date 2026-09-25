/**
 * Bulwark — Stone trait (D-29, R-ELEM-001, COMMITTED). The first effect capture targeting each of
 * your Stone pieces each battle fizzles. Public state (the fizzle is observable).
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export interface BulwarkState {
  /** Piece ids whose Bulwark has been spent. */
  spent: number[];
}
const ID = 'bulwark';

export default defineTrait({
  id: ID,
  name: 'Bulwark',
  element: 'stone',
  version: 1,
  hooks: {
    // Public: both players see the fizzle, so spectators may see the spent list too (M7 7.2).
    stateSlice: {
      id: ID,
      init: (): BulwarkState => ({ spent: [] }),
      project: (value) => value,
      spectate: (value) => value,
    },
    effectIntercept: (ctx, eff) => {
      if (eff.kind !== 'effectCapture' || eff.target.element !== 'stone') return 'allow';
      const s = ctx.slice<BulwarkState>(ID);
      if (s.spent.includes(eff.target.id)) return 'allow';
      ctx.setSlice<BulwarkState>({ spent: [...s.spent, eff.target.id] });
      return { fizzle: 'bulwark' };
    },
  },
  text: {
    short: 'The first effect capture against it fizzles.',
    rules: 'The first effect capture targeting each of your Stone pieces each battle fizzles.',
  },
  status: 'COMMITTED',
});
