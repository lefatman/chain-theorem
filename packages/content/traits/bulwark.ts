/**
 * Bulwark — Stone trait (D-29, R-ELEM-001; identity COMMITTED). The first effect capture targeting
 * each of your Stone pieces other than pawns each battle fizzles. Whether pawns are covered too is
 * the PLAYTEST knob `CAPS.TRAITS.BULWARK_PAWNS` (plan item B4, DD-113; the launch rule covered every
 * Stone piece). Public state (the fizzle is observable).
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
  version: 2,
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
      // DD-113 (B4): a Stone pawn is covered only when the knob says so.
      if (eff.target.type === 'pawn' && !ctx.caps.TRAITS.BULWARK_PAWNS) return 'allow';
      const s = ctx.slice<BulwarkState>(ID);
      if (s.spent.includes(eff.target.id)) return 'allow';
      ctx.setSlice<BulwarkState>({ spent: [...s.spent, eff.target.id] });
      return { fizzle: 'bulwark' };
    },
  },
  text: {
    short: 'The first effect capture against a non-pawn fizzles.',
    rules:
      'The first effect capture targeting each of your Stone pieces other than pawns each battle fizzles.',
  },
  status: 'COMMITTED',
});
