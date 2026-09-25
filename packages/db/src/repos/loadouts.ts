/**
 * Saved loadouts (spec 13.3). `loadout_json` is validated structurally with Zod on write and read;
 * legality (R-LOAD-004) is decided by the rules engine and recorded as `is_valid` by the caller.
 * Every query is scoped by player id, so one player can never read or overwrite another's loadout.
 */
import type { Selectable } from 'kysely';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import { LoadoutJson } from '../json.ts';
import type { LoadoutsTable } from '../schema.ts';

export interface Loadout {
  id: string;
  playerId: string;
  name: string;
  loadout: LoadoutJson;
  isValid: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveLoadoutInput {
  /** Omit to create a new loadout; give an id to overwrite one the player owns. */
  id?: string;
  name: string;
  loadout: LoadoutJson;
  isValid: boolean;
  now?: number;
}

export function toLoadout(ctx: Pick<RepoContext, 'json'>, row: Selectable<LoadoutsTable>): Loadout {
  return {
    id: row.id,
    playerId: row.player_id,
    name: row.name,
    loadout: ctx.json.decode('loadouts.loadout_json', LoadoutJson, row.loadout_json),
    isValid: row.is_valid === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadoutRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function get(playerId: string, id: string): Promise<Loadout | null> {
    const row = await k
      .selectFrom('loadouts')
      .selectAll()
      .where('id', '=', id)
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    return row ? toLoadout(ctx, row) : null;
  }

  return {
    async list(playerId: string): Promise<Loadout[]> {
      const list = await k
        .selectFrom('loadouts')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      return list.map((r) => toLoadout(ctx, r));
    },

    get,

    async count(playerId: string): Promise<number> {
      const row = await k
        .selectFrom('loadouts')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('player_id', '=', playerId)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    /**
     * Creates or overwrites a loadout. Returns null when `id` is given but the player owns no such
     * loadout. Invalid JSON shapes reject with `DbDataError` before anything is written.
     */
    async save(playerId: string, input: SaveLoadoutInput): Promise<Loadout | null> {
      const now = input.now ?? ctx.now();
      const name = input.name.trim();
      if (name.length === 0) throw new RangeError('loadout name is empty');
      const json = ctx.json.encode('loadouts.loadout_json', LoadoutJson, input.loadout);
      const isValid = input.isValid ? 1 : 0;
      if (input.id === undefined) {
        const id = uuidv7(now);
        await k
          .insertInto('loadouts')
          .values({
            id,
            player_id: playerId,
            name,
            loadout_json: json,
            is_valid: isValid,
            created_at: now,
            updated_at: now,
          })
          .execute();
        return get(playerId, id);
      }
      const r = await k
        .updateTable('loadouts')
        .set({ name, loadout_json: json, is_valid: isValid, updated_at: now })
        .where('id', '=', input.id)
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1 ? get(playerId, input.id) : null;
    },

    /** Marks a loadout valid or invalid (for example after trading away an item it uses, 10.4). */
    async setValid(
      playerId: string,
      id: string,
      isValid: boolean,
      now: number = ctx.now(),
    ): Promise<boolean> {
      const r = await k
        .updateTable('loadouts')
        .set({ is_valid: isValid ? 1 : 0, updated_at: now })
        .where('id', '=', id)
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return rows(r.numUpdatedRows) === 1;
    },

    async delete(playerId: string, id: string): Promise<boolean> {
      const r = await k
        .deleteFrom('loadouts')
        .where('id', '=', id)
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },
  };
}

export type LoadoutRepo = ReturnType<typeof loadoutRepo>;
