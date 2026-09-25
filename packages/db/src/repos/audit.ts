/** Append-only audit log (support, fraud review; spec 10.4 and 13.3). */
import type { CompiledQuery } from 'kysely';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { JsonObject } from '../json.ts';

export interface AuditEntry {
  id: string;
  playerId: string | null;
  kind: string;
  payload: JsonObject;
  at: number;
}

export interface AuditInput {
  playerId: string | null;
  kind: string;
  payload?: JsonObject;
  at?: number;
}

export function auditRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  function appendStatement(input: AuditInput): CompiledQuery {
    const at = input.at ?? ctx.now();
    return k
      .insertInto('audit_log')
      .values({
        id: uuidv7(at),
        player_id: input.playerId,
        kind: input.kind,
        payload_json: ctx.json.encode('audit_log.payload_json', JsonObject, input.payload ?? {}),
        at,
      })
      .compile();
  }

  return {
    async append(input: AuditInput): Promise<void> {
      await k.executeQuery(appendStatement(input));
    },

    /** The insert, for atomic lists (trades and wagers log in the same transaction). */
    appendStatement,

    async listForPlayer(playerId: string, limit = 100): Promise<AuditEntry[]> {
      const list = await k
        .selectFrom('audit_log')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(1000, Math.floor(limit))))
        .execute();
      return list.map((a) => ({
        id: a.id,
        playerId: a.player_id,
        kind: a.kind,
        payload: ctx.json.decode('audit_log.payload_json', JsonObject, a.payload_json),
        at: a.at,
      }));
    },
  };
}

export type AuditRepo = ReturnType<typeof auditRepo>;
