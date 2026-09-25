/**
 * Item wagers (spec 9.5, 13.3). M4 creates and reads the row; escrow and settlement (atomic lists
 * that move both stakes, R-SEC-004) arrive with M6.
 */
import type { Selectable } from 'kysely';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { ItemBundle } from '../json.ts';
import type { WagersTable } from '../schema.ts';

export type WagerStatus = 'pending' | 'escrowed' | 'settled' | 'returned';

export interface Wager {
  id: string;
  battleId: string;
  whiteStake: ItemBundle;
  blackStake: ItemBundle;
  status: string;
  createdAt: number;
  settledAt: number | null;
}

export function toWager(ctx: Pick<RepoContext, 'json'>, row: Selectable<WagersTable>): Wager {
  return {
    id: row.id,
    battleId: row.battle_id,
    whiteStake: ctx.json.decode('wagers.white_stake_json', ItemBundle, row.white_stake_json),
    blackStake: ctx.json.decode('wagers.black_stake_json', ItemBundle, row.black_stake_json),
    status: row.status,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

export function wagerRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  return {
    /** One wager per battle (UNIQUE battle_id). */
    async create(input: {
      battleId: string;
      whiteStake: ItemBundle;
      blackStake: ItemBundle;
      status?: WagerStatus;
      now?: number;
    }): Promise<Wager> {
      const now = input.now ?? ctx.now();
      const id = uuidv7(now);
      await k
        .insertInto('wagers')
        .values({
          id,
          battle_id: input.battleId,
          white_stake_json: ctx.json.encode(
            'wagers.white_stake_json',
            ItemBundle,
            input.whiteStake,
          ),
          black_stake_json: ctx.json.encode(
            'wagers.black_stake_json',
            ItemBundle,
            input.blackStake,
          ),
          status: input.status ?? 'pending',
          created_at: now,
          settled_at: null,
        })
        .execute();
      const row = await k
        .selectFrom('wagers')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return toWager(ctx, row);
    },

    async get(id: string): Promise<Wager | null> {
      const row = await k.selectFrom('wagers').selectAll().where('id', '=', id).executeTakeFirst();
      return row ? toWager(ctx, row) : null;
    },

    async getByBattle(battleId: string): Promise<Wager | null> {
      const row = await k
        .selectFrom('wagers')
        .selectAll()
        .where('battle_id', '=', battleId)
        .executeTakeFirst();
      return row ? toWager(ctx, row) : null;
    },
  };
}

export type WagerRepo = ReturnType<typeof wagerRepo>;
