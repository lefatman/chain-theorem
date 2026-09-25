/**
 * Report, mute and block (M6 6.4; spec 15 R-SEC-011: "Report, mute and block stay available to
 * everyone") and the admin console's JSON bodies. The server validates every body with these
 * schemas; the client uses the types. A reported player never learns who reported them, and a
 * blocked pair's refusals look like an offline or unavailable target (DD in spec 18).
 */
import { z } from 'zod';
import { Channel } from './zone.ts';

const Id = z.string().min(1).max(64);
const Name = z.string().max(40);

/** Why a player is reported (a fixed list; the moderators' queue groups by it). */
export const ReportReason = z.enum([
  'harassment',
  'hate',
  'cheating',
  'spam',
  'inappropriate_name',
  'other',
]);
export type ReportReason = z.infer<typeof ReportReason>;

/** What the report is about, when it came from a chat line, a battle or a trade. */
export const ReportContext = z
  .object({
    /** The chat line as the reporter saw it, and its channel. */
    chat: z.object({ text: z.string().max(200), ch: Channel }).optional(),
    battleId: Id.optional(),
    tradeId: Id.optional(),
  })
  .strict();
export type ReportContext = z.infer<typeof ReportContext>;

/** `POST /api/reports`: report a player (by id). The note is optional, at most 500 characters. */
export const ReportBody = z.object({
  target: Id,
  reason: ReportReason,
  note: z.string().trim().max(500).optional(),
  context: ReportContext.optional(),
});
export type ReportBody = z.infer<typeof ReportBody>;

/** `POST /api/mutes`, `POST /api/blocks`: the player to mute or block. */
export const SafetyTarget = z.object({ id: Id });
export type SafetyTarget = z.infer<typeof SafetyTarget>;

export const SafetyEntry = z.object({ id: Id, name: Name, at: z.number().int() });
export type SafetyEntry = z.infer<typeof SafetyEntry>;

/** Answer of `GET /api/safety` and of every mute and block change: the caller's own lists. */
export const SafetyLists = z.object({
  muted: z.array(SafetyEntry),
  blocked: z.array(SafetyEntry),
  /** The PLAYTEST caps (config `SAFETY`). */
  limits: z.object({ mutes: z.number().int(), blocks: z.number().int() }),
});
export type SafetyLists = z.infer<typeof SafetyLists>;

// ---- Admin console (ADMIN_EMAILS only) -----------------------------------------------------------

/** `POST /api/admin/reports/:id`: close a report as reviewed (action taken) or dismissed. */
export const ResolveReport = z.object({
  action: z.enum(['review', 'dismiss']),
  note: z.string().trim().max(500).optional(),
});
export type ResolveReport = z.infer<typeof ResolveReport>;

/**
 * `POST /api/admin/players/:id/suspend` and `/chat-ban`: for `hours` (fractions allowed), or
 * indefinitely when `hours` is null (suspensions only). The reason goes to the audit log.
 */
export const Sanction = z.object({
  hours: z
    .number()
    .positive()
    .max(24 * 366 * 10)
    .nullable(),
  reason: z.string().trim().min(1).max(500),
});
export type Sanction = z.infer<typeof Sanction>;
