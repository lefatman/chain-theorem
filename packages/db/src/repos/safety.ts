/**
 * Mutes and blocks (M6 6.4; spec 15 R-SEC-011: "Report, mute and block stay available to everyone").
 * Both are private, one row per (player, target):
 * - a mute hides the target's chat lines from the player on every channel;
 * - a block does that too, and in both directions refuses whispers, consent challenges and party,
 *   trade, wager and guild invitations. Blocking removes the pair's friendship and any pending
 *   friend request in the same atomic list (DD-15).
 * The caps (config `SAFETY`) are checked before the insert: best effort under a burst of parallel
 * requests from one player, which can only overshoot by the requests in flight.
 */
import { rows, type RepoContext } from '../db-types.ts';

export interface SafetyRow {
  /** The muted or blocked player. */
  id: string;
  name: string;
  at: number;
}

export type AddResult = 'added' | 'exists' | 'limit' | 'no_player';

export function safetyRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function list(table: 'mutes' | 'blocks', playerId: string): Promise<SafetyRow[]> {
    const r = await k
      .selectFrom(table)
      .select(['target_id', 'created_at'])
      .where('player_id', '=', playerId)
      .orderBy('created_at')
      .orderBy('target_id')
      .execute();
    if (r.length === 0) return [];
    const names = await k
      .selectFrom('players')
      .select(['id', 'display_name'])
      .where(
        'id',
        'in',
        r.map((x) => x.target_id),
      )
      .execute();
    const byId = new Map(names.map((n) => [n.id, n.display_name]));
    return r.map((x) => ({
      id: x.target_id,
      name: byId.get(x.target_id) ?? '?',
      at: x.created_at,
    }));
  }

  async function ids(table: 'mutes' | 'blocks', playerId: string): Promise<string[]> {
    const r = await k
      .selectFrom(table)
      .select('target_id')
      .where('player_id', '=', playerId)
      .orderBy('target_id')
      .execute();
    return r.map((x) => x.target_id);
  }

  async function count(table: 'mutes' | 'blocks', playerId: string): Promise<number> {
    const r = await k
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  async function exists(table: 'mutes' | 'blocks', playerId: string, targetId: string) {
    const r = await k
      .selectFrom(table)
      .select('target_id')
      .where('player_id', '=', playerId)
      .where('target_id', '=', targetId)
      .executeTakeFirst();
    return r !== undefined;
  }

  async function precheck(
    table: 'mutes' | 'blocks',
    playerId: string,
    targetId: string,
    max: number,
  ): Promise<AddResult | null> {
    if (playerId === targetId) throw new RangeError('a player cannot mute or block themselves');
    const target = await k
      .selectFrom('players')
      .select('id')
      .where('id', '=', targetId)
      .executeTakeFirst();
    if (!target) return 'no_player';
    if (await exists(table, playerId, targetId)) return 'exists';
    if ((await count(table, playerId)) >= max) return 'limit';
    return null;
  }

  return {
    /** Muted players, oldest first, with their current display names. */
    mutes: (playerId: string) => list('mutes', playerId),
    /** Blocked players (by this player), oldest first. */
    blocks: (playerId: string) => list('blocks', playerId),
    /** Ids this player muted (PlayerInit, R-SEC-011). */
    mutedIds: (playerId: string) => ids('mutes', playerId),
    /** Ids this player blocked (PlayerInit). */
    blockedIds: (playerId: string) => ids('blocks', playerId),

    /** Mute `targetId` for `playerId` (at most `max` mutes). */
    async mute(
      playerId: string,
      targetId: string,
      max: number,
      now: number = ctx.now(),
    ): Promise<AddResult> {
      const pre = await precheck('mutes', playerId, targetId, max);
      if (pre) return pre;
      const r = await k
        .insertInto('mutes')
        .values({ player_id: playerId, target_id: targetId, created_at: now })
        .onConflict((oc) => oc.columns(['player_id', 'target_id']).doNothing())
        .executeTakeFirst();
      return rows(r.numInsertedOrUpdatedRows) === 1 ? 'added' : 'exists';
    },

    async unmute(playerId: string, targetId: string): Promise<boolean> {
      const r = await k
        .deleteFrom('mutes')
        .where('player_id', '=', playerId)
        .where('target_id', '=', targetId)
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },

    /**
     * Block `targetId` for `playerId` (at most `max` blocks). One atomic list: the block row, and
     * the pair's friendship or pending friend request in either direction goes.
     */
    async block(
      playerId: string,
      targetId: string,
      max: number,
      now: number = ctx.now(),
    ): Promise<AddResult> {
      const pre = await precheck('blocks', playerId, targetId, max);
      if (pre) return pre;
      const [inserted] = await ctx.atomic([
        k
          .insertInto('blocks')
          .values({ player_id: playerId, target_id: targetId, created_at: now })
          .onConflict((oc) => oc.columns(['player_id', 'target_id']).doNothing())
          .compile(),
        k
          .deleteFrom('friends')
          .where((eb) =>
            eb.or([
              eb.and([eb('a_id', '=', playerId), eb('b_id', '=', targetId)]),
              eb.and([eb('a_id', '=', targetId), eb('b_id', '=', playerId)]),
            ]),
          )
          .compile(),
      ]);
      return inserted === 1 ? 'added' : 'exists';
    },

    async unblock(playerId: string, targetId: string): Promise<boolean> {
      const r = await k
        .deleteFrom('blocks')
        .where('player_id', '=', playerId)
        .where('target_id', '=', targetId)
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },

    /** True when either player blocked the other (R-WORLD-004 refusals, R-SEC-011). */
    async blockedEither(a: string, b: string): Promise<boolean> {
      if (a === b) return false;
      const r = await k
        .selectFrom('blocks')
        .select('player_id')
        .where((eb) =>
          eb.or([
            eb.and([eb('player_id', '=', a), eb('target_id', '=', b)]),
            eb.and([eb('player_id', '=', b), eb('target_id', '=', a)]),
          ]),
        )
        .executeTakeFirst();
      return r !== undefined;
    },

    /**
     * Of `others`, those in a block with `playerId` in either direction (filters invitation and
     * friend-request lists without leaking who blocked whom).
     */
    async blockedAmong(playerId: string, others: readonly string[]): Promise<Set<string>> {
      const list = [...new Set(others)].filter((o) => o !== playerId);
      if (list.length === 0) return new Set();
      const r = await k
        .selectFrom('blocks')
        .select(['player_id', 'target_id'])
        .where((eb) =>
          eb.or([
            eb.and([eb('player_id', '=', playerId), eb('target_id', 'in', list)]),
            eb.and([eb('target_id', '=', playerId), eb('player_id', 'in', list)]),
          ]),
        )
        .execute();
      return new Set(r.map((x) => (x.player_id === playerId ? x.target_id : x.player_id)));
    },
  };
}

export type SafetyRepo = ReturnType<typeof safetyRepo>;
