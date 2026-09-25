/**
 * Report, mute and block (M6 6.4; spec 15 R-SEC-011: "Report, mute and block stay available to
 * everyone"): no entitlement gate, minors and trial accounts included. The lists are private; the
 * reported, muted or blocked player is never told.
 *
 * | Method and path            | Body           | Answer                                             |
 * | -------------------------- | -------------- | -------------------------------------------------- |
 * | `GET /api/safety`          | —              | `SafetyLists { muted, blocked, limits }`           |
 * | `POST /api/mutes`          | `SafetyTarget` | `SafetyLists`; 404 `not_found`, 409 `too_many`     |
 * | `DELETE /api/mutes/:id`    | —              | `SafetyLists`                                      |
 * | `POST /api/blocks`         | `SafetyTarget` | `SafetyLists` (also ends a friendship or request)  |
 * | `DELETE /api/blocks/:id`   | —              | `SafetyLists`                                      |
 * | `POST /api/reports`        | `ReportBody`   | 201 `{ id }`; 404 `not_found`, 429 `too_many_reports` |
 *
 * Every change refreshes the player's live zone core (`/safety`) before the next line is delivered.
 */
import { SAFETY } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import { ReportBody, SafetyTarget, type SafetyLists } from '@chain-theorem/protocol';
import type { Env } from '../env.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import { callPlayer } from '../world/routing.ts';
import type { Ctx } from './context.ts';

export async function safetyLists(db: Db, playerId: string): Promise<SafetyLists> {
  const [muted, blocked] = await Promise.all([
    db.safety.mutes(playerId),
    db.safety.blocks(playerId),
  ]);
  return { muted, blocked, limits: { mutes: SAFETY.maxMutes, blocks: SAFETY.maxBlocks } };
}

/** Apply the player's lists to their zone core now (R-SEC-011: before the next line). */
async function refreshZone(env: Env, db: Db, playerId: string): Promise<void> {
  const [muted, blocked] = await Promise.all([
    db.safety.mutedIds(playerId),
    db.safety.blockedIds(playerId),
  ]);
  await callPlayer(env, db, playerId, 'safety', { id: playerId, muted, blocked });
}

function added(r: 'added' | 'exists' | 'limit' | 'no_player'): void {
  if (r === 'no_player') throw new HttpError(404, 'not_found');
  if (r === 'limit') throw new HttpError(409, 'too_many');
}

export function safetyRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/safety', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json(await safetyLists(ctx.db, me.id));
  });

  r.add('POST', '/api/mutes', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { id } = await body(req, SafetyTarget);
    if (id === me.id) throw new HttpError(400, 'bad_target');
    added(await ctx.db.safety.mute(me.id, id, SAFETY.maxMutes, ctx.now));
    await refreshZone(ctx.env, ctx.db, me.id);
    return json(await safetyLists(ctx.db, me.id));
  });

  r.add('DELETE', '/api/mutes/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    await ctx.db.safety.unmute(me.id, params.id ?? '');
    await refreshZone(ctx.env, ctx.db, me.id);
    return json(await safetyLists(ctx.db, me.id));
  });

  r.add('POST', '/api/blocks', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { id } = await body(req, SafetyTarget);
    if (id === me.id) throw new HttpError(400, 'bad_target');
    added(await ctx.db.safety.block(me.id, id, SAFETY.maxBlocks, ctx.now));
    await refreshZone(ctx.env, ctx.db, me.id);
    return json(await safetyLists(ctx.db, me.id));
  });

  r.add('DELETE', '/api/blocks/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    await ctx.db.safety.unblock(me.id, params.id ?? '');
    await refreshZone(ctx.env, ctx.db, me.id);
    return json(await safetyLists(ctx.db, me.id));
  });

  r.add('POST', '/api/reports', async (req, ctx) => {
    const me = await ctx.requireMe();
    const input = await body(req, ReportBody);
    if (input.target === me.id) throw new HttpError(400, 'bad_target');
    if ((input.note ?? '').length > SAFETY.reportNoteMax) throw new HttpError(400, 'bad_request');
    const res = await ctx.db.moderation.fileReport({
      reporterId: me.id,
      targetId: input.target,
      reason: input.reason,
      note: input.note ?? null,
      context: input.context ?? null,
      perDay: SAFETY.reportsPerDay,
      now: ctx.now,
    });
    if (res.status === 'no_player') throw new HttpError(404, 'not_found');
    if (res.status === 'rate_limited') throw new HttpError(429, 'too_many_reports');
    return json({ id: res.report.id }, 201);
  });
}
