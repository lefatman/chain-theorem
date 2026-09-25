/**
 * Saved loadouts after items change hands (spec 10.4, M6 6.1): "trading away an item used in a saved
 * loadout marks that loadout invalid until fixed". After a trade, an escrow or a wager settlement the
 * stored flag of each of the player's saved loadouts is recomputed with the rules engine against the
 * collection as it is now (R-LOAD-004); a loadout that becomes legal again (a draw returned the item)
 * is marked valid again.
 */
import { engine } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type { Loadout } from '@chain-theorem/rules';
import { playerFacts } from '../api/collection.ts';

/** Recomputes `is_valid`; resolves to the names of loadouts that were valid and are not any more. */
export async function revalidateLoadouts(db: Db, playerId: string, now: number): Promise<string[]> {
  const p = await db.players.getById(playerId);
  if (!p) return [];
  const facts = await playerFacts(db, playerId, p.level);
  const broken: string[] = [];
  for (const l of await db.loadouts.list(playerId)) {
    const ok = engine.validateLoadout(l.loadout as Loadout, facts).ok;
    if (ok === l.isValid) continue;
    await db.loadouts.setValid(playerId, l.id, ok, now);
    if (!ok) broken.push(l.name);
  }
  return broken;
}
