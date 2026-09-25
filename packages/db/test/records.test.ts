/** Loadouts, battles, wagers, ratings and the audit log on every engine (R-DATA-003, R-DATA-004). */
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { DbDataError, type LoadoutJson } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const LOADOUT: LoadoutJson = {
  elements: ['ember', 'tide'],
  items: ['quick_boots', 'ember_charm'],
  itemParams: { ember_charm: { element: 'ember' } },
  sets: [['spark', 'flow'], [], ['riposte'], [], [], ['stalwart']],
};

describe.each(ENGINES)('records on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      describe('loadouts', () => {
        it('R-DATA-004 JSON columns round-trip and are validated with Zod', async () => {
          const p = await makePlayer(db());
          const saved = await db().loadouts.save(p.id, {
            name: 'Tide rush',
            loadout: LOADOUT,
            isValid: true,
            now: 100,
          });
          expect(saved).toMatchObject({
            playerId: p.id,
            name: 'Tide rush',
            loadout: LOADOUT,
            isValid: true,
            createdAt: 100,
            updatedAt: 100,
          });
          expect(await db().loadouts.get(p.id, saved!.id)).toEqual(saved);

          // Invalid shapes are refused before anything is written.
          const bad = { ...LOADOUT, elements: [] } as LoadoutJson;
          await expect(
            db().loadouts.save(p.id, { name: 'Bad', loadout: bad, isValid: false }),
          ).rejects.toBeInstanceOf(DbDataError);
          expect(await db().loadouts.count(p.id)).toBe(1);

          // A row corrupted outside the repository surfaces as DbDataError on read.
          await sql`update loadouts set loadout_json = ${JSON.stringify({ elements: 'ember' })} where id = ${saved!.id}`.execute(
            db().kysely,
          );
          const err = await db()
            .loadouts.get(p.id, saved!.id)
            .catch((e: unknown) => e);
          expect(err).toBeInstanceOf(DbDataError);
          expect((err as DbDataError).column).toBe('loadouts.loadout_json');
        });

        it('R-DATA-003 save, overwrite, list, mark invalid and delete, scoped to the owner', async () => {
          const p = await makePlayer(db());
          const other = await makePlayer(db());
          const a = await db().loadouts.save(p.id, {
            name: 'A',
            loadout: LOADOUT,
            isValid: true,
            now: 1,
          });
          const b = await db().loadouts.save(p.id, {
            name: 'B',
            loadout: { ...LOADOUT, items: [] },
            isValid: false,
            now: 2,
          });
          expect((await db().loadouts.list(p.id)).map((l) => l.name)).toEqual(['A', 'B']);

          const updated = await db().loadouts.save(p.id, {
            id: a!.id,
            name: 'A2',
            loadout: LOADOUT,
            isValid: false,
            now: 3,
          });
          expect(updated).toMatchObject({
            id: a!.id,
            name: 'A2',
            isValid: false,
            createdAt: 1,
            updatedAt: 3,
          });

          // Another player can neither read nor overwrite nor delete it.
          expect(await db().loadouts.get(other.id, a!.id)).toBeNull();
          expect(
            await db().loadouts.save(other.id, {
              id: a!.id,
              name: 'X',
              loadout: LOADOUT,
              isValid: true,
            }),
          ).toBeNull();
          expect(await db().loadouts.delete(other.id, a!.id)).toBe(false);

          expect(await db().loadouts.setValid(p.id, b!.id, true, 4)).toBe(true);
          expect((await db().loadouts.get(p.id, b!.id))?.isValid).toBe(true);
          expect(await db().loadouts.delete(p.id, a!.id)).toBe(true);
          expect((await db().loadouts.list(p.id)).map((l) => l.id)).toEqual([b!.id]);
        });
      });

      describe('battles', () => {
        it('R-DATA-003 a battle row is created at start and finished exactly once', async () => {
          const w = await makePlayer(db());
          const b = await makePlayer(db());
          const battle = await db().battles.create({
            format: 'vanguard',
            whiteId: w.id,
            blackId: b.id,
            startedAt: 1000,
          });
          expect(battle).toMatchObject({
            result: null,
            reason: null,
            endedAt: null,
            logKey: null,
            startedAt: 1000,
          });
          expect(await db().battles.get(battle.id)).toEqual(battle);

          const end = {
            result: 'black' as const,
            reason: 'checkmate',
            endedAt: 9000,
            logKey: `logs/${battle.id}.json`,
          };
          expect(await db().battles.finish(battle.id, end)).toBe(true);
          expect(await db().battles.finish(battle.id, { ...end, result: 'white' })).toBe(false);
          expect(await db().battles.get(battle.id)).toEqual({ ...battle, ...end });
          expect(await db().battles.finish('missing', end)).toBe(false);
        });

        it('R-DATA-003 lists a player recent battles newest first, NPC sides as null', async () => {
          const p = await makePlayer(db());
          const q = await makePlayer(db());
          const b1 = await db().battles.create({
            format: 'first_blood',
            whiteId: p.id,
            blackId: null,
            startedAt: 1,
          });
          const b2 = await db().battles.create({
            format: 'full',
            whiteId: q.id,
            blackId: p.id,
            startedAt: 2,
          });
          await db().battles.create({ format: 'full', whiteId: q.id, blackId: null, startedAt: 3 });
          const b4 = await db().battles.create({
            format: 'vanguard',
            whiteId: null,
            blackId: p.id,
            startedAt: 4,
          });
          expect((await db().battles.listRecentForPlayer(p.id)).map((b) => b.id)).toEqual([
            b4.id,
            b2.id,
            b1.id,
          ]);
          expect((await db().battles.listRecentForPlayer(p.id, 2)).map((b) => b.id)).toEqual([
            b4.id,
            b2.id,
          ]);
        });
        it('R-DATA-003 a caller-supplied battle id need not be a UUID', async () => {
          const w = await makePlayer(db());
          const battle = await db().battles.create({
            id: 'c-Xk29Qa',
            format: 'first_blood',
            whiteId: w.id,
            blackId: null,
            startedAt: 7,
          });
          expect(battle.id).toBe('c-Xk29Qa');
          expect(await db().battles.get('c-Xk29Qa')).toEqual(battle);
          await expect(
            db().battles.create({ id: 'c-Xk29Qa', format: 'full', whiteId: null, blackId: w.id }),
          ).rejects.toThrow();
          await expect(
            db().battles.create({ id: '', format: 'full', whiteId: null, blackId: w.id }),
          ).rejects.toThrow(RangeError);
          expect(await db().battles.get('c-missing')).toBeNull();
        });

        it('R-DATA-003 lists a player active battles (no result yet), newest first', async () => {
          const p = await makePlayer(db());
          const q = await makePlayer(db());
          const a1 = await db().battles.create({
            id: 'c-a1',
            format: 'full',
            whiteId: p.id,
            blackId: q.id,
            startedAt: 1,
          });
          const done = await db().battles.create({
            format: 'full',
            whiteId: q.id,
            blackId: p.id,
            startedAt: 2,
          });
          const a3 = await db().battles.create({
            format: 'vanguard',
            whiteId: null,
            blackId: p.id,
            startedAt: 3,
          });
          await db().battles.create({ format: 'full', whiteId: q.id, blackId: null, startedAt: 4 });
          await db().battles.finish(done.id, { result: 'draw', reason: 'agreement', endedAt: 5 });
          expect((await db().battles.listActiveForPlayer(p.id)).map((b) => b.id)).toEqual([
            a3.id,
            a1.id,
          ]);
          expect((await db().battles.listActiveForPlayer(q.id)).map((b) => b.startedAt)).toEqual([
            4, 1,
          ]);
          await db().battles.finish(a3.id, { result: 'aborted', reason: 'disconnect', endedAt: 6 });
          expect((await db().battles.listActiveForPlayer(p.id)).map((b) => b.id)).toEqual([a1.id]);
        });
      });

      describe('wagers', () => {
        it('R-DATA-004 wager stakes round-trip through JSON with validation', async () => {
          const w = await makePlayer(db());
          const b = await makePlayer(db());
          const battle = await db().battles.create({
            format: 'first_blood',
            whiteId: w.id,
            blackId: b.id,
          });
          const wager = await db().wagers.create({
            battleId: battle.id,
            whiteStake: { items: [{ itemId: 'ember_charm', qty: 1 }], cards: [] },
            blackStake: { items: [], cards: [{ abilityId: 'spark', qty: 2 }] },
            status: 'escrowed',
            now: 50,
          });
          expect(wager).toMatchObject({
            battleId: battle.id,
            status: 'escrowed',
            createdAt: 50,
            settledAt: null,
          });
          expect(await db().wagers.get(wager.id)).toEqual(wager);
          expect(await db().wagers.getByBattle(battle.id)).toEqual(wager);
          await expect(
            db().wagers.create({
              battleId: battle.id,
              whiteStake: { items: [{ itemId: 'x', qty: 0 }], cards: [] },
              blackStake: { items: [], cards: [] },
            }),
          ).rejects.toBeInstanceOf(DbDataError);
        });
      });

      describe('ratings', () => {
        it('R-DATA-003 ratings upsert per format and bracket', async () => {
          const p = await makePlayer(db());
          expect(await db().ratings.get(p.id, 'full', 'b1')).toBeNull();
          const r = {
            playerId: p.id,
            format: 'full',
            bracket: 'b1',
            rating: 1500,
            rd: 350,
            volatility: 0.06,
            games: 0,
            updatedAt: 1,
          };
          expect(await db().ratings.upsert(r)).toEqual(r);
          await db().ratings.upsert({ ...r, rating: 1512.25, rd: 290.5, games: 1, updatedAt: 2 });
          await db().ratings.upsert({ ...r, format: 'vanguard' });
          expect(await db().ratings.get(p.id, 'full', 'b1')).toEqual({
            ...r,
            rating: 1512.25,
            rd: 290.5,
            games: 1,
            updatedAt: 2,
          });
          expect((await db().ratings.listForPlayer(p.id)).map((x) => x.format)).toEqual([
            'full',
            'vanguard',
          ]);
        });
      });

      describe('audit log', () => {
        it('R-DATA-003 audit entries append with JSON payloads, newest first', async () => {
          const p = await makePlayer(db());
          await db().audit.append({
            playerId: p.id,
            kind: 'login',
            payload: { ip: 'hash:ab12' },
            at: 1,
          });
          await db().audit.append({
            playerId: p.id,
            kind: 'trade',
            payload: { items: [1, 2], ok: true, note: null },
            at: 2,
          });
          await db().audit.append({ playerId: null, kind: 'system', at: 3 });
          const list = await db().audit.listForPlayer(p.id);
          expect(list.map((e) => [e.kind, e.payload, e.at])).toEqual([
            ['trade', { items: [1, 2], ok: true, note: null }, 2],
            ['login', { ip: 'hash:ab12' }, 1],
          ]);
        });
      });
    },
  );
});
