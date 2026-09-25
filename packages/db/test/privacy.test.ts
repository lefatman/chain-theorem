/** Minimum personal data, age data, export and deletion on every engine (R-SEC-010, R-SEC-011). */
import { describe, expect, it } from 'vitest';
import { adultFromBirthDate, type Db } from '../src/index.ts';
import { columnNames, ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);

/** Every row that references the player, table by table. */
async function rowsFor(db: Db, id: string, email: string): Promise<Record<string, number>> {
  const k = db.kysely;
  const count = async (q: Promise<unknown[]>) => (await q).length;
  return {
    players: await count(k.selectFrom('players').select('id').where('id', '=', id).execute()),
    sessions: await count(
      k.selectFrom('sessions').select('id').where('player_id', '=', id).execute(),
    ),
    login_tokens: await count(
      k.selectFrom('login_tokens').select('id').where('email', '=', email).execute(),
    ),
    oauth_accounts: await count(
      k.selectFrom('oauth_accounts').select('id').where('player_id', '=', id).execute(),
    ),
    inventory_items: await count(
      k.selectFrom('inventory_items').select('qty').where('player_id', '=', id).execute(),
    ),
    inventory_cards: await count(
      k.selectFrom('inventory_cards').select('qty').where('player_id', '=', id).execute(),
    ),
    loadouts: await count(
      k.selectFrom('loadouts').select('id').where('player_id', '=', id).execute(),
    ),
    ratings: await count(
      k.selectFrom('ratings').select('games').where('player_id', '=', id).execute(),
    ),
    battles: await count(
      k
        .selectFrom('battles')
        .select('id')
        .where((eb) => eb.or([eb('white_id', '=', id), eb('black_id', '=', id)]))
        .execute(),
    ),
    guilds: await count(k.selectFrom('guilds').select('id').where('owner_id', '=', id).execute()),
    guild_members: await count(
      k.selectFrom('guild_members').select('rank').where('player_id', '=', id).execute(),
    ),
    trades: await count(
      k
        .selectFrom('trades')
        .select('id')
        .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
        .execute(),
    ),
    friends: await count(
      k
        .selectFrom('friends')
        .select('status')
        .where((eb) => eb.or([eb('a_id', '=', id), eb('b_id', '=', id)]))
        .execute(),
    ),
    quest_progress: await count(
      k.selectFrom('quest_progress').select('step').where('player_id', '=', id).execute(),
    ),
    audit_log: await count(
      k.selectFrom('audit_log').select('id').where('player_id', '=', id).execute(),
    ),
    reward_grants: await count(
      k.selectFrom('reward_grants').select('id').where('player_id', '=', id).execute(),
    ),
  };
}

describe.each(ENGINES)('privacy on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-011 stores adult_from, never the birth date', async () => {
        const adultFrom = adultFromBirthDate('2012-03-14');
        const p = await db().players.create({
          email: 'kid@example.com',
          displayName: 'Kid',
          adultFrom,
          now: T0,
        });
        expect(p.adultFrom).toBe(Date.UTC(2030, 2, 14));
        const columns = await columnNames(db(), 'players');
        expect(columns).toContain('adult_from');
        expect(columns.filter((c) => /birth|dob/i.test(c))).toEqual([]);
        const raw = await db()
          .kysely.selectFrom('players')
          .selectAll()
          .where('id', '=', p.id)
          .executeTakeFirstOrThrow();
        const stored = JSON.stringify(raw);
        expect(stored).not.toContain('2012-03-14');
        expect(stored).not.toContain(String(Date.UTC(2012, 2, 14)));
        expect(raw.adult_from).toBe(Date.UTC(2030, 2, 14));
      });

      it('R-SEC-010 only email and display name are stored as personal data', async () => {
        const columns = await columnNames(db(), 'players');
        const personal = columns.filter((c) => /name|mail|phone|address|birth|dob|ip/i.test(c));
        expect(personal.sort()).toEqual(['display_name', 'email']);
      });

      it('R-SEC-010 export returns and delete removes the player rows', async () => {
        const d = db();
        const p = await makePlayer(d, 'leaver@example.com', 'Leaver');
        const friend = await makePlayer(d, 'stays@example.com', 'Stays');
        await d.sessions.create(p.id, { ttlMs: 1000, now: T0 });
        await d.loginTokens.issue({ email: p.email, purpose: 'signin', ttlMs: 1000, now: T0 });
        await d.oauthAccounts.link(p.id, 'discord', 'd-1', T0);
        await d.inventory.grant(p.id, 'item', 'quick_boots', 1);
        await d.inventory.grant(p.id, 'card', 'spark', 2);
        await d.loadouts.save(p.id, {
          name: 'Main',
          loadout: { elements: ['stone'], items: [], sets: [['stalwart']] },
          isValid: true,
          now: T0,
        });
        await d.ratings.upsert({
          playerId: p.id,
          format: 'full',
          bracket: 'b1',
          rating: 1500,
          rd: 350,
          volatility: 0.06,
          games: 0,
        });
        const pvp = await d.battles.create({
          format: 'full',
          whiteId: p.id,
          blackId: friend.id,
          startedAt: T0,
        });
        await d.battles.create({
          format: 'first_blood',
          whiteId: null,
          blackId: p.id,
          startedAt: T0 + 1,
        });
        await d.wagers.create({
          battleId: pvp.id,
          whiteStake: { items: [], cards: [] },
          blackStake: { items: [], cards: [] },
        });
        await d.rewards.grant({ key: `battle:${pvp.id}`, playerId: p.id, xp: 12 });
        await d.audit.append({ playerId: p.id, kind: 'login' });
        const k = d.kysely;
        const json = (v: unknown) => JSON.stringify(v);
        await k
          .insertInto('guilds')
          .values({ id: 'g1', name: 'Rooks', tag: 'RK', owner_id: p.id, created_at: T0 })
          .execute();
        await k
          .insertInto('guild_members')
          .values({ guild_id: 'g1', player_id: p.id, rank: 'owner', joined_at: T0 })
          .execute();
        await k
          .insertInto('guild_members')
          .values({ guild_id: 'g1', player_id: friend.id, rank: 'member', joined_at: T0 })
          .execute();
        await k
          .insertInto('trades')
          .values({
            id: 't1',
            a_id: friend.id,
            b_id: p.id,
            status: 'completed',
            offer_json: json({ a: [], b: [] }),
            created_at: T0,
            completed_at: T0,
          })
          .execute();
        await k
          .insertInto('friends')
          .values({ a_id: p.id, b_id: friend.id, status: 'accepted', created_at: T0 })
          .execute();
        await k
          .insertInto('quest_progress')
          .values({
            player_id: p.id,
            quest_id: 'academy',
            step: 2,
            data_json: json({ talked: true }),
            updated_at: T0,
          })
          .execute();

        const exported = await d.players.exportData(p.id, T0 + 5);
        expect(exported).not.toBeNull();
        expect(exported!.exportedAt).toBe(T0 + 5);
        expect(exported!.player).toEqual(await d.players.getById(p.id));
        expect(exported!.sessions).toHaveLength(1);
        expect(JSON.stringify(exported)).not.toMatch(/token_hash|[0-9a-f]{64}/);
        expect(exported!.oauthAccounts).toEqual([
          { provider: 'discord', providerUserId: 'd-1', createdAt: T0 },
        ]);
        expect(exported!.inventory).toEqual({
          items: [{ itemId: 'quick_boots', qty: 1 }],
          cards: [{ abilityId: 'spark', qty: 2 }],
        });
        expect(exported!.loadouts.map((l) => l.name)).toEqual(['Main']);
        expect(exported!.ratings).toHaveLength(1);
        expect(exported!.battles).toHaveLength(2);
        expect(exported!.wagers).toHaveLength(1);
        expect(exported!.guildMemberships).toEqual([
          { guildId: 'g1', rank: 'owner', joinedAt: T0 },
        ]);
        expect(exported!.guildsOwned.map((g) => g.id)).toEqual(['g1']);
        expect(exported!.trades.map((t) => t.offer)).toEqual([{ a: [], b: [] }]);
        expect(exported!.friends).toHaveLength(1);
        expect(exported!.quests).toEqual([
          { questId: 'academy', step: 2, data: { talked: true }, updatedAt: T0 },
        ]);
        expect(exported!.rewardGrants.map((g) => g.payload.xp)).toEqual([12]);
        expect(exported!.auditLog.map((a) => a.kind)).toEqual(['login']);
        expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);

        const before = await rowsFor(d, p.id, p.email);
        expect(Object.values(before).every((n) => n > 0)).toBe(true);

        expect(await d.players.delete(p.id)).toBe(true);
        const after = await rowsFor(d, p.id, p.email);
        expect(Object.values(after).every((n) => n === 0)).toBe(true);
        expect(await d.players.exportData(p.id)).toBeNull();
        expect(await d.players.delete(p.id)).toBe(false);

        // The other player's history survives with the deleted side anonymized.
        expect(await d.players.getById(friend.id)).not.toBeNull();
        expect(await d.battles.get(pvp.id)).toMatchObject({ whiteId: null, blackId: friend.id });
        expect(await d.wagers.getByBattle(pvp.id)).not.toBeNull();
        const trade = await k
          .selectFrom('trades')
          .selectAll()
          .where('id', '=', 't1')
          .executeTakeFirstOrThrow();
        expect([trade.a_id, trade.b_id]).toEqual([friend.id, null]);
        const guild = await k
          .selectFrom('guilds')
          .selectAll()
          .where('id', '=', 'g1')
          .executeTakeFirstOrThrow();
        expect(guild.owner_id).toBeNull();
        const members = await k.selectFrom('guild_members').select('player_id').execute();
        expect(members.map((m) => m.player_id)).toEqual([friend.id]);
      });
    },
  );
});
