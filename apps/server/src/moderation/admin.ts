/**
 * The admin console's logic (M6 6.4), shared by the JSON routes (`/api/admin/*`) and the
 * server-rendered pages (`/admin/*`): the reports queue, player lookup with the facts a moderator
 * needs (and no more personal data than that), and the actions. Every action is audited with the
 * admin's id (an `admin.*` entry on the admin) and noted on the player (a `moderation.*` entry
 * without the admin's id, which the player's data export shows).
 */
import type { Db, Player, Report } from '@chain-theorem/db';
import { access } from '../billing/entitlement.ts';
import type { Env } from '../env.ts';
import { HttpError } from '../http.ts';
import { callPlayer } from '../world/routing.ts';
import { closeLive, type Closed } from './enforce.ts';
import { isChatBanned, isSuspended } from './sanctions.ts';

const HOUR_MS = 60 * 60 * 1000;

export interface Named {
  id: string;
  name: string;
}

export interface ReportView {
  id: string;
  reason: string;
  note: string | null;
  context: Report['context'];
  status: Report['status'];
  createdAt: number;
  /** Null once the reporter's account was deleted. Shown to moderators only. */
  reporter: Named | null;
  target: Named;
  resolvedAt: number | null;
  resolvedBy: Named | null;
  resolutionNote: string | null;
}

export interface PlayerSummary {
  id: string;
  name: string;
  /** Masked (`a***@example.com`): enough to recognise an account, no more (R-SEC-010). */
  email: string;
  level: number;
  createdAt: number;
  suspended: boolean;
  chatBanned: boolean;
}

export interface PlayerFacts extends PlayerSummary {
  access: 'trial' | 'subscriber' | 'expired';
  suspension: { at: number; until: number | null } | null;
  chatBanUntil: number | null;
  /** The zone the player is in right now, or null. */
  online: string | null;
  reports: { total: number; open: number; recent: ReportView[] };
  audit: { kind: string; at: number; payload: Record<string, unknown> }[];
}

export interface AdminCtx {
  env: Env;
  db: Db;
  now: number;
  admin: Player;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function reportView(r: Report): ReportView {
  return {
    id: r.id,
    reason: r.reason,
    note: r.note,
    context: r.context,
    status: r.status,
    createdAt: r.createdAt,
    reporter: r.reporterId ? { id: r.reporterId, name: r.reporterName ?? '?' } : null,
    target: { id: r.targetId, name: r.targetName },
    resolvedAt: r.resolvedAt,
    resolvedBy: r.resolvedBy ? { id: r.resolvedBy, name: r.resolvedByName ?? '?' } : null,
    resolutionNote: r.resolutionNote,
  };
}

export function summary(p: Player, now: number): PlayerSummary {
  return {
    id: p.id,
    name: p.displayName,
    email: maskEmail(p.email),
    level: p.level,
    createdAt: p.createdAt,
    suspended: isSuspended(p, now),
    chatBanned: isChatBanned(p, now),
  };
}

/** Open reports, oldest first, and how many are open in all. */
export async function reportQueue(db: Db, limit = 100) {
  const [reports, open] = await Promise.all([
    db.moderation.openReports(limit),
    db.moderation.countOpen(),
  ]);
  return { reports: reports.map(reportView), open };
}

export async function lookup(db: Db, q: string, now: number): Promise<PlayerSummary[]> {
  return (await db.moderation.findPlayers(q.slice(0, 254), 20)).map((p) => summary(p, now));
}

export async function playerFacts(db: Db, id: string, now: number): Promise<PlayerFacts> {
  const p = await db.players.getById(id);
  if (!p) throw new HttpError(404, 'not_found');
  const [counts, recent, audit, presence] = await Promise.all([
    db.moderation.reportCounts(id),
    db.moderation.reportsAbout(id, 20),
    db.audit.listForPlayer(id, 20),
    db.world.presence(id),
  ]);
  return {
    ...summary(p, now),
    access: access(p, now),
    suspension:
      isSuspended(p, now) && p.suspendedAt !== null
        ? { at: p.suspendedAt, until: p.suspendedUntil }
        : null,
    chatBanUntil: isChatBanned(p, now) ? p.chatBanUntil : null,
    online: presence?.zone ?? null,
    reports: { ...counts, recent: recent.map(reportView) },
    audit: audit.map((a) => ({ kind: a.kind, at: a.at, payload: a.payload })),
  };
}

/** Both audit entries of one action, in one atomic list. */
async function audit(
  c: AdminCtx,
  action: string,
  target: string,
  payload: Record<string, string | number | null>,
): Promise<void> {
  await c.db.atomic([
    c.db.audit.appendStatement({
      playerId: c.admin.id,
      kind: `admin.${action}`,
      payload: { target, ...payload },
      at: c.now,
    }),
    c.db.audit.appendStatement({
      playerId: target,
      kind: `moderation.${action}`,
      payload,
      at: c.now,
    }),
  ]);
}

async function target(c: AdminCtx, id: string): Promise<Player> {
  if (id === c.admin.id) throw new HttpError(400, 'bad_target');
  const p = await c.db.players.getById(id);
  if (!p) throw new HttpError(404, 'not_found');
  return p;
}

/** Close a report as reviewed (action taken) or dismissed; 404 when it is not open. */
export async function resolveReport(
  c: AdminCtx,
  id: string,
  action: 'review' | 'dismiss',
  note: string | null,
): Promise<ReportView> {
  const status = action === 'review' ? 'reviewed' : 'dismissed';
  const r = await c.db.moderation.resolveReport(id, { status, by: c.admin.id, note, now: c.now });
  if (!r) throw new HttpError(404, 'not_open');
  await c.db.audit.append({
    playerId: c.admin.id,
    kind: `admin.report_${status}`,
    payload: { report: id, target: r.targetId, note: note ?? null },
    at: c.now,
  });
  return reportView(r);
}

/**
 * Suspend for `hours`, or indefinitely (null): the sessions are revoked with it (R-SEC-006), then
 * the live zone, trade, queue and battle sockets are closed (a battle is left to the normal
 * disconnect grace).
 */
export async function suspend(
  c: AdminCtx,
  id: string,
  hours: number | null,
  reason: string,
): Promise<Closed> {
  await target(c, id);
  const until = hours === null ? null : c.now + Math.round(hours * HOUR_MS);
  await c.db.moderation.suspend(id, until, c.now);
  await audit(c, 'suspend', id, { until, reason });
  return closeLive(c.env, c.db, id, c.now);
}

export async function unsuspend(c: AdminCtx, id: string): Promise<void> {
  await target(c, id);
  await c.db.moderation.liftSuspension(id);
  await audit(c, 'unsuspend', id, {});
}

/** A server-wide chat ban for `hours`: applied to the player's live zone core at once. */
export async function chatBan(
  c: AdminCtx,
  id: string,
  hours: number,
  reason: string,
): Promise<void> {
  await target(c, id);
  const until = c.now + Math.round(hours * HOUR_MS);
  await c.db.moderation.setChatBan(id, until);
  await audit(c, 'chat_ban', id, { until, reason });
  await callPlayer(c.env, c.db, id, 'chatBan', { id, until });
}

export async function liftChatBan(c: AdminCtx, id: string): Promise<void> {
  await target(c, id);
  await c.db.moderation.setChatBan(id, null);
  await audit(c, 'chat_unban', id, {});
  await callPlayer(c.env, c.db, id, 'chatBan', { id, until: null });
}
