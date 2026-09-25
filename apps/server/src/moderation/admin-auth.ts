/**
 * Who may open the admin pages (the cost dashboard, 14.2; the moderation console, M6 6.4): the
 * signed-in players whose email is in `ADMIN_EMAILS` (comma-separated, a Worker secret in
 * production).
 */
import type { Player } from '@chain-theorem/db';
import type { Ctx } from '../api/context.ts';
import type { Env } from '../env.ts';
import { HttpError } from '../http.ts';

export function admins(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(env: Env, p: Player): boolean {
  return admins(env).includes(p.email.toLowerCase());
}

/** The signed-in admin; 401 signed out, 403 for everyone else. */
export async function requireAdmin(ctx: Ctx): Promise<Player> {
  const me = await ctx.requireMe();
  if (!isAdmin(ctx.env, me)) throw new HttpError(403, 'forbidden');
  return me;
}
