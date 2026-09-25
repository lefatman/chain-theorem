/**
 * Overworld progress (M5, spec 10): coins, key items, progress flags (lessons done, once-only
 * trainers), quest progress, positions, presence and the chat-filter preference. Writes that belong
 * to a reward go through `rewardRepo` so they stay idempotent (R-SEC-003).
 */
import type { CompiledQuery } from 'kysely';
import type { RepoContext } from '../db-types.ts';
import { rows } from '../db-types.ts';
import { JsonObject } from '../json.ts';

export interface QuestRow {
  questId: string;
  step: number;
  data: JsonObject;
  updatedAt: number;
}

function checkAmount(n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new RangeError(`amount must be a positive integer: ${n}`);
}

export function worldRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  function addCoinsStatement(playerId: string, n: number): CompiledQuery {
    checkAmount(n);
    return k
      .insertInto('wallets')
      .values({ player_id: playerId, coins: n })
      .onConflict((oc) =>
        oc
          .column('player_id')
          .doUpdateSet((eb) => ({ coins: eb('wallets.coins', '+', eb.ref('excluded.coins')) })),
      )
      .compile();
  }

  function keyItemStatement(playerId: string, keyId: string, at: number): CompiledQuery {
    return k
      .insertInto('key_items')
      .values({ player_id: playerId, key_id: keyId, acquired_at: at })
      .onConflict((oc) => oc.columns(['player_id', 'key_id']).doNothing())
      .compile();
  }

  function flagStatement(playerId: string, flag: string, at: number): CompiledQuery {
    if (flag.length === 0 || flag.length > 120) throw new RangeError('flag must be 1..120 chars');
    return k
      .insertInto('progress_flags')
      .values({ player_id: playerId, flag, at })
      .onConflict((oc) => oc.columns(['player_id', 'flag']).doNothing())
      .compile();
  }

  function questStatement(
    playerId: string,
    questId: string,
    step: number,
    data: JsonObject,
    at: number,
  ): CompiledQuery {
    const json = ctx.json.encode('quest_progress.data_json', JsonObject, data);
    return k
      .insertInto('quest_progress')
      .values({ player_id: playerId, quest_id: questId, step, data_json: json, updated_at: at })
      .onConflict((oc) =>
        oc
          .columns(['player_id', 'quest_id'])
          .doUpdateSet({ step, data_json: json, updated_at: at }),
      )
      .compile();
  }

  return {
    async coins(playerId: string): Promise<number> {
      const r = await k
        .selectFrom('wallets')
        .select('coins')
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return r?.coins ?? 0;
    },
    addCoinsStatement,
    /** Spend coins; false when the balance is too low (conditional update, R-SEC-004). */
    async spendCoins(playerId: string, n: number): Promise<boolean> {
      checkAmount(n);
      const r = await k
        .updateTable('wallets')
        .set((eb) => ({ coins: eb('coins', '-', n) }))
        .where('player_id', '=', playerId)
        .where('coins', '>=', n)
        .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1;
    },

    async keyItems(playerId: string): Promise<string[]> {
      const list = await k
        .selectFrom('key_items')
        .select('key_id')
        .where('player_id', '=', playerId)
        .orderBy('key_id')
        .execute();
      return list.map((r) => r.key_id);
    },
    keyItemStatement,

    async flags(playerId: string): Promise<string[]> {
      const list = await k
        .selectFrom('progress_flags')
        .select('flag')
        .where('player_id', '=', playerId)
        .orderBy('flag')
        .execute();
      return list.map((r) => r.flag);
    },
    flagStatement,
    async setFlag(playerId: string, flag: string, at: number = ctx.now()): Promise<void> {
      await ctx.atomic([flagStatement(playerId, flag, at)]);
    },

    async quests(playerId: string): Promise<QuestRow[]> {
      const list = await k
        .selectFrom('quest_progress')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('quest_id')
        .execute();
      return list.map((q) => ({
        questId: q.quest_id,
        step: q.step,
        data: ctx.json.decode('quest_progress.data_json', JsonObject, q.data_json),
        updatedAt: q.updated_at,
      }));
    },
    questStatement,
    async setQuest(
      playerId: string,
      questId: string,
      step: number,
      data: JsonObject = {},
      at: number = ctx.now(),
    ): Promise<void> {
      await ctx.atomic([questStatement(playerId, questId, step, data, at)]);
    },

    /** Saved position (R-COST-002: on zone change and logout only). */
    async setPosition(playerId: string, zone: string, x: number, y: number): Promise<void> {
      await k
        .updateTable('players')
        .set({ zone_id: zone, tile_x: x, tile_y: y })
        .where('id', '=', playerId)
        .execute();
    },
    /** Online presence for friends: the zone and channel, or null when offline. */
    async setPresence(
      playerId: string,
      zone: string | null,
      channel: number | null,
    ): Promise<void> {
      await k
        .updateTable('players')
        .set({ presence_zone: zone, presence_channel: channel })
        .where('id', '=', playerId)
        .execute();
    },
    async presence(playerId: string): Promise<{ zone: string; channel: number } | null> {
      const r = await k
        .selectFrom('players')
        .select(['presence_zone', 'presence_channel'])
        .where('id', '=', playerId)
        .executeTakeFirst();
      return r?.presence_zone ? { zone: r.presence_zone, channel: r.presence_channel ?? 0 } : null;
    },
    async filterChat(playerId: string): Promise<boolean> {
      const r = await k
        .selectFrom('players')
        .select('filter_chat')
        .where('id', '=', playerId)
        .executeTakeFirst();
      return r?.filter_chat === 1;
    },
    async setFilterChat(playerId: string, on: boolean): Promise<void> {
      await k
        .updateTable('players')
        .set({ filter_chat: on ? 1 : 0 })
        .where('id', '=', playerId)
        .execute();
    },
    /** Sets the level directly (seed data and tests; progression uses players.addXp + levelForXp). */
    async setLevel(playerId: string, level: number): Promise<void> {
      await k.updateTable('players').set({ level }).where('id', '=', playerId).execute();
    },
  };
}

export type WorldRepo = ReturnType<typeof worldRepo>;
