/**
 * Inventory of items and ability cards (spec 13.3). Quantities carry CHECK (qty >= 0).
 *
 * Race safety without SELECT ... FOR UPDATE (spec 13.6, R-SEC-004, DD-15):
 * - `spend()` alone is one conditional update, `qty = qty - n WHERE qty >= n`, and the affected-row
 *   count says whether it happened.
 * - Inside an atomic list, `spendStatements()` makes sure the row exists (insert 0, ignore conflict)
 *   and then decrements without a condition, so an over-spend or a spend of something never owned
 *   violates the CHECK and rolls back the whole list on every engine, D1 batches included.
 */
import type { CompiledQuery } from 'kysely';
import { rows, type RepoContext } from '../db-types.ts';

export type InventoryKind = 'item' | 'card';

export interface Inventory {
  items: { itemId: string; qty: number }[];
  cards: { abilityId: string; qty: number }[];
}

function checkQty(qty: number): void {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError(`quantity must be a positive integer: ${qty}`);
}

export function inventoryRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  function grantStatement(
    playerId: string,
    kind: InventoryKind,
    id: string,
    qty: number,
  ): CompiledQuery {
    checkQty(qty);
    if (kind === 'item') {
      return k
        .insertInto('inventory_items')
        .values({ player_id: playerId, item_id: id, qty })
        .onConflict((oc) =>
          oc.columns(['player_id', 'item_id']).doUpdateSet((eb) => ({
            qty: eb('inventory_items.qty', '+', eb.ref('excluded.qty')),
          })),
        )
        .compile();
    }
    return k
      .insertInto('inventory_cards')
      .values({ player_id: playerId, ability_id: id, qty })
      .onConflict((oc) =>
        oc.columns(['player_id', 'ability_id']).doUpdateSet((eb) => ({
          qty: eb('inventory_cards.qty', '+', eb.ref('excluded.qty')),
        })),
      )
      .compile();
  }

  function spendStatements(
    playerId: string,
    kind: InventoryKind,
    id: string,
    qty: number,
  ): CompiledQuery[] {
    checkQty(qty);
    if (kind === 'item') {
      return [
        k
          .insertInto('inventory_items')
          .values({ player_id: playerId, item_id: id, qty: 0 })
          .onConflict((oc) => oc.columns(['player_id', 'item_id']).doNothing())
          .compile(),
        k
          .updateTable('inventory_items')
          .set((eb) => ({ qty: eb('qty', '-', qty) }))
          .where('player_id', '=', playerId)
          .where('item_id', '=', id)
          .compile(),
      ];
    }
    return [
      k
        .insertInto('inventory_cards')
        .values({ player_id: playerId, ability_id: id, qty: 0 })
        .onConflict((oc) => oc.columns(['player_id', 'ability_id']).doNothing())
        .compile(),
      k
        .updateTable('inventory_cards')
        .set((eb) => ({ qty: eb('qty', '-', qty) }))
        .where('player_id', '=', playerId)
        .where('ability_id', '=', id)
        .compile(),
    ];
  }

  return {
    /** Items and cards with a positive quantity, sorted by id. */
    async list(playerId: string): Promise<Inventory> {
      const [items, cards] = await Promise.all([
        k
          .selectFrom('inventory_items')
          .select(['item_id', 'qty'])
          .where('player_id', '=', playerId)
          .where('qty', '>', 0)
          .orderBy('item_id')
          .execute(),
        k
          .selectFrom('inventory_cards')
          .select(['ability_id', 'qty'])
          .where('player_id', '=', playerId)
          .where('qty', '>', 0)
          .orderBy('ability_id')
          .execute(),
      ]);
      return {
        items: items.map((r) => ({ itemId: r.item_id, qty: r.qty })),
        cards: cards.map((r) => ({ abilityId: r.ability_id, qty: r.qty })),
      };
    },

    /** Current quantity (0 when never owned). */
    async qty(playerId: string, kind: InventoryKind, id: string): Promise<number> {
      const row =
        kind === 'item'
          ? await k
              .selectFrom('inventory_items')
              .select('qty')
              .where('player_id', '=', playerId)
              .where('item_id', '=', id)
              .executeTakeFirst()
          : await k
              .selectFrom('inventory_cards')
              .select('qty')
              .where('player_id', '=', playerId)
              .where('ability_id', '=', id)
              .executeTakeFirst();
      return row?.qty ?? 0;
    },

    /** Adds `qty` (upsert). Use `rewards.grant()` for anything earned in play (R-SEC-003). */
    async grant(playerId: string, kind: InventoryKind, id: string, qty: number): Promise<void> {
      await ctx.atomic([grantStatement(playerId, kind, id, qty)]);
    },

    /** Conditional spend `qty = qty - n WHERE qty >= n`; true when it happened (R-SEC-004). */
    async spend(playerId: string, kind: InventoryKind, id: string, qty: number): Promise<boolean> {
      checkQty(qty);
      const r =
        kind === 'item'
          ? await k
              .updateTable('inventory_items')
              .set((eb) => ({ qty: eb('qty', '-', qty) }))
              .where('player_id', '=', playerId)
              .where('item_id', '=', id)
              .where('qty', '>=', qty)
              .executeTakeFirst()
          : await k
              .updateTable('inventory_cards')
              .set((eb) => ({ qty: eb('qty', '-', qty) }))
              .where('player_id', '=', playerId)
              .where('ability_id', '=', id)
              .where('qty', '>=', qty)
              .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1;
    },

    /** Statement adding `qty`, for atomic lists. */
    grantStatement,
    /** Statements removing `qty`, for atomic lists; an over-spend aborts the list (CHECK). */
    spendStatements,
  };
}

export type InventoryRepo = ReturnType<typeof inventoryRepo>;
