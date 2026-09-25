/**
 * Idempotent reward grants (R-SEC-003, R-SEC-004, DD-15). One grant is one atomic list: the
 * `reward_grants` row (UNIQUE (grant_key, player_id)) first, then the inventory upserts and the XP
 * increment. A second grant with the same key violates the unique key, rolls the whole list back and
 * reports `duplicate`, so retries and replays can never pay out twice.
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { isUniqueViolation } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { RewardPayload } from '../json.ts';
import type { RewardGrantsTable } from '../schema.ts';
import { inventoryRepo } from './inventory.ts';

export interface RewardGrant {
  id: string;
  key: string;
  playerId: string;
  payload: RewardPayload;
  at: number;
}

export interface RewardGrantInput {
  /** Idempotency key: `battle:<battleId>`, `quest:<questId>:<step>`, ... */
  key: string;
  playerId: string;
  items?: { itemId: string; qty: number }[];
  cards?: { abilityId: string; qty: number }[];
  xp?: number;
  at?: number;
}

export type RewardGrantOutcome =
  { status: 'granted'; grant: RewardGrant } | { status: 'duplicate' };

export function toRewardGrant(
  ctx: Pick<RepoContext, 'json'>,
  row: Selectable<RewardGrantsTable>,
): RewardGrant {
  return {
    id: row.id,
    key: row.grant_key,
    playerId: row.player_id,
    payload: ctx.json.decode('reward_grants.payload_json', RewardPayload, row.payload_json),
    at: row.at,
  };
}

export function rewardRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  const inventory = inventoryRepo(ctx);

  function build(input: RewardGrantInput): { grant: RewardGrant; statements: CompiledQuery[] } {
    if (input.key.length === 0 || input.key.length > 200)
      throw new RangeError('reward key must be 1..200 chars');
    const at = input.at ?? ctx.now();
    const payload = RewardPayload.parse({ items: input.items, cards: input.cards, xp: input.xp });
    const grant: RewardGrant = {
      id: uuidv7(at),
      key: input.key,
      playerId: input.playerId,
      payload,
      at,
    };
    const statements: CompiledQuery[] = [
      k
        .insertInto('reward_grants')
        .values({
          id: grant.id,
          grant_key: grant.key,
          player_id: grant.playerId,
          payload_json: ctx.json.encode('reward_grants.payload_json', RewardPayload, payload),
          at,
        })
        .compile(),
      ...payload.items.map((i) =>
        inventory.grantStatement(input.playerId, 'item', i.itemId, i.qty),
      ),
      ...payload.cards.map((c) =>
        inventory.grantStatement(input.playerId, 'card', c.abilityId, c.qty),
      ),
    ];
    if (payload.xp > 0) {
      statements.push(
        k
          .updateTable('players')
          .set((eb) => ({ xp: eb('xp', '+', payload.xp) }))
          .where('id', '=', input.playerId)
          .compile(),
      );
    }
    return { grant, statements };
  }

  return {
    /** Grants once per (key, player); a repeat changes nothing and reports `duplicate`. */
    async grant(input: RewardGrantInput): Promise<RewardGrantOutcome> {
      const { grant, statements } = build(input);
      try {
        await ctx.atomic(statements);
        return { status: 'granted', grant };
      } catch (err) {
        if (isUniqueViolation(err, 'reward_grants')) return { status: 'duplicate' };
        throw err;
      }
    },

    /**
     * The statements of one grant, for composing a larger atomic list (for example finishing a
     * battle and paying both players). The grant row comes first; a duplicate key aborts the list.
     */
    grantStatements(input: RewardGrantInput): CompiledQuery[] {
      return build(input).statements;
    },

    async get(key: string, playerId: string): Promise<RewardGrant | null> {
      const row = await k
        .selectFrom('reward_grants')
        .selectAll()
        .where('grant_key', '=', key)
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return row ? toRewardGrant(ctx, row) : null;
    },
  };
}

export type RewardRepo = ReturnType<typeof rewardRepo>;
