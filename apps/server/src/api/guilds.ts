/**
 * Guilds (M6 6.1; spec 10.4 R-WORLD-004). Every answer is the caller's `MyGuild` view.
 *
 * | Method and path                                  | Body              | Who                         |
 * | ------------------------------------------------ | ----------------- | --------------------------- |
 * | `GET /api/guilds/me`                             | —                 | anyone signed in            |
 * | `POST /api/guilds`                               | `CreateGuild`     | a player without a guild    |
 * | `POST /api/guilds/invites`                       | `GuildInviteBody` | leader, officers            |
 * | `POST /api/guilds/invites/:guildId/accept`       | —                 | the invitee                 |
 * | `DELETE /api/guilds/invites/:guildId`            | —                 | the invitee (decline)       |
 * | `DELETE /api/guilds/invites/:guildId/:playerId`  | —                 | leader, officers (revoke)   |
 * | `PUT /api/guilds/members/:id`                    | `SetGuildRank`    | the leader                  |
 * | `DELETE /api/guilds/members/:id`                 | —                 | leader; officers for members|
 * | `POST /api/guilds/leave`                         | —                 | a member                    |
 * | `DELETE /api/guilds/:id`                         | —                 | the leader (disband)        |
 *
 * After each membership change the guild's GuildRoom reloads its roster (R-SEC-011: the guild chat
 * filter follows the youngest member before the next line), and every affected member's zone channel
 * learns the new guild so guild chat follows at once.
 */
import { GUILDS } from '@chain-theorem/content';
import type { Db, GuildRankName } from '@chain-theorem/db';
import {
  CreateGuild,
  GuildInviteBody,
  SetGuildRank,
  type GuildView,
  type MyGuild,
} from '@chain-theorem/protocol';
import type { Env } from '../env.ts';
import { HttpError, body, json, type Router } from '../http.ts';
import { guildStub } from '../rooms/guild-room.ts';
import { callPlayer } from '../world/routing.ts';
import { basicChatFilter } from '../zone/index.ts';
import type { Ctx } from './context.ts';

/** The caller's guild, rank and invitations. */
export async function myGuild(db: Db, playerId: string): Promise<MyGuild> {
  const m = await db.guilds.membership(playerId);
  const invites = (await db.guilds.invitesFor(playerId)).map((i) => ({
    guildId: i.guildId,
    name: i.guildName,
    tag: i.guildTag,
    from: i.invitedByName,
    at: i.createdAt,
  }));
  if (!m) return { guild: null, rank: null, invites };
  const g = await db.guilds.get(m.guildId);
  if (!g) return { guild: null, rank: null, invites };
  const staff = m.rank === 'leader' || m.rank === 'officer';
  const guild: GuildView = {
    id: g.id,
    name: g.name,
    tag: g.tag,
    size: g.size,
    maxMembers: g.maxSize,
    createdAt: g.createdAt,
    members: (await db.guilds.members(g.id)).map((x) => ({
      id: x.playerId,
      name: x.name,
      rank: x.rank,
      level: x.level,
      online: x.zone !== null,
      joinedAt: x.joinedAt,
    })),
    invited: staff
      ? (await db.guilds.invitesOf(g.id)).map((i) => ({
          id: i.playerId,
          name: i.playerName,
          at: i.createdAt,
        }))
      : [],
  };
  return { guild, rank: m.rank, invites };
}

/** The GuildRoom reloads its roster now (R-SEC-011 before the next line). */
async function refreshRoom(env: Env, guildId: string): Promise<void> {
  const res = await guildStub(env, guildId).fetch(
    `https://guild/refresh?g=${encodeURIComponent(guildId)}`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`guild ${guildId}: refresh ${res.status}`);
}

/** Tell each player's zone channel (if online) which guild they are in now. */
async function tellZones(
  env: Env,
  db: Db,
  playerIds: readonly string[],
  guild: string | null,
): Promise<void> {
  await Promise.all(playerIds.map((id) => callPlayer(env, db, id, 'guild', { id, guild })));
}

/** A player by id, or by display name when exactly one player has it (like friend requests). */
async function findPlayer(db: Db, to: string): Promise<string> {
  const byId = await db.players.getById(to);
  if (byId) return byId.id;
  const byName = await db.players.findByDisplayName(to, 2);
  if (byName.length === 1 && byName[0]) return byName[0].id;
  throw new HttpError(404, byName.length > 1 ? 'ambiguous_name' : 'not_found');
}

/** Guild names and tags are seen by everyone (leaderboards), minors included: no blocked words. */
function clean(s: string): boolean {
  return basicChatFilter.clean(s) === s;
}

export function guildRoutes(r: Router<Ctx>): void {
  r.add('GET', '/api/guilds/me', async (_req, ctx) => {
    const me = await ctx.requireMe();
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('POST', '/api/guilds', async (req, ctx) => {
    const me = await ctx.requireMe();
    const input = await body(req, CreateGuild);
    if (!clean(input.name) || !clean(input.tag)) throw new HttpError(400, 'bad_name');
    const res = await ctx.db.guilds.create({
      name: input.name,
      tag: input.tag,
      leaderId: me.id,
      maxSize: GUILDS.maxMembers,
      now: ctx.now,
    });
    if (res.status !== 'created') throw new HttpError(409, res.status);
    await refreshRoom(ctx.env, res.guild.id);
    await tellZones(ctx.env, ctx.db, [me.id], res.guild.id);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('POST', '/api/guilds/invites', async (req, ctx) => {
    const me = await ctx.requireMe();
    const { to } = await body(req, GuildInviteBody);
    const m = await ctx.db.guilds.membership(me.id);
    if (!m) throw new HttpError(404, 'no_guild');
    const target = await findPlayer(ctx.db, to);
    if (target === me.id) throw new HttpError(409, 'in_guild');
    const res = await ctx.db.guilds.invite(m.guildId, me.id, target, ctx.now);
    if (res === 'not_allowed') throw new HttpError(403, res);
    if (res !== 'invited') throw new HttpError(409, res);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('POST', '/api/guilds/invites/:guildId/accept', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const guildId = params.guildId ?? '';
    const res = await ctx.db.guilds.accept(guildId, me.id, ctx.now);
    if (res === 'no_invite') throw new HttpError(404, res);
    if (res !== 'joined') throw new HttpError(409, res);
    await refreshRoom(ctx.env, guildId);
    await tellZones(ctx.env, ctx.db, [me.id], guildId);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('DELETE', '/api/guilds/invites/:guildId', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    if (!(await ctx.db.guilds.deleteInvite(params.guildId ?? '', me.id)))
      throw new HttpError(404, 'no_invite');
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('DELETE', '/api/guilds/invites/:guildId/:playerId', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const guildId = params.guildId ?? '';
    const rank = await ctx.db.guilds.rankIn(guildId, me.id);
    if (rank !== 'leader' && rank !== 'officer') throw new HttpError(403, 'not_allowed');
    if (!(await ctx.db.guilds.deleteInvite(guildId, params.playerId ?? '')))
      throw new HttpError(404, 'no_invite');
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('PUT', '/api/guilds/members/:id', async (req, ctx, params) => {
    const me = await ctx.requireMe();
    const { rank } = await body(req, SetGuildRank);
    const m = await ctx.db.guilds.membership(me.id);
    if (!m) throw new HttpError(404, 'no_guild');
    const res = await ctx.db.guilds.setRank(
      m.guildId,
      me.id,
      params.id ?? '',
      rank as GuildRankName,
    );
    if (res !== 'ok') throw new HttpError(403, res);
    await refreshRoom(ctx.env, m.guildId);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('DELETE', '/api/guilds/members/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const target = params.id ?? '';
    const m = await ctx.db.guilds.membership(me.id);
    if (!m) throw new HttpError(404, 'no_guild');
    const res = await ctx.db.guilds.kick(m.guildId, me.id, target);
    if (res !== 'ok') throw new HttpError(403, res);
    await refreshRoom(ctx.env, m.guildId);
    await tellZones(ctx.env, ctx.db, [target], null);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('POST', '/api/guilds/leave', async (_req, ctx) => {
    const me = await ctx.requireMe();
    const m = await ctx.db.guilds.membership(me.id);
    if (!m) throw new HttpError(404, 'no_guild');
    const res = await ctx.db.guilds.leave(m.guildId, me.id);
    if (res === 'not_member') throw new HttpError(404, 'no_guild');
    await refreshRoom(ctx.env, m.guildId);
    await tellZones(ctx.env, ctx.db, [me.id], null);
    return json(await myGuild(ctx.db, me.id));
  });

  r.add('DELETE', '/api/guilds/:id', async (_req, ctx, params) => {
    const me = await ctx.requireMe();
    const guildId = params.id ?? '';
    const members = (await ctx.db.guilds.members(guildId)).map((x) => x.playerId);
    const res = await ctx.db.guilds.disband(guildId, me.id);
    if (res !== 'ok') throw new HttpError(403, res);
    await refreshRoom(ctx.env, guildId);
    await tellZones(ctx.env, ctx.db, members, null);
    return json(await myGuild(ctx.db, me.id));
  });
}
