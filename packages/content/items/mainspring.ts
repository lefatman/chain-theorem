/**
 * Mainspring (M7 7.3, R-LOAD-002; PLAYTEST). Every consumable `replay` ability of the wearer (one
 * that grants a bonus move and has charges: Momentum, Slipstream) has one more charge on each of the
 * wearer's pieces. Storm's tempo (6.1) as a build choice for any element.
 *
 * `modifyCharges` hooks chain after the traits (13.5 hook order), so a Grove piece's Overabundance
 * doubles first and the Mainspring adds one: Momentum 2 -> 5 on a Grove piece. The extra charge
 * becomes observable in the public remaining count of a `ChargeSpent` event for an ability the
 * opponent can name (8.2, R-INFO-002), so the item is revealed then (DD-30); a Veiled ability's count
 * is not public and keeps it hidden.
 */
import { defineItem } from '@chain-theorem/rules/sdk';

const ID = 'mainspring';

export default defineItem({
  id: ID,
  name: 'Mainspring',
  version: 1,
  slotCost: 1,
  minLevel: 11,
  hooks: {
    modifyCharges: (ctx, piece, ability, charges) => {
      const owner = ctx.owner;
      if (!owner || piece.side !== owner) return charges;
      if (!ability.tags.includes('replay') || ability.limits.charges === undefined) return charges;
      return charges + 1;
    },
    onEvent: (ctx, ev) => {
      const owner = ctx.owner;
      if (!owner || ev.k !== 'ChargeSpent' || ev.side !== owner || ev.ability === null) return;
      const def = ctx.registry.abilities.find((a) => a.id === ev.ability);
      if (!def?.tags.includes('replay')) return;
      const reveals = ctx.state.reveals[owner];
      if (!(reveals.abilities[ev.pieceType] ?? []).includes(ev.ability)) return;
      if (reveals.items.includes(ID)) return;
      ctx.revealSelf('observed');
    },
  },
  text: {
    short: 'Bonus-move abilities get one more charge.',
    rules:
      'Every ability of yours that grants a bonus move and has charges has one more charge on each of your pieces.',
  },
  status: 'PLAYTEST',
});
