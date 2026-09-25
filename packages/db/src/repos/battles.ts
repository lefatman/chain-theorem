/**
 * Battle summaries (spec 13.3). The row is created when the battle starts (result NULL) and finished
 * once; the full event log lives in the BattleRoom and is archived to R2 under `log_key`.
 */
import type { CompiledQuery, Selectable } from 'kysely';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import type { BattlesTable } from '../schema.ts';

export type BattleResult = 'white' | 'black' | 'draw' | 'aborted';
export const BATTLE_RESULTS: readonly BattleResult[] = ['white', 'black', 'draw', 'aborted'];

export interface Battle {
  id: string;
  format: string;
  /** Null for an NPC side or a deleted account. */
  whiteId: string | null;
  blackId: string | null;
  result: BattleResult | null;
  reason: string | null;
  startedAt: number;
  endedAt: number | null;
  logKey: string | null;
}

export interface NewBattle {
  /**
   * Defaults to a new UUIDv7. The BattleRoom passes the id it was created under, which need not be
   * a UUID (for example `c-<code>` for a challenge-link battle): any 1..128 character string.
   */
  id?: string;
  format: string;
  whiteId: string | null;
  blackId: string | null;
  startedAt?: number;
}

export interface BattleEnd {
  result: BattleResult;
  reason: string;
  endedAt?: number;
  logKey?: string | null;
}

function asResult(value: string | null): BattleResult | null {
  if (value === null) return null;
  if ((BATTLE_RESULTS as readonly string[]).includes(value)) return value as BattleResult;
  throw new Error(`unknown battle result in database: ${value}`);
}

export function toBattle(row: Selectable<BattlesTable>): Battle {
  return {
    id: row.id,
    format: row.format,
    whiteId: row.white_id,
    blackId: row.black_id,
    result: asResult(row.result),
    reason: row.reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    logKey: row.log_key,
  };
}

export function battleRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function get(id: string): Promise<Battle | null> {
    const row = await k.selectFrom('battles').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toBattle(row) : null;
  }

  function finishStatement(id: string, end: BattleEnd): CompiledQuery {
    if (!BATTLE_RESULTS.includes(end.result)) throw new RangeError(`bad result ${end.result}`);
    return k
      .updateTable('battles')
      .set({
        result: end.result,
        reason: end.reason,
        ended_at: end.endedAt ?? ctx.now(),
        log_key: end.logKey ?? null,
      })
      .where('id', '=', id)
      .where('result', 'is', null)
      .compile();
  }

  return {
    /** Inserts the battle row at start with a null result. */
    async create(input: NewBattle): Promise<Battle> {
      const startedAt = input.startedAt ?? ctx.now();
      if (input.id !== undefined && (input.id.length === 0 || input.id.length > 128)) {
        throw new RangeError('battle id must be 1..128 characters');
      }
      const row = {
        id: input.id ?? uuidv7(startedAt),
        format: input.format,
        white_id: input.whiteId,
        black_id: input.blackId,
        result: null,
        reason: null,
        started_at: startedAt,
        ended_at: null,
        log_key: null,
      };
      await k.insertInto('battles').values(row).execute();
      return toBattle(row);
    },

    get,

    /** Records the result once; false if the battle is unknown or already finished. */
    async finish(id: string, end: BattleEnd): Promise<boolean> {
      const r = await k.executeQuery(finishStatement(id, end));
      return rows(r.numAffectedRows) === 1;
    },

    /** The finish UPDATE, for an atomic list that also grants rewards. */
    finishStatement,

    /** Most recent battles the player took part in, newest first. */
    async listRecentForPlayer(playerId: string, limit = 20): Promise<Battle[]> {
      const list = await k
        .selectFrom('battles')
        .selectAll()
        .where((eb) => eb.or([eb('white_id', '=', playerId), eb('black_id', '=', playerId)]))
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(100, Math.floor(limit))))
        .execute();
      return list.map(toBattle);
    },

    /** Battles the player is in that have no result yet (result IS NULL), newest first. */
    async listActiveForPlayer(playerId: string, limit = 20): Promise<Battle[]> {
      const list = await k
        .selectFrom('battles')
        .selectAll()
        .where('result', 'is', null)
        .where((eb) => eb.or([eb('white_id', '=', playerId), eb('black_id', '=', playerId)]))
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(100, Math.floor(limit))))
        .execute();
      return list.map(toBattle);
    },
  };
}

export type BattleRepo = ReturnType<typeof battleRepo>;
