/** Forward-only migrations on every engine (spec 13.3, 13.6; R-DATA-003, R-DATA-004). */
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { appliedMigrations, migrate, MIGRATIONS, TABLES, type Db } from '../src/index.ts';
import { ENGINES, schemaTables, useDb } from './engines.ts';

async function tableNames(db: Db): Promise<string[]> {
  return (await schemaTables(db)).map((t) => t.name).sort();
}

async function columnType(db: Db, table: string, column: string): Promise<string> {
  const tables = await schemaTables(db);
  const col = tables.find((t) => t.name === table)?.columns.find((c) => c.name === column);
  if (!col) throw new Error(`no column ${table}.${column}`);
  return col.dataType.toLowerCase();
}

describe.each(ENGINES)('migrations on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine, { migrate: false });

      it('R-DATA-004 migrations run twice idempotently', async () => {
        const first = await migrate(db());
        expect(first).toEqual(MIGRATIONS.map((m) => m.id));
        const second = await migrate(db());
        expect(second).toEqual([]);
        expect(await appliedMigrations(db())).toEqual(MIGRATIONS.map((m) => m.id));
        expect(await tableNames(db())).toEqual([...TABLES, 'schema_migrations'].sort());
      });

      it('R-DATA-004 concurrent migrate() calls apply each migration once', async () => {
        const results = await Promise.all([migrate(db()), migrate(db()), migrate(db())]);
        expect(results.flat().sort()).toEqual(MIGRATIONS.map((m) => m.id));
        expect(await appliedMigrations(db())).toEqual(MIGRATIONS.map((m) => m.id));
      });

      it('R-DATA-003 every table in spec 13.3 exists with its key columns', async () => {
        await migrate(db());
        const tables = await schemaTables(db());
        const cols = (name: string) =>
          tables.find((t) => t.name === name)?.columns.map((c) => c.name) ?? [];
        const spec: Record<string, string[]> = {
          players: [
            'id',
            'email',
            'display_name',
            'level',
            'xp',
            'zone_id',
            'tile_x',
            'tile_y',
            'sub_status',
            'sub_expires_at',
            'trial_ends_at',
            'adult_from',
          ],
          sessions: ['id', 'player_id', 'expires_at'],
          inventory_items: ['player_id', 'item_id', 'qty'],
          inventory_cards: ['player_id', 'ability_id', 'qty'],
          loadouts: ['id', 'player_id', 'name', 'loadout_json', 'is_valid', 'updated_at'],
          ratings: ['player_id', 'format', 'bracket', 'rating', 'rd', 'volatility', 'games'],
          battles: [
            'id',
            'format',
            'white_id',
            'black_id',
            'result',
            'reason',
            'started_at',
            'ended_at',
            'log_key',
          ],
          wagers: [
            'id',
            'battle_id',
            'white_stake_json',
            'black_stake_json',
            'status',
            'settled_at',
          ],
          guilds: ['id', 'name', 'tag', 'owner_id'],
          guild_members: ['guild_id', 'player_id', 'rank'],
          trades: ['id', 'a_id', 'b_id', 'status', 'offer_json', 'completed_at'],
          friends: ['a_id', 'b_id', 'status'],
          quest_progress: ['player_id', 'quest_id', 'step', 'data_json'],
          audit_log: ['id', 'player_id', 'kind', 'payload_json', 'at'],
          login_tokens: ['token_hash', 'email', 'expires_at', 'used_at', 'purpose'],
          oauth_accounts: ['provider', 'provider_user_id', 'player_id'],
          reward_grants: ['grant_key', 'player_id', 'payload_json', 'at'],
        };
        for (const [table, columns] of Object.entries(spec)) {
          expect(cols(table), table).toEqual(expect.arrayContaining(columns));
        }
      });

      it('R-DATA-004 column types follow the portability rules for this engine', async () => {
        await migrate(db());
        const pgEngine = engine.name === 'postgres';
        expect(await columnType(db(), 'players', 'created_at')).toBe(pgEngine ? 'int8' : 'integer');
        expect(await columnType(db(), 'players', 'adult_from')).toBe(pgEngine ? 'int8' : 'integer');
        expect(await columnType(db(), 'loadouts', 'loadout_json')).toBe(
          pgEngine ? 'jsonb' : 'text',
        );
        expect(await columnType(db(), 'ratings', 'rating')).toBe(pgEngine ? 'float8' : 'real');
        expect(await columnType(db(), 'players', 'id')).toBe('text');
      });

      it('R-SEC-004 inventory quantities carry CHECK (qty >= 0)', async () => {
        await migrate(db());
        const k = db().kysely;
        await k
          .insertInto('players')
          .values({
            id: 'p1',
            email: 'a@example.com',
            display_name: 'A',
            adult_from: 0,
            created_at: 0,
          })
          .execute();
        await expect(
          k
            .insertInto('inventory_items')
            .values({ player_id: 'p1', item_id: 'x', qty: -1 })
            .execute(),
        ).rejects.toThrow();
        await expect(
          k
            .insertInto('inventory_cards')
            .values({ player_id: 'p1', ability_id: 'x', qty: -1 })
            .execute(),
        ).rejects.toThrow();
        const n = await sql<{ n: number }>`select count(*) as n from inventory_items`.execute(k);
        expect(Number(n.rows[0]?.n)).toBe(0);
      });
    },
  );
});
