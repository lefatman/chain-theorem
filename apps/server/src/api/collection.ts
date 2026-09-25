/**
 * Collections (7.5): new accounts start with every level-1 module (Dual Adept's Glove, Hit and Run,
 * Last Word, Scout), enough for a legal level-1 loadout; rewards (M5) grow it. Ownership feeds
 * R-LOAD-004 rule 7.
 */
import { abilities, items } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type { PlayerFacts } from '@chain-theorem/rules';

export const STARTER_ITEMS = items.filter((i) => !i.retired && i.minLevel <= 1).map((i) => i.id);
export const STARTER_CARDS = abilities
  .filter((a) => !a.retired && a.minLevel <= 1)
  .map((a) => a.id);

export async function grantStarterCollection(db: Db, playerId: string): Promise<void> {
  for (const id of STARTER_ITEMS) await db.inventory.grant(playerId, 'item', id, 1);
  for (const id of STARTER_CARDS) await db.inventory.grant(playerId, 'card', id, 1);
}

/** What `validateLoadout` needs for a player: level and owned modules (qty ≥ 1). */
export async function playerFacts(db: Db, playerId: string, level: number): Promise<PlayerFacts> {
  const inv = await db.inventory.list(playerId);
  return {
    level,
    ownedItems: inv.items.filter((x) => x.qty > 0).map((x) => x.itemId),
    ownedAbilities: inv.cards.filter((x) => x.qty > 0).map((x) => x.abilityId),
  };
}
