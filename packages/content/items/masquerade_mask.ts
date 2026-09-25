/**
 * Masquerade Mask (R-LOAD-002, D-31; PLAYTEST). The opponent sees an element you choose until your
 * first silence event (DD-26): one chosen element for all your pieces. Any silence involving one of
 * your pieces, in either direction, drops the mask and reveals the item.
 */
import { defineItem } from '@chain-theorem/rules/sdk';
import type { Side } from '@chain-theorem/rules';

export interface MaskState {
  active: Record<Side, boolean>;
}
const ID = 'masquerade_mask';

export default defineItem({
  id: ID,
  name: 'Masquerade Mask',
  version: 1,
  slotCost: 1,
  minLevel: 14,
  param: { element: 'required' },
  hooks: {
    // Private slice (never projected): whether each side's mask is still up.
    stateSlice: {
      id: ID,
      init: (ctx): MaskState => ({
        active: {
          white: ctx.hasItem('white', ID) && ctx.itemParam('white', ID)?.element !== undefined,
          black: ctx.hasItem('black', ID) && ctx.itemParam('black', ID)?.element !== undefined,
        },
      }),
    },
    revealFilter: {
      element: (ctx, viewer, piece) => {
        const owner = ctx.owner;
        if (!owner || piece.side !== owner || viewer === owner) return undefined;
        if (!ctx.slice<MaskState>(ID).active[owner]) return undefined;
        return ctx.itemParam(owner, ID)?.element;
      },
    },
    onEvent: (ctx, ev) => {
      const owner = ctx.owner;
      if (!owner || ev.k !== 'AbilitySilenced') return;
      const s = ctx.slice<MaskState>(ID);
      if (!s.active[owner]) return;
      const other = ctx.piece(ev.by);
      if (ev.side !== owner && other.side !== owner) return;
      ctx.setSlice<MaskState>({ active: { ...s.active, [owner]: false } });
      ctx.revealSelf('observed');
      const els = ctx.state.armies[owner].loadout.elements;
      ctx.reveal(owner, { kind: 'elements', elements: [...els] }, 'observed');
    },
  },
  text: {
    short: 'Show a false element until your first silence.',
    rules:
      'Your opponent sees an element you choose for your army until the first silence event involving one of your pieces.',
  },
  status: 'PLAYTEST',
});
