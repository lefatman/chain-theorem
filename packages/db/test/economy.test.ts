/**
 * Trades and item wagers on every engine (M6 6.1; spec 10.4, 9.5; R-SEC-004, R-FMT-006, R-SEC-010).
 * Each trade, escrow and settlement is one atomic list; race safety comes from constraints and
 * conditional updates inside the write, never SELECT ... FOR UPDATE (DD-15). On PostgreSQL the
 * parallel tests run on a pool of 8 connections, so the lists really race each other; SQLite and D1
 * serialize them, which still checks that every failure changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { uuidv7, type Db, type ItemBundle } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);
const items = (...l: [string, number][]): ItemBundle => ({
  items: l.map(([itemId, qty]) => ({ itemId, qty })),
  cards: [],
});
const cards = (...l: [string, number][]): ItemBundle => ({
  items: [],
  cards: l.map(([abilityId, qty]) => ({ abilityId, qty })),
});

async function auditKinds(db: Db, playerId: string): Promise<string[]> {
  return (await db.audit.listForPlayer(playerId, 1000)).map((a) => a.kind).sort();
}

describe.each(ENGINES)('trades and wagers on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-004 R-WORLD-004 a trade moves both offers in one atomic list and logs both players', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'quick_boots', 2);
        await db().inventory.grant(a.id, 'card', 'scout', 1);
        await db().inventory.grant(b.id, 'card', 'spark', 3);
        const out = await db().trades.execute({
          id: 'trade-1',
          aId: a.id,
          bId: b.id,
          a: {
            items: [{ itemId: 'quick_boots', qty: 1 }],
            cards: [{ abilityId: 'scout', qty: 1 }],
          },
          b: cards(['spark', 2]),
          at: T0,
        });
        expect(out.status).toBe('completed');
        expect(await db().inventory.list(a.id)).toEqual({
          items: [{ itemId: 'quick_boots', qty: 1 }],
          cards: [{ abilityId: 'spark', qty: 2 }],
        });
        expect(await db().inventory.list(b.id)).toEqual({
          items: [{ itemId: 'quick_boots', qty: 1 }],
          cards: [
            { abilityId: 'scout', qty: 1 },
            { abilityId: 'spark', qty: 1 },
          ],
        });
        expect(await db().trades.get('trade-1')).toEqual({
          id: 'trade-1',
          aId: a.id,
          bId: b.id,
          status: 'completed',
          a: {
            items: [{ itemId: 'quick_boots', qty: 1 }],
            cards: [{ abilityId: 'scout', qty: 1 }],
          },
          b: cards(['spark', 2]),
          createdAt: T0,
          completedAt: T0,
        });
        const log = await db().audit.listForPlayer(b.id);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
          kind: 'trade',
          payload: { trade: 'trade-1', with: a.id, gave: cards(['spark', 2]) },
        });
        expect((await db().trades.listForPlayer(a.id)).map((t) => t.id)).toEqual(['trade-1']);
      });

      it('R-SEC-004 a trade whose offer is no longer owned changes nothing and is logged as failed', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'lantern', 1);
        await db().inventory.grant(b.id, 'card', 'spark', 1);
        const before = [await db().inventory.list(a.id), await db().inventory.list(b.id)];
        const out = await db().trades.execute({
          id: 'trade-2',
          aId: a.id,
          bId: b.id,
          a: items(['lantern', 1]),
          b: cards(['spark', 2]),
        });
        expect(out).toEqual({ status: 'insufficient' });
        expect([await db().inventory.list(a.id), await db().inventory.list(b.id)]).toEqual(before);
        expect(await db().trades.get('trade-2')).toBeNull();
        expect(await auditKinds(db(), a.id)).toEqual(['trade_failed']);
        // Something never owned is refused the same way (the zero row keeps the CHECK honest).
        const never = await db().trades.execute({
          id: 'trade-3',
          aId: a.id,
          bId: b.id,
          a: cards(['never_owned', 1]),
          b: { items: [], cards: [] },
        });
        expect(never.status).toBe('insufficient');
        expect([await db().inventory.list(a.id), await db().inventory.list(b.id)]).toEqual(before);
      });

      it('R-SEC-004 one trade id completes once; empty and self trades are refused', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'card', 'scout', 5);
        const input = { id: 'trade-4', aId: a.id, bId: b.id, a: cards(['scout', 1]), b: items() };
        expect((await db().trades.execute(input)).status).toBe('completed');
        expect(await db().trades.execute(input)).toEqual({ status: 'duplicate' });
        expect(await db().inventory.qty(a.id, 'card', 'scout')).toBe(4);
        expect(await db().inventory.qty(b.id, 'card', 'scout')).toBe(1);
        await expect(
          db().trades.execute({ id: 't5', aId: a.id, bId: b.id, a: items(), b: items() }),
        ).rejects.toThrow(RangeError);
        await expect(
          db().trades.execute({
            id: 't6',
            aId: a.id,
            bId: a.id,
            a: cards(['scout', 1]),
            b: items(),
          }),
        ).rejects.toThrow(RangeError);
      });

      it('R-SEC-004 parallel trades on the same inventory rows never duplicate or lose an item', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'gem', 10);
        await db().inventory.grant(b.id, 'card', 'shard', 10);
        // X: A gives 3 gems for 2 shards. Y: the other way round. Both directions race each other.
        const kinds = Array.from({ length: 24 }, (_, i) => (i % 3 === 2 ? 'y' : 'x'));
        const outcomes = await Promise.all(
          kinds.map((kind, i) =>
            db().trades.execute(
              kind === 'x'
                ? {
                    id: `par-${i}`,
                    aId: a.id,
                    bId: b.id,
                    a: items(['gem', 3]),
                    b: cards(['shard', 2]),
                  }
                : {
                    id: `par-${i}`,
                    aId: b.id,
                    bId: a.id,
                    a: items(['gem', 3]),
                    b: cards(['shard', 2]),
                  },
            ),
          ),
        );
        for (const o of outcomes) expect(['completed', 'insufficient']).toContain(o.status);
        const done = (k: string) =>
          outcomes.filter((o, i) => o.status === 'completed' && kinds[i] === k).length;
        const x = done('x');
        const y = done('y');
        expect(x).toBeGreaterThan(0);
        const gemsA = await db().inventory.qty(a.id, 'item', 'gem');
        const gemsB = await db().inventory.qty(b.id, 'item', 'gem');
        const shardsA = await db().inventory.qty(a.id, 'card', 'shard');
        const shardsB = await db().inventory.qty(b.id, 'card', 'shard');
        // Conservation: nothing duplicated, nothing lost ...
        expect(gemsA + gemsB).toBe(10);
        expect(shardsA + shardsB).toBe(10);
        // ... and the balances are exactly what the completed trades moved.
        expect(gemsA).toBe(10 - 3 * x + 3 * y);
        expect(shardsA).toBe(2 * x - 2 * y);
        for (const q of [gemsA, gemsB, shardsA, shardsB]) expect(q).toBeGreaterThanOrEqual(0);
        const log = await db().audit.listForPlayer(a.id, 1000);
        expect(log.filter((e) => e.kind === 'trade')).toHaveLength(x + y);
        expect(await db().trades.listForPlayer(a.id, 200)).toHaveLength(x + y);
      });

      it('R-SEC-004 R-SEC-003 reward grants racing trades on the same rows neither deadlock nor lose an item', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'gem', 6);
        await db().inventory.grant(a.id, 'card', 'shard', 6);
        // Trades move gems and shards A -> B while rewards pay A the same ids in reverse order.
        const jobs = Array.from({ length: 16 }, (_, i) =>
          i % 2 === 0
            ? db().trades.execute({
                id: `mix-${i}`,
                aId: a.id,
                bId: b.id,
                a: { items: [{ itemId: 'gem', qty: 1 }], cards: [{ abilityId: 'shard', qty: 1 }] },
                b: { items: [], cards: [] },
              })
            : db().rewards.grant({
                key: `mix-reward-${i}`,
                playerId: a.id,
                cards: [{ abilityId: 'shard', qty: 1 }],
                items: [{ itemId: 'gem', qty: 1 }],
              }),
        );
        const results = await Promise.all(jobs);
        const trades = results.filter((r, i) => i % 2 === 0 && r.status === 'completed').length;
        const rewards = results.filter((r, i) => i % 2 === 1 && r.status === 'granted').length;
        expect(rewards).toBe(8);
        const gems =
          (await db().inventory.qty(a.id, 'item', 'gem')) +
          (await db().inventory.qty(b.id, 'item', 'gem'));
        const shards =
          (await db().inventory.qty(a.id, 'card', 'shard')) +
          (await db().inventory.qty(b.id, 'card', 'shard'));
        expect(gems).toBe(6 + rewards);
        expect(shards).toBe(6 + rewards);
        expect(await db().inventory.qty(b.id, 'item', 'gem')).toBe(trades);
      });

      async function escrowed(stakeA: ItemBundle, stakeB: ItemBundle) {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'quick_boots', 1);
        await db().inventory.grant(a.id, 'card', 'scout', 2);
        await db().inventory.grant(b.id, 'card', 'spark', 3);
        const battleId = uuidv7();
        const id = uuidv7();
        const r = await db().wagers.escrow({
          id,
          battleId,
          format: 'first_blood',
          aId: a.id,
          bId: b.id,
          aStake: stakeA,
          bStake: stakeB,
          at: T0,
        });
        return { a, b, battleId, id, r };
      }

      it('R-FMT-006 R-SEC-004 at battle start both stakes move into escrow in one atomic list', async () => {
        const { a, b, battleId, id, r } = await escrowed(
          items(['quick_boots', 1]),
          cards(['spark', 2]),
        );
        expect(r.status).toBe('escrowed');
        expect(await db().inventory.qty(a.id, 'item', 'quick_boots')).toBe(0);
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(1);
        expect(await db().wagers.getEscrow(id)).toEqual({
          id,
          battleId,
          format: 'first_blood',
          aId: a.id,
          bId: b.id,
          aStake: items(['quick_boots', 1]),
          bStake: cards(['spark', 2]),
          status: 'escrowed',
          outcome: null,
          createdAt: T0,
          settledAt: null,
        });
        expect((await db().wagers.escrowByBattle(battleId))?.id).toBe(id);
        expect(await auditKinds(db(), a.id)).toEqual(['wager_escrow']);
        // The same wager (or another wager on the same battle) cannot escrow again.
        const again = await db().wagers.escrow({
          id,
          battleId: uuidv7(),
          format: 'first_blood',
          aId: a.id,
          bId: b.id,
          aStake: cards(['scout', 1]),
          bStake: cards(['spark', 1]),
        });
        expect(again).toEqual({ status: 'duplicate' });
        expect(await db().inventory.qty(a.id, 'card', 'scout')).toBe(2);
        // A stake nobody owns any more is refused whole.
        const short = await db().wagers.escrow({
          id: uuidv7(),
          battleId: uuidv7(),
          format: 'full',
          aId: a.id,
          bId: b.id,
          aStake: cards(['scout', 1]),
          bStake: cards(['spark', 2]),
        });
        expect(short).toEqual({ status: 'insufficient' });
        expect(await db().inventory.qty(a.id, 'card', 'scout')).toBe(2);
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(1);
        // Both players must stake something, and never against themselves.
        await expect(
          db().wagers.escrow({
            id: uuidv7(),
            battleId: uuidv7(),
            format: 'full',
            aId: a.id,
            bId: b.id,
            aStake: cards(['scout', 1]),
            bStake: items(),
          }),
        ).rejects.toThrow(RangeError);
        await expect(
          db().wagers.escrow({
            id: uuidv7(),
            battleId: uuidv7(),
            format: 'full',
            aId: a.id,
            bId: a.id,
            aStake: cards(['scout', 1]),
            bStake: cards(['scout', 1]),
          }),
        ).rejects.toThrow(RangeError);
      });

      it('R-FMT-006 the winner receives both stakes in one transaction; a second settlement changes nothing', async () => {
        const { a, b, battleId, id } = await escrowed(
          items(['quick_boots', 1]),
          cards(['spark', 2]),
        );
        await db().battles.create({
          id: battleId,
          format: 'first_blood',
          whiteId: b.id,
          blackId: a.id,
        });
        const r = await db().wagers.settle(id, {
          winnerId: b.id,
          seats: { whiteId: b.id, blackId: a.id },
          at: T0 + 10,
        });
        expect(r.status).toBe('settled');
        if (r.status !== 'settled') return;
        expect(r.paid).toEqual([
          {
            playerId: b.id,
            bundle: {
              items: [{ itemId: 'quick_boots', qty: 1 }],
              cards: [{ abilityId: 'spark', qty: 2 }],
            },
          },
        ]);
        expect(r.escrow).toMatchObject({ status: 'settled', outcome: 'b', settledAt: T0 + 10 });
        expect(await db().inventory.qty(b.id, 'item', 'quick_boots')).toBe(1);
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(3);
        expect(await db().inventory.qty(a.id, 'item', 'quick_boots')).toBe(0);
        const record = await db().wagers.getByBattle(battleId);
        expect(record).toMatchObject({
          id,
          whiteStake: cards(['spark', 2]),
          blackStake: items(['quick_boots', 1]),
          status: 'settled',
          settledAt: T0 + 10,
        });
        const log = await db().audit.listForPlayer(a.id);
        expect(log[0]).toMatchObject({ kind: 'wager_settled', payload: { result: 'lost' } });
        // Retries, replays and a different claimed winner all change nothing.
        expect(await db().wagers.settle(id, { winnerId: b.id })).toEqual({ status: 'duplicate' });
        expect(await db().wagers.settle(id, { winnerId: a.id })).toEqual({ status: 'duplicate' });
        expect(await db().wagers.settle(id, { winnerId: null })).toEqual({ status: 'duplicate' });
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(3);
        expect(await db().inventory.qty(a.id, 'item', 'quick_boots')).toBe(0);
        expect(await db().wagers.settle('nope', { winnerId: null })).toEqual({
          status: 'not_found',
        });
        await expect(db().wagers.settle(uuidv7(), { winnerId: 'stranger' })).resolves.toEqual({
          status: 'not_found',
        });
      });

      it('R-FMT-006 a draw returns each stake; a battle that never started returns them too', async () => {
        const one = await escrowed(cards(['scout', 2]), cards(['spark', 1]));
        await db().battles.create({
          id: one.battleId,
          format: 'first_blood',
          whiteId: one.a.id,
          blackId: one.b.id,
        });
        const draw = await db().wagers.settle(one.id, {
          winnerId: null,
          seats: { whiteId: one.a.id, blackId: one.b.id },
        });
        expect(draw.status).toBe('returned');
        expect(await db().inventory.qty(one.a.id, 'card', 'scout')).toBe(2);
        expect(await db().inventory.qty(one.b.id, 'card', 'spark')).toBe(3);
        expect(await db().inventory.qty(one.a.id, 'card', 'spark')).toBe(0);
        expect((await db().wagers.getByBattle(one.battleId))?.status).toBe('returned');
        expect((await db().wagers.getEscrow(one.id))?.outcome).toBe('draw');

        const two = await escrowed(items(['quick_boots', 1]), cards(['spark', 3]));
        const back = await db().wagers.settle(two.id, { winnerId: null, aborted: true });
        expect(back.status).toBe('returned');
        expect((await db().wagers.getEscrow(two.id))?.outcome).toBe('aborted');
        expect(await db().inventory.qty(two.a.id, 'item', 'quick_boots')).toBe(1);
        expect(await db().inventory.qty(two.b.id, 'card', 'spark')).toBe(3);
        expect(await db().wagers.getByBattle(two.battleId)).toBeNull();
      });

      it('R-SEC-004 R-FMT-006 parallel escrows and parallel settlements move each stake exactly once', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'item', 'glove', 2);
        await db().inventory.grant(b.id, 'card', 'spark', 20);
        const ids = Array.from({ length: 10 }, () => ({ id: uuidv7(), battleId: uuidv7() }));
        const escrows = await Promise.all(
          ids.map((w) =>
            db().wagers.escrow({
              ...w,
              format: 'vanguard',
              aId: a.id,
              bId: b.id,
              aStake: items(['glove', 1]),
              bStake: cards(['spark', 1]),
            }),
          ),
        );
        const live = ids.filter((_, i) => escrows[i]?.status === 'escrowed');
        expect(live).toHaveLength(2);
        expect(escrows.filter((r) => r.status === 'insufficient')).toHaveLength(8);
        expect(await db().inventory.qty(a.id, 'item', 'glove')).toBe(0);
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(18);
        // Eight racing settlements of one wager, claiming different results: one pays.
        const w = live[0];
        if (!w) throw new Error('no escrow');
        const claims = [a.id, b.id, null, a.id, b.id, null, a.id, b.id];
        const settled = await Promise.all(
          claims.map((winnerId) => db().wagers.settle(w.id, { winnerId })),
        );
        expect(settled.filter((s) => s.status !== 'duplicate')).toHaveLength(1);
        const gloves =
          (await db().inventory.qty(a.id, 'item', 'glove')) +
          (await db().inventory.qty(b.id, 'item', 'glove'));
        const sparks =
          (await db().inventory.qty(a.id, 'card', 'spark')) +
          (await db().inventory.qty(b.id, 'card', 'spark'));
        // One glove and one spark are still in the other escrow; nothing else went anywhere.
        expect(gloves).toBe(1);
        expect(sparks).toBe(19);
      });

      it('R-SEC-010 export covers trades and wager escrows; deletion anonymizes the shared records', async () => {
        const a = await makePlayer(db(), `leaver-${uuidv7().slice(-6)}@example.com`);
        const b = await makePlayer(db());
        await db().inventory.grant(a.id, 'card', 'scout', 3);
        await db().inventory.grant(b.id, 'card', 'spark', 3);
        await db().trades.execute({
          id: 'trade-x',
          aId: a.id,
          bId: b.id,
          a: cards(['scout', 1]),
          b: cards(['spark', 1]),
        });
        const battleId = uuidv7();
        const wagerId = uuidv7();
        await db().wagers.escrow({
          id: wagerId,
          battleId,
          format: 'full',
          aId: b.id,
          bId: a.id,
          aStake: cards(['spark', 1]),
          bStake: cards(['scout', 1]),
        });
        const exported = await db().players.exportData(a.id);
        expect(exported?.trades.map((t) => t.id)).toEqual(['trade-x']);
        expect(exported?.trades[0]?.offer).toEqual({
          a: cards(['scout', 1]),
          b: cards(['spark', 1]),
        });
        expect(exported?.wagerEscrows.map((e) => e.id)).toEqual([wagerId]);
        expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);

        expect(await db().players.delete(a.id)).toBe(true);
        expect(await db().trades.get('trade-x')).toMatchObject({ aId: null, bId: b.id });
        expect(await db().wagers.getEscrow(wagerId)).toMatchObject({ aId: b.id, bId: null });
        // The escrow still settles; here the remaining player won both stakes.
        const r = await db().wagers.settle(wagerId, { winnerId: b.id });
        expect(r.status).toBe('settled');
        expect(await db().inventory.qty(b.id, 'card', 'spark')).toBe(2);
        expect(await db().inventory.qty(b.id, 'card', 'scout')).toBe(2);
      });
    },
  );
});
