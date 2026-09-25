/**
 * Inventory, atomic statement lists and idempotent rewards on every engine (R-SEC-003, R-SEC-004,
 * DD-15). Race safety comes from conditional updates and constraints, never SELECT ... FOR UPDATE.
 */
import { describe, expect, it } from 'vitest';
import { DbConstraintError } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

describe.each(ENGINES)('inventory, atomic lists and rewards on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-004 grant, list and conditional spend of items and cards', async () => {
        const p = await makePlayer(db());
        await db().inventory.grant(p.id, 'item', 'quick_boots', 2);
        await db().inventory.grant(p.id, 'item', 'quick_boots', 1);
        await db().inventory.grant(p.id, 'card', 'ember_burst', 4);
        expect(await db().inventory.list(p.id)).toEqual({
          items: [{ itemId: 'quick_boots', qty: 3 }],
          cards: [{ abilityId: 'ember_burst', qty: 4 }],
        });
        expect(await db().inventory.spend(p.id, 'item', 'quick_boots', 3)).toBe(true);
        expect(await db().inventory.spend(p.id, 'item', 'quick_boots', 1)).toBe(false);
        expect(await db().inventory.spend(p.id, 'card', 'ember_burst', 5)).toBe(false);
        expect(await db().inventory.spend(p.id, 'card', 'never_owned', 1)).toBe(false);
        expect(await db().inventory.qty(p.id, 'item', 'quick_boots')).toBe(0);
        expect(await db().inventory.list(p.id)).toEqual({
          items: [],
          cards: [{ abilityId: 'ember_burst', qty: 4 }],
        });
        await expect(db().inventory.grant(p.id, 'item', 'x', 0)).rejects.toThrow(RangeError);
        await expect(db().inventory.spend(p.id, 'item', 'x', -1)).rejects.toThrow(RangeError);
      });

      it('R-SEC-004 parallel spends never drive a quantity negative', async () => {
        const p = await makePlayer(db());
        await db().inventory.grant(p.id, 'item', 'gem', 10);
        const results = await Promise.all(
          Array.from({ length: 20 }, () => db().inventory.spend(p.id, 'item', 'gem', 3)),
        );
        expect(results.filter(Boolean)).toHaveLength(3);
        expect(await db().inventory.qty(p.id, 'item', 'gem')).toBe(1);
      });

      it('R-SEC-004 parallel atomic transfers neither duplicate nor lose items', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'card', 'tide_pull', 10);
        const transfer = () =>
          db().atomic([
            ...db().inventory.spendStatements(a.id, 'card', 'tide_pull', 3),
            db().inventory.grantStatement(b.id, 'card', 'tide_pull', 3),
          ]);
        const outcomes = await Promise.allSettled(Array.from({ length: 12 }, transfer));
        const done = outcomes.filter((o) => o.status === 'fulfilled');
        const failed = outcomes.filter((o) => o.status === 'rejected');
        expect(done).toHaveLength(3);
        for (const f of failed) {
          expect(f.reason).toBeInstanceOf(DbConstraintError);
          expect((f.reason as DbConstraintError).kind).toBe('check');
        }
        expect(await db().inventory.qty(a.id, 'card', 'tide_pull')).toBe(1);
        expect(await db().inventory.qty(b.id, 'card', 'tide_pull')).toBe(9);
      });

      it('R-SEC-004 atomic list rolls back entirely when one statement violates a constraint', async () => {
        const p = await makePlayer(db());
        const q = await makePlayer(db());
        await db().inventory.grant(p.id, 'item', 'lantern', 2);
        const before = [await db().inventory.list(p.id), await db().inventory.list(q.id)];
        const err = await db()
          .atomic([
            db().inventory.grantStatement(q.id, 'item', 'lantern', 5),
            db().inventory.grantStatement(p.id, 'card', 'grove_root', 1),
            ...db().inventory.spendStatements(p.id, 'item', 'lantern', 3), // over-spend: CHECK fails
            db().audit.appendStatement({ playerId: p.id, kind: 'test' }),
          ])
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DbConstraintError);
        expect((err as DbConstraintError).kind).toBe('check');
        expect([await db().inventory.list(p.id), await db().inventory.list(q.id)]).toEqual(before);
        expect(await db().audit.listForPlayer(p.id)).toEqual([]);
      });

      it('R-SEC-004 spending something never owned aborts the atomic list', async () => {
        const p = await makePlayer(db());
        const err = await db()
          .atomic([
            db().inventory.grantStatement(p.id, 'item', 'coin', 1),
            ...db().inventory.spendStatements(p.id, 'card', 'never_owned', 1),
          ])
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DbConstraintError);
        expect(await db().inventory.list(p.id)).toEqual({ items: [], cards: [] });
      });

      it('R-SEC-004 atomic returns affected-row counts in order', async () => {
        const p = await makePlayer(db());
        await db().inventory.grant(p.id, 'item', 'coin', 5);
        const counts = await db().atomic([
          ...db().inventory.spendStatements(p.id, 'item', 'coin', 2),
          db()
            .kysely.updateTable('players')
            .set({ zone_id: 'academy' })
            .where('id', '=', 'nobody')
            .compile(),
          db()
            .kysely.updateTable('players')
            .set({ zone_id: 'academy' })
            .where('id', '=', p.id)
            .compile(),
        ]);
        expect(counts).toEqual([0, 1, 0, 1]);
        expect(await db().atomic([])).toEqual([]);
      });

      it('R-SEC-003 reward grant is idempotent per key: the second grant changes nothing', async () => {
        const p = await makePlayer(db());
        const grant = {
          key: 'battle:0199a0c0-0000-7000-8000-000000000001',
          playerId: p.id,
          items: [{ itemId: 'ember_charm', qty: 1 }],
          cards: [{ abilityId: 'spark', qty: 2 }],
          xp: 40,
          at: Date.UTC(2026, 8, 25),
        };
        const first = await db().rewards.grant(grant);
        expect(first.status).toBe('granted');
        const second = await db().rewards.grant(grant);
        expect(second).toEqual({ status: 'duplicate' });
        expect(await db().inventory.list(p.id)).toEqual({
          items: [{ itemId: 'ember_charm', qty: 1 }],
          cards: [{ abilityId: 'spark', qty: 2 }],
        });
        expect((await db().players.getById(p.id))?.xp).toBe(40);
        const stored = await db().rewards.get(grant.key, p.id);
        expect(stored).toEqual({
          id: first.status === 'granted' ? first.grant.id : '',
          key: grant.key,
          playerId: p.id,
          payload: { items: grant.items, cards: grant.cards, xp: 40 },
          at: grant.at,
        });
      });

      it('R-SEC-003 concurrent grants with one key pay out exactly once', async () => {
        const p = await makePlayer(db());
        const grant = {
          key: 'quest:academy:3',
          playerId: p.id,
          items: [{ itemId: 'map', qty: 1 }],
          xp: 10,
        };
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, () => db().rewards.grant(grant)),
        );
        expect(outcomes.filter((o) => o.status === 'granted')).toHaveLength(1);
        expect(outcomes.filter((o) => o.status === 'duplicate')).toHaveLength(7);
        expect(await db().inventory.qty(p.id, 'item', 'map')).toBe(1);
        expect((await db().players.getById(p.id))?.xp).toBe(10);
      });

      it('R-SEC-003 the same battle key rewards each player once', async () => {
        const white = await makePlayer(db());
        const black = await makePlayer(db());
        const key = 'battle:shared';
        expect((await db().rewards.grant({ key, playerId: white.id, xp: 5 })).status).toBe(
          'granted',
        );
        expect((await db().rewards.grant({ key, playerId: black.id, xp: 3 })).status).toBe(
          'granted',
        );
        expect((await db().rewards.grant({ key, playerId: white.id, xp: 5 })).status).toBe(
          'duplicate',
        );
        expect((await db().players.getById(white.id))?.xp).toBe(5);
        expect((await db().players.getById(black.id))?.xp).toBe(3);
      });

      it('R-SEC-003 a composed list (finish battle + grant) is all-or-nothing', async () => {
        const p = await makePlayer(db());
        const battle = await db().battles.create({
          format: 'first_blood',
          whiteId: p.id,
          blackId: null,
        });
        const statements = () => [
          db().battles.finishStatement(battle.id, {
            result: 'white',
            reason: 'capture',
            endedAt: 5,
          }),
          ...db().rewards.grantStatements({ key: `battle:${battle.id}`, playerId: p.id, xp: 7 }),
        ];
        expect(await db().atomic(statements())).toEqual([1, 1, 1]);
        await expect(db().atomic(statements())).rejects.toBeInstanceOf(DbConstraintError);
        expect((await db().players.getById(p.id))?.xp).toBe(7);
        expect((await db().battles.get(battle.id))?.result).toBe('white');
      });
    },
  );
});
