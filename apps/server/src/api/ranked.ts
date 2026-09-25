/**
 * Ranked play and leaderboards (M6 6.2, 6.1; spec 9.3 R-FMT-004, 10.4 R-WORLD-004).
 *
 * - `POST /api/ranked/ticket` `{ format, loadoutId }`: a 60 s ticket for the ranked queue socket
 *   `/ws/ranked/:format/:loadoutId` (R-SEC-006). The bracket is the one the player's LEVEL unlocks
 *   (never the loadout), so unequipping items cannot sandbag. One battle at a time: a player with a
 *   battle in progress gets `in_battle`.
 * - `GET /api/ratings/me`: the player's bracket and ratings.
 * - `GET /api/leaderboards?format=&bracket=&limit=`: the best listed players and the caller's rank.
 * - `GET /api/leaderboards/guilds?format=&bracket=&limit=`: the guild leaderboard.
 */
import { LEADERBOARD, RANKED } from '@chain-theorem/content';
import type { Db, Rating } from '@chain-theorem/db';
import {
  JoinRanked,
  LeaderboardQuery,
  type Format,
  type GuildLeaderboard,
  type Leaderboard,
  type MyRatings,
  type RankedTicket,
  type RatingView,
} from '@chain-theorem/protocol';
import type { Loadout } from '@chain-theorem/rules';
import { signTicket, verifyTicket } from '../auth/tickets.ts';
import { refusePlay, requirePlay } from '../billing/gate.ts';
import type { Env } from '../env.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import { DEFAULT_RATING } from '../rating/glicko2.ts';
import {
  bracketForLevel,
  isBracket,
  isRankedFormat,
  provisional,
  withIdle,
  type Bracket,
} from '../rating/ranked.ts';
import type { RoomInfo } from '../rooms/battle-room.ts';
import { legalLoadout, viewLoadouts } from './account.ts';
import { makeCtx, type Ctx } from './context.ts';

const RULES = { maxRd: LEADERBOARD.maxRd, minGames: LEADERBOARD.minGames };

/** The ranked queue's Matchmaker instance: one per format and bracket (12.2). */
export function rankedQueueName(format: string, bracket: Bracket): string {
  return `ranked:${format}:${bracket}`;
}

/** A player's standing, with idle-period RD growth applied for display (Glicko-2). */
async function ratingView(
  db: Db,
  playerId: string,
  format: string,
  bracket: Bracket,
  now: number,
  stored?: Rating | null,
): Promise<RatingView> {
  const r = stored === undefined ? await db.ratings.get(playerId, format, bracket) : stored;
  const shown = r ? withIdle(r, now) : DEFAULT_RATING;
  const games = r?.games ?? 0;
  const rank = r ? await db.ranked.rankOf(playerId, format, bracket, RULES) : null;
  return {
    format: format as Format,
    bracket,
    rating: Math.round(shown.rating),
    rd: Math.round(shown.rd),
    games,
    rank,
    provisional: provisional({ rd: r?.rd ?? DEFAULT_RATING.rd, games }),
  };
}

/** True when the player has a battle that is still being played (checked with its room). */
async function inBattle(env: Env, db: Db, playerId: string): Promise<boolean> {
  const rows = await db.battles.listActiveForPlayer(playerId);
  for (const b of rows.slice(0, 5)) {
    const res = await env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(b.id)).fetch(
      'https://room/info',
    );
    const info = (await res.json()) as RoomInfo;
    if (info.status === 'active') return true;
  }
  return false;
}

function parseQuery(req: Request): { format: Format; bracket: Bracket; limit: number } {
  const url = new URL(req.url);
  const q = LeaderboardQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) throw new HttpError(400, 'bad_request');
  return {
    format: q.data.format,
    bracket: q.data.bracket,
    limit: q.data.limit ?? LEADERBOARD.size,
  };
}

export function rankedRoutes(r: Router<Ctx>): void {
  r.add('POST', '/api/ranked/ticket', async (req, ctx) => {
    const { format, loadoutId } = await body(req, JoinRanked);
    if (!isRankedFormat(format)) throw new HttpError(400, 'not_ranked');
    // Ranked is online play: the trial or a subscription (14.4, the M6 billing gate).
    await requirePlay(ctx);
    const mine = await legalLoadout(ctx, loadoutId);
    if (await inBattle(ctx.env, ctx.db, mine.playerId)) throw new HttpError(409, 'in_battle');
    const bracket = bracketForLevel(mine.level);
    const room = `ranked:${format}:${loadoutId}`;
    const token = await signTicket(ctx.env.AUTH_SECRET, mine.playerId, room, ctx.now);
    const answer: RankedTicket = {
      url: `/ws/ranked/${format}/${encodeURIComponent(loadoutId)}?t=${encodeURIComponent(token)}`,
      format,
      bracket,
      rating: await ratingView(ctx.db, mine.playerId, format, bracket, ctx.now),
    };
    return json(answer);
  });

  r.add('GET', '/api/ratings/me', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const bracket = bracketForLevel(me.level);
    const stored = await ctx.db.ratings.listForPlayer(me.id);
    const ratings: RatingView[] = [];
    for (const row of stored) {
      if (!isRankedFormat(row.format) || !isBracket(row.bracket)) continue;
      ratings.push(await ratingView(ctx.db, me.id, row.format, row.bracket, ctx.now, row));
    }
    // The current bracket's formats are always listed (1500 until the first rated game).
    for (const format of RANKED.formats)
      if (!ratings.some((x) => x.format === format && x.bracket === bracket))
        ratings.push(await ratingView(ctx.db, me.id, format, bracket, ctx.now, null));
    const answer: MyRatings = {
      bracket,
      formats: RANKED.formats as Format[],
      ratings,
    };
    return json(answer);
  });

  r.add('GET', '/api/leaderboards/guilds', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { format, bracket, limit } = parseQuery(req);
    const opts = {
      top: LEADERBOARD.guildTop,
      minRated: LEADERBOARD.guildMinRated,
      ...RULES,
    };
    const rows = await ctx.db.guilds.board(format, bracket, { ...opts, limit });
    const entries = rows.map((g, i) => ({
      rank: i + 1,
      id: g.guildId,
      name: g.name,
      tag: g.tag,
      score: Math.round(g.score),
      rated: g.rated,
    }));
    const myGuild = await ctx.db.guilds.guildIdOf(me.id);
    let mine = entries.find((e) => e.id === myGuild) ?? null;
    if (myGuild && !mine) {
      // Beyond the shown rows: place it within the full board.
      const all = await ctx.db.guilds.board(format, bracket, { ...opts, limit: 10_000 });
      const i = all.findIndex((g) => g.guildId === myGuild);
      const g = all[i];
      if (g)
        mine = {
          rank: i + 1,
          id: g.guildId,
          name: g.name,
          tag: g.tag,
          score: Math.round(g.score),
          rated: g.rated,
        };
    }
    const answer: GuildLeaderboard = {
      format,
      bracket,
      entries,
      mine,
      rules: { top: opts.top, minRated: opts.minRated },
    };
    return json(answer);
  });

  r.add('GET', '/api/leaderboards', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { format, bracket, limit } = parseQuery(req);
    const rows = await ctx.db.ranked.board(format, bracket, RULES, limit);
    // Ties share the better place (standard competition ranking), as `rankOf` counts them.
    let place = 0;
    const entries = rows.map((x, i) => {
      if (i === 0 || x.rating !== rows[i - 1]?.rating) place = i + 1;
      return {
        rank: place,
        id: x.playerId,
        name: x.name,
        rating: Math.round(x.rating),
        rd: Math.round(x.rd),
        games: x.games,
        tag: x.tag,
      };
    });
    const stored = await ctx.db.ratings.get(me.id, format, bracket);
    const answer: Leaderboard = {
      format,
      bracket,
      entries,
      me: stored ? await ratingView(ctx.db, me.id, format, bracket, ctx.now, stored) : null,
      rules: RULES,
    };
    return json(answer);
  });
}

/**
 * `/ws/ranked/:format/:loadoutId?t=`: check the ticket, re-check the loadout (the collection is
 * live), work out the bracket from the current level and the rating, then hand the socket to the
 * ranked queue's Matchmaker.
 */
export async function rankedSocket(
  req: Request,
  env: Env,
  db: Db,
  format: string,
  loadoutId: string,
  token: string,
  now: number,
): Promise<Response> {
  if (!isRankedFormat(format)) return json({ error: 'not_found' }, 404);
  const player = await verifyTicket(env.AUTH_SECRET, token, `ranked:${format}:${loadoutId}`, now);
  if (!player) return json({ error: 'bad_ticket' }, 403);
  const me = await db.players.getById(player);
  const row = me ? (await db.loadouts.list(me.id)).find((l) => l.id === loadoutId) : undefined;
  if (!me || !row) return json({ error: 'not_found' }, 404);
  const refused = refusePlay(me, now);
  if (refused) return refused;
  const ctx = makeCtx(req, env, db, now);
  const [view] = await viewLoadouts(ctx, me.id, me.level, [row]);
  if (!view?.valid) return json({ error: 'invalid_loadout' }, 400);
  const bracket = bracketForLevel(me.level);
  const stored = await db.ratings.get(me.id, format, bracket);
  const headers = new Headers(req.headers);
  headers.set(
    'x-waiter',
    JSON.stringify({
      id: me.id,
      name: me.displayName,
      level: me.level,
      loadout: view.loadout as Loadout,
      format,
      ranked: { bracket, rating: withIdle(stored, now).rating },
    }),
  );
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(rankedQueueName(format, bracket)));
  return stub.fetch(new Request('https://queue/ws', { headers }));
}
