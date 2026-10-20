/**
 * Herald's Horn (R-LOAD-002; PLAYTEST; designer brief 2026-10-09, plan item C7; DD-128). At battle
 * start both players' full item lists are revealed: the engine's `items` reveal (cause effect, the
 * Horn as source) for each side, the Horn itself included, an empty list as complete. Item parameters
 * (the Masquerade Mask's chosen element) are not part of an item list and stay hidden. Two Horns
 * reveal the same facts once: host.ts deduplicates reveals. Cheap, symmetric information for the
 * surprise-loss metric and a hook for Dossier play (8.3).
 */
import { defineItem } from '@chain-theorem/rules/sdk';

const ID = 'heralds_horn';

export default defineItem({
  id: ID,
  name: "Herald's Horn",
  version: 1,
  slotCost: 1,
  minLevel: 7,
  hooks: {
    onBattleStart: (ctx) => {
      const owner = ctx.owner;
      if (!owner) return;
      ctx.revealSelf('observed');
      for (const side of ['white', 'black'] as const) {
        ctx.reveal(
          side,
          { kind: 'items', items: [...ctx.state.armies[side].loadout.items] },
          'effect',
          { kind: 'item', id: ID, side: owner },
        );
      }
    },
  },
  text: {
    short: 'Both item lists are read out at the start.',
    rules: "At battle start, both players' full item lists are revealed.",
  },
  status: 'PLAYTEST',
});
