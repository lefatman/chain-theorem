/**
 * The admin console (M6 6.4; `ADMIN_EMAILS` only): JSON under `/api/admin/*` and the same as
 * server-rendered pages with forms under `/admin/*` (strict CSP, no script). Every action is
 * audited with the admin's id (`moderation/admin.ts`).
 *
 * | Method and path                                    | Body            | Answer                          |
 * | -------------------------------------------------- | --------------- | ------------------------------- |
 * | `GET /api/admin/reports`                           | —               | `{ reports, open }` (oldest first) |
 * | `POST /api/admin/reports/:id`                      | `ResolveReport` | `{ report }`; 404 `not_open`    |
 * | `GET /api/admin/players?q=`                        | —               | `{ players }`                   |
 * | `GET /api/admin/players/:id`                       | —               | `PlayerFacts`                   |
 * | `POST /api/admin/players/:id/suspend`              | `Sanction`      | `{ player, closed }`            |
 * | `POST /api/admin/players/:id/unsuspend`            | —               | `{ player }`                    |
 * | `POST /api/admin/players/:id/chat-ban`             | `Sanction`      | `{ player }` (`hours` required) |
 * | `POST /api/admin/players/:id/chat-unban`           | —               | `{ player }`                    |
 * | `GET /api/admin/tournaments`                       | —               | `{ tournaments }` (M7 7.1)      |
 * | `POST /api/admin/tournaments`                      | `CreateTournament` | `{ tournament }`             |
 * | `POST /api/admin/tournaments/:id/cancel`           | —               | `{ tournament }`; 409 `closed`  |
 * | `GET /admin`, `/admin/players?q=`, `/admin/players/:id` | —          | the pages                       |
 * | `GET /admin/tournaments`, `POST /admin/tournaments`, `POST /admin/tournaments/:id/cancel` | form | M7 7.1 |
 * | `POST /admin/reports/:id`, `/admin/players/:id/...` | form           | 303 back to the page            |
 */
import { CreateTournament, ResolveReport, Sanction } from '@chain-theorem/protocol';
import { HttpError, body, json, type Router } from '../http.ts';
import {
  chatBan,
  liftChatBan,
  lookup,
  playerFacts,
  reportQueue,
  resolveReport,
  suspend,
  unsuspend,
  type AdminCtx,
} from '../moderation/admin.ts';
import { requireAdmin } from '../moderation/admin-auth.ts';
import {
  consolePage,
  errorPage,
  htmlResponse,
  playerPage,
  searchPage,
} from '../moderation/pages.ts';
import { createFromForm, tournamentsPage } from '../moderation/tournaments.ts';
import { adminList, cancelTournament, createTournament } from './tournaments.ts';
import type { Ctx } from './context.ts';

async function adminCtx(ctx: Ctx): Promise<AdminCtx> {
  const admin = await requireAdmin(ctx);
  return { env: ctx.env, db: ctx.db, now: ctx.now, admin };
}

/** Render an admin page; errors become an HTML page with the same status. */
async function htmlPage(f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof HttpError) return errorPage(e.status, e.code);
    throw e;
  }
}

async function form(req: Request): Promise<URLSearchParams> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 16 * 1024) throw new HttpError(413, 'too_large');
  return new URLSearchParams(await req.text());
}

function see(location: string): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

/** A sanction from a form: `hours` (and `indefinite` for a suspension) plus a reason. */
function sanctionFrom(f: URLSearchParams, allowIndefinite: boolean): Sanction {
  const hours = allowIndefinite && f.get('indefinite') === '1' ? null : Number(f.get('hours'));
  const r = Sanction.safeParse({ hours, reason: f.get('reason') ?? '' });
  if (!r.success) throw new HttpError(400, 'bad_request');
  return r.data;
}

const playerPath = (id: string) => `/admin/players/${encodeURIComponent(id)}`;

export function adminRoutes(r: Router<Ctx>): void {
  // ---- JSON ---------------------------------------------------------------------------------------
  r.add('GET', '/api/admin/reports', async (req, ctx) => {
    await adminCtx(ctx);
    const limit = Number(new URL(req.url).searchParams.get('limit')) || 100;
    return json(await reportQueue(ctx.db, limit));
  });

  r.add('POST', '/api/admin/reports/:id', async (req, ctx, params) => {
    const c = await adminCtx(ctx);
    const input = await body(req, ResolveReport);
    return json({
      report: await resolveReport(c, params.id ?? '', input.action, input.note ?? null),
    });
  });

  r.add('GET', '/api/admin/players', async (req, ctx) => {
    await adminCtx(ctx);
    const q = new URL(req.url).searchParams.get('q') ?? '';
    return json({ players: await lookup(ctx.db, q, ctx.now) });
  });

  r.add('GET', '/api/admin/players/:id', async (_req, ctx, params) => {
    await adminCtx(ctx);
    return json(await playerFacts(ctx.db, params.id ?? '', ctx.now));
  });

  r.add('POST', '/api/admin/players/:id/suspend', async (req, ctx, params) => {
    const c = await adminCtx(ctx);
    const input = await body(req, Sanction);
    const id = params.id ?? '';
    const closed = await suspend(c, id, input.hours, input.reason);
    return json({ player: await playerFacts(ctx.db, id, ctx.now), closed });
  });

  r.add('POST', '/api/admin/players/:id/unsuspend', async (_req, ctx, params) => {
    const c = await adminCtx(ctx);
    const id = params.id ?? '';
    await unsuspend(c, id);
    return json({ player: await playerFacts(ctx.db, id, ctx.now) });
  });

  r.add('POST', '/api/admin/players/:id/chat-ban', async (req, ctx, params) => {
    const c = await adminCtx(ctx);
    const input = await body(req, Sanction);
    if (input.hours === null) throw new HttpError(400, 'bad_request');
    const id = params.id ?? '';
    await chatBan(c, id, input.hours, input.reason);
    return json({ player: await playerFacts(ctx.db, id, ctx.now) });
  });

  r.add('POST', '/api/admin/players/:id/chat-unban', async (_req, ctx, params) => {
    const c = await adminCtx(ctx);
    const id = params.id ?? '';
    await liftChatBan(c, id);
    return json({ player: await playerFacts(ctx.db, id, ctx.now) });
  });

  // ---- Tournaments (M7 7.1; audited admin.tournament_create / admin.tournament_cancel) ---------------
  r.add('GET', '/api/admin/tournaments', async (_req, ctx) => {
    await adminCtx(ctx);
    return json({ tournaments: await adminList(ctx.db) });
  });

  r.add('POST', '/api/admin/tournaments', async (req, ctx) => {
    const c = await adminCtx(ctx);
    const input = await body(req, CreateTournament);
    return json({ tournament: await createTournament(ctx.env, ctx.db, input, c.admin, ctx.now) });
  });

  r.add('POST', '/api/admin/tournaments/:id/cancel', async (_req, ctx, params) => {
    const c = await adminCtx(ctx);
    return json({
      tournament: await cancelTournament(ctx.env, ctx.db, params.id ?? '', c.admin, ctx.now),
    });
  });

  r.add('GET', '/admin/tournaments', async (req, ctx) =>
    htmlPage(async () => {
      await adminCtx(ctx);
      const done = new URL(req.url).searchParams.get('done') ?? undefined;
      return htmlResponse(tournamentsPage(await adminList(ctx.db), done));
    }),
  );

  r.add('POST', '/admin/tournaments', async (req, ctx) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      await createTournament(ctx.env, ctx.db, createFromForm(await form(req)), c.admin, ctx.now);
      return see('/admin/tournaments?done=tournament_created');
    }),
  );

  r.add('POST', '/admin/tournaments/:id/cancel', async (_req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      await cancelTournament(ctx.env, ctx.db, params.id ?? '', c.admin, ctx.now);
      return see('/admin/tournaments?done=tournament_cancelled');
    }),
  );

  // ---- Pages --------------------------------------------------------------------------------------
  r.add('GET', '/admin', async (req, ctx) =>
    htmlPage(async () => {
      await adminCtx(ctx);
      const done = new URL(req.url).searchParams.get('done') ?? undefined;
      return htmlResponse(consolePage(await reportQueue(ctx.db), done));
    }),
  );

  r.add('GET', '/admin/players', async (req, ctx) =>
    htmlPage(async () => {
      await adminCtx(ctx);
      const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
      return htmlResponse(searchPage(q, q ? await lookup(ctx.db, q, ctx.now) : []));
    }),
  );

  r.add('GET', '/admin/players/:id', async (req, ctx, params) =>
    htmlPage(async () => {
      await adminCtx(ctx);
      const done = new URL(req.url).searchParams.get('done') ?? undefined;
      return htmlResponse(playerPage(await playerFacts(ctx.db, params.id ?? '', ctx.now), done));
    }),
  );

  r.add('POST', '/admin/reports/:id', async (req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      const f = await form(req);
      const action = f.get('action');
      if (action !== 'review' && action !== 'dismiss') throw new HttpError(400, 'bad_request');
      const note = (f.get('note') ?? '').trim().slice(0, 500);
      await resolveReport(c, params.id ?? '', action, note || null);
      return see(`/admin?done=${action === 'review' ? 'reviewed' : 'dismissed'}`);
    }),
  );

  r.add('POST', '/admin/players/:id/suspend', async (req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      const s = sanctionFrom(await form(req), true);
      const id = params.id ?? '';
      await suspend(c, id, s.hours, s.reason);
      return see(`${playerPath(id)}?done=suspended`);
    }),
  );

  r.add('POST', '/admin/players/:id/unsuspend', async (_req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      const id = params.id ?? '';
      await unsuspend(c, id);
      return see(`${playerPath(id)}?done=unsuspended`);
    }),
  );

  r.add('POST', '/admin/players/:id/chat-ban', async (req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      const s = sanctionFrom(await form(req), false);
      if (s.hours === null) throw new HttpError(400, 'bad_request');
      const id = params.id ?? '';
      await chatBan(c, id, s.hours, s.reason);
      return see(`${playerPath(id)}?done=chat_banned`);
    }),
  );

  r.add('POST', '/admin/players/:id/chat-unban', async (_req, ctx, params) =>
    htmlPage(async () => {
      const c = await adminCtx(ctx);
      const id = params.id ?? '';
      await liftChatBan(c, id);
      return see(`${playerPath(id)}?done=chat_unbanned`);
    }),
  );
}
