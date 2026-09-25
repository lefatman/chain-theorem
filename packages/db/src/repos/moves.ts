/**
 * Inventory movements inside one atomic list, shared by trades and wager escrow (spec 10.4, 9.5;
 * R-SEC-004, DD-15).
 *
 * - Spends use `inventory.spendStatements` (insert a zero row, then decrement without a condition):
 *   an over-spend or a spend of something never owned violates CHECK (qty >= 0) and aborts the whole
 *   list on every engine, D1 batches included. Grants are upserts.
 * - Every row operation is emitted in one global order (table, player, content id, spend before
 *   grant). Two lists that touch the same rows therefore lock them in the same order on PostgreSQL,
 *   so a trade A→B racing a trade B→A queues instead of deadlocking.
 * - A PostgreSQL deadlock or serialization failure (a list that raced something unsorted, such as a
 *   reward grant) is retried a few times; nothing was written when it is reported.
 */
import type { CompiledQuery } from 'kysely';
import { ItemBundle } from '../json.ts';
import type { InventoryKind, InventoryRepo } from './inventory.ts';

export type MoveOp = 'spend' | 'grant';

/** One player's side of a movement: `spend` takes the bundle out, `grant` puts it in. */
export interface Move {
  playerId: string;
  op: MoveOp;
  bundle: ItemBundle;
}

/** Merges repeated ids, sorts by id and validates quantities (positive integers). */
export function normalizeBundle(input: ItemBundle): ItemBundle {
  const parsed = ItemBundle.parse(input);
  const items = new Map<string, number>();
  const cards = new Map<string, number>();
  for (const i of parsed.items) items.set(i.itemId, (items.get(i.itemId) ?? 0) + i.qty);
  for (const c of parsed.cards) cards.set(c.abilityId, (cards.get(c.abilityId) ?? 0) + c.qty);
  const byId = <T>(a: [string, T], b: [string, T]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    items: [...items].sort(byId).map(([itemId, qty]) => ({ itemId, qty })),
    cards: [...cards].sort(byId).map(([abilityId, qty]) => ({ abilityId, qty })),
  };
}

/** Both bundles together (normalized). */
export function mergeBundles(...bundles: ItemBundle[]): ItemBundle {
  return normalizeBundle({
    items: bundles.flatMap((b) => b.items),
    cards: bundles.flatMap((b) => b.cards),
  });
}

export function isEmptyBundle(b: ItemBundle): boolean {
  return b.items.length === 0 && b.cards.length === 0;
}

interface RowOp {
  kind: InventoryKind;
  playerId: string;
  id: string;
  qty: number;
  op: MoveOp;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The statements of all moves, in the global lock order (see the file comment). */
export function moveStatements(inventory: InventoryRepo, moves: readonly Move[]): CompiledQuery[] {
  const ops: RowOp[] = [];
  for (const m of moves) {
    const b = normalizeBundle(m.bundle);
    for (const i of b.items)
      ops.push({ kind: 'item', playerId: m.playerId, id: i.itemId, qty: i.qty, op: m.op });
    for (const c of b.cards)
      ops.push({ kind: 'card', playerId: m.playerId, id: c.abilityId, qty: c.qty, op: m.op });
  }
  ops.sort(
    (x, y) =>
      cmp(x.kind, y.kind) ||
      cmp(x.playerId, y.playerId) ||
      cmp(x.id, y.id) ||
      (x.op === y.op ? 0 : x.op === 'spend' ? -1 : 1),
  );
  return ops.flatMap((o) =>
    o.op === 'spend'
      ? inventory.spendStatements(o.playerId, o.kind, o.id, o.qty)
      : [inventory.grantStatement(o.playerId, o.kind, o.id, o.qty)],
  );
}

/** SQLSTATEs PostgreSQL reports for a transaction it rolled back because of a lock race. */
const RETRYABLE = new Set(['40P01', '40001']);

function retryable(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 3 && e && typeof e === 'object'; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Runs `f`, retrying a PostgreSQL deadlock or serialization failure up to `attempts` times. */
export async function withLockRetry<T>(f: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (err) {
      if (i >= attempts || !retryable(err)) throw err;
    }
  }
}
