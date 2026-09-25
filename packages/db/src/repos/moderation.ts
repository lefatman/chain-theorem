/**
 * Reports, suspensions, chat bans and player lookup for the admin console (M6 6.4; spec 15
 * R-SEC-011, R-SEC-006, R-SEC-010).
 *
 * - A report is filed by one player about another; the reported player never sees who filed it.
 *   Each reporter may file `perDay` reports per rolling 24 hours (config `SAFETY`, best effort under
 *   a burst of parallel requests). A report is closed once (`reviewed` or `dismissed`): the update
 *   is conditional on `status = 'open'`.
 * - A suspension sets `players.suspended_at` / `suspended_until` (NULL: indefinitely) and revokes
 *   every session in the same atomic list (DD-15). A chat ban sets `players.chat_ban_until`.
 * - Lookup finds players by id, exact email or display name (case-insensitive, prefix).
 */
import { sql, type Selectable } from 'kysely';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import { ReportContextJson } from '../json.ts';
import type { ReportsTable } from '../schema.ts';
import { normalizeEmail, toPlayer, type Player } from './players.ts';

export const REPORT_REASONS = [
  'harassment',
  'hate',
  'cheating',
  'spam',
  'inappropriate_name',
  'other',
] as const;
export type ReportReasonName = (typeof REPORT_REASONS)[number];
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export interface Report {
  id: string;
  /** Null once the reporter's account was deleted. Never shown to the reported player. */
  reporterId: string | null;
  reporterName: string | null;
  targetId: string;
  targetName: string;
  reason: ReportReasonName;
  note: string | null;
  context: ReportContextJson | null;
  status: ReportStatus;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

export interface FileReportInput {
  reporterId: string;
  targetId: string;
  reason: ReportReasonName;
  note?: string | null;
  context?: ReportContextJson | null;
  /** Reports one reporter may file per rolling 24 hours. */
  perDay: number;
  now?: number;
}

export type FileReportResult =
  { status: 'filed'; report: Report } | { status: 'rate_limited' } | { status: 'no_player' };

const DAY_MS = 24 * 60 * 60 * 1000;
const asReason = (r: string): ReportReasonName =>
  (REPORT_REASONS as readonly string[]).includes(r) ? (r as ReportReasonName) : 'other';
const asStatus = (s: string): ReportStatus => (s === 'reviewed' || s === 'dismissed' ? s : 'open');

type ReportRow = Selectable<ReportsTable> & {
  reporter_name: string | null;
  target_name: string | null;
  resolver_name: string | null;
};

export function moderationRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  function toReport(r: ReportRow): Report {
    return {
      id: r.id,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
      targetId: r.target_id,
      targetName: r.target_name ?? '?',
      reason: asReason(r.reason),
      note: r.note,
      context:
        r.context_json === null || r.context_json === undefined
          ? null
          : ctx.json.decode('reports.context_json', ReportContextJson, r.context_json),
      status: asStatus(r.status),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      resolvedByName: r.resolver_name,
      resolutionNote: r.resolution_note,
    };
  }

  function reports() {
    return k
      .selectFrom('reports as r')
      .leftJoin('players as rp', 'rp.id', 'r.reporter_id')
      .leftJoin('players as tp', 'tp.id', 'r.target_id')
      .leftJoin('players as mp', 'mp.id', 'r.resolved_by')
      .selectAll('r')
      .select([
        'rp.display_name as reporter_name',
        'tp.display_name as target_name',
        'mp.display_name as resolver_name',
      ]);
  }

  async function get(id: string): Promise<Report | null> {
    const r = await reports().where('r.id', '=', id).executeTakeFirst();
    return r ? toReport(r) : null;
  }

  async function countFiledSince(reporterId: string, since: number): Promise<number> {
    const r = await k
      .selectFrom('reports')
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .where('reporter_id', '=', reporterId)
      .where('created_at', '>', since)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  async function setSanction(
    playerId: string,
    set: {
      suspended_at?: number | null;
      suspended_until?: number | null;
      chat_ban_until?: number | null;
    },
  ): Promise<boolean> {
    const r = await k.updateTable('players').set(set).where('id', '=', playerId).executeTakeFirst();
    return rows(r.numUpdatedRows) === 1;
  }

  return {
    getReport: get,
    countFiledSince,

    /** File a report (R-SEC-011). */
    async fileReport(input: FileReportInput): Promise<FileReportResult> {
      if (input.reporterId === input.targetId) throw new RangeError('cannot report yourself');
      const now = input.now ?? ctx.now();
      const target = await k
        .selectFrom('players')
        .select('id')
        .where('id', '=', input.targetId)
        .executeTakeFirst();
      if (!target) return { status: 'no_player' };
      if ((await countFiledSince(input.reporterId, now - DAY_MS)) >= input.perDay)
        return { status: 'rate_limited' };
      const id = uuidv7(now);
      const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
      await k
        .insertInto('reports')
        .values({
          id,
          reporter_id: input.reporterId,
          target_id: input.targetId,
          reason: asReason(input.reason),
          note,
          context_json: input.context
            ? ctx.json.encode('reports.context_json', ReportContextJson, input.context)
            : null,
          status: 'open',
          created_at: now,
        })
        .execute();
      const report = await get(id);
      if (!report) throw new Error('report vanished after insert');
      return { status: 'filed', report };
    },

    /** The moderators' queue: open reports, oldest first. */
    async openReports(limit = 100): Promise<Report[]> {
      const r = await reports()
        .where('r.status', '=', 'open')
        .orderBy('r.created_at')
        .orderBy('r.id')
        .limit(Math.max(1, Math.min(500, Math.floor(limit))))
        .execute();
      return r.map(toReport);
    },

    async countOpen(): Promise<number> {
      const r = await k
        .selectFrom('reports')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('status', '=', 'open')
        .executeTakeFirst();
      return Number(r?.n ?? 0);
    },

    /** Reports about a player, newest first (the admin console's player page). */
    async reportsAbout(targetId: string, limit = 20): Promise<Report[]> {
      const r = await reports()
        .where('r.target_id', '=', targetId)
        .orderBy('r.created_at', 'desc')
        .orderBy('r.id', 'desc')
        .limit(Math.max(1, Math.min(200, Math.floor(limit))))
        .execute();
      return r.map(toReport);
    },

    /** How many reports name the player: all of them and those still open. */
    async reportCounts(targetId: string): Promise<{ total: number; open: number }> {
      const r = await k
        .selectFrom('reports')
        .select(['status', (eb) => eb.fn.countAll<number | string>().as('n')])
        .where('target_id', '=', targetId)
        .groupBy('status')
        .execute();
      let total = 0;
      let open = 0;
      for (const x of r) {
        total += Number(x.n);
        if (x.status === 'open') open += Number(x.n);
      }
      return { total, open };
    },

    /**
     * Close an open report as reviewed (action taken) or dismissed, once. Resolves to the closed
     * report, or null when there is no such open report.
     */
    async resolveReport(
      id: string,
      input: { status: 'reviewed' | 'dismissed'; by: string; note?: string | null; now?: number },
    ): Promise<Report | null> {
      const now = input.now ?? ctx.now();
      const r = await k
        .updateTable('reports')
        .set({
          status: input.status,
          resolved_at: now,
          resolved_by: input.by,
          resolution_note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
        })
        .where('id', '=', id)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (rows(r.numUpdatedRows) !== 1) return null;
      return get(id);
    },

    /**
     * Suspend the account until `until` (null: indefinitely) and revoke every session, in one
     * atomic list (R-SEC-006). False when there is no such player.
     */
    async suspend(playerId: string, until: number | null, now: number = ctx.now()) {
      const [updated] = await ctx.atomic([
        k
          .updateTable('players')
          .set({ suspended_at: now, suspended_until: until })
          .where('id', '=', playerId)
          .compile(),
        k.deleteFrom('sessions').where('player_id', '=', playerId).compile(),
      ]);
      return updated === 1;
    },

    /** Lift a suspension (early, or clear an expired one). False when there is no such player. */
    liftSuspension: (playerId: string) =>
      setSanction(playerId, { suspended_at: null, suspended_until: null }),

    /** Ban the player from chat until `until` (server-wide), or lift it with null. */
    setChatBan: (playerId: string, until: number | null) =>
      setSanction(playerId, { chat_ban_until: until }),

    /**
     * Players matching `query`: an id, an exact email, or a display name (case-insensitive; exact
     * matches first, then names starting with it). At most `limit`.
     */
    async findPlayers(query: string, limit = 20): Promise<Player[]> {
      const q = query.trim();
      if (q.length === 0) return [];
      const n = Math.max(1, Math.min(50, Math.floor(limit)));
      if (q.includes('@')) {
        const r = await k
          .selectFrom('players')
          .selectAll()
          .where('email', '=', normalizeEmail(q))
          .execute();
        return r.map(toPlayer);
      }
      const byId = await k.selectFrom('players').selectAll().where('id', '=', q).execute();
      if (byId.length > 0) return byId.map(toPlayer);
      const lower = q.toLowerCase();
      const pattern = `${lower.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const r = await k
        .selectFrom('players')
        .selectAll()
        .where(sql<boolean>`lower(display_name) like ${pattern} escape '\\'`)
        .orderBy(sql`CASE WHEN lower(display_name) = ${lower} THEN 0 ELSE 1 END`)
        .orderBy('display_name')
        .orderBy('id')
        .limit(n)
        .execute();
      return r.map(toPlayer);
    },
  };
}

export type ModerationRepo = ReturnType<typeof moderationRepo>;
