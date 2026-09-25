/**
 * Guilds (spec 10.4 R-WORLD-004; M6 6.1): membership, ranks (leader, officer, member), invitations,
 * the roster the GuildRoom caches, and the guild leaderboard.
 *
 * Every membership change is one atomic list (DD-15) that starts by bumping `guilds.roster_version`:
 * on PostgreSQL that row lock serializes all changes of one guild (each later statement reads the
 * committed state), and the new version tells a GuildRoom its roster cache is stale. The invariants
 * are constraints, so a D1 batch that cannot stop halfway still aborts as a whole: one guild per
 * player and one leader per guild are unique indexes, the member cap is CHECK (size <= max_size)
 * after the recount, and a name or tag is unique. Authority (who may invite, promote or kick) is a
 * condition inside the statements; the affected-row counts say whether it held.
 */
import { sql, type CompiledQuery, type Kysely, type Selectable } from 'kysely';
import { DbConstraintError } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import { rows, type RepoContext } from '../db-types.ts';
import type { GuildsTable, Schema } from '../schema.ts';

export const GUILD_RANKS = ['leader', 'officer', 'member'] as const;
export type GuildRankName = (typeof GUILD_RANKS)[number];

export interface Guild {
  id: string;
  name: string;
  tag: string;
  /** The founder (null once that account is deleted); the leader is a member's rank. */
  founderId: string | null;
  size: number;
  maxSize: number;
  rosterVersion: number;
  createdAt: number;
}

export interface GuildMember {
  playerId: string;
  name: string;
  rank: GuildRankName;
  level: number;
  joinedAt: number;
  /** Epoch ms when the member turns 18 (R-SEC-011 filtering by the youngest member). */
  adultFrom: number;
  /** Online presence: the zone channel the member is in, or null. */
  zone: string | null;
  channel: number | null;
}

export interface GuildInvite {
  guildId: string;
  guildName: string;
  guildTag: string;
  playerId: string;
  playerName: string;
  invitedBy: string | null;
  invitedByName: string | null;
  createdAt: number;
}

export interface GuildBoardRow {
  guildId: string;
  name: string;
  tag: string;
  /** Mean rating of the best `top` listed members. */
  score: number;
  rated: number;
}

export type CreateGuildResult =
  { status: 'created'; guild: Guild } | { status: 'name_taken' | 'tag_taken' | 'in_guild' };

export type JoinResult = 'joined' | 'no_invite' | 'in_guild' | 'full';
export type InviteResult = 'invited' | 'not_allowed' | 'in_guild' | 'already_invited' | 'full';
export type RankResult = 'ok' | 'not_allowed';

const RANK_ORDER = sql<number>`CASE rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END`;

function toGuild(row: Selectable<GuildsTable>): Guild {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    founderId: row.owner_id,
    size: row.size,
    maxSize: row.max_size,
    rosterVersion: row.roster_version,
    createdAt: row.created_at,
  };
}

const asRank = (r: string): GuildRankName =>
  (GUILD_RANKS as readonly string[]).includes(r) ? (r as GuildRankName) : 'member';

/** Case-insensitive key of a guild name (names are unique regardless of case). */
export function guildNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The statements that remove `playerId` from `guildId` (leave, kick, account deletion). When
 * `actor` is given, the removal needs the actor's authority: the leader removes anyone else, an
 * officer removes members. After the removal a guild without a leader promotes its longest-serving
 * officer (else member), the size is recounted, and an empty guild is deleted with its invitations.
 * Counts: [1] is 1 when the member was removed, [5] is 1 when the guild was deleted.
 */
export function guildRemovalStatements(
  k: Kysely<Schema>,
  guildId: string,
  playerId: string,
  actor: string | null = null,
): CompiledQuery[] {
  let remove = k
    .deleteFrom('guild_members')
    .where('guild_id', '=', guildId)
    .where('player_id', '=', playerId);
  if (actor !== null)
    remove = remove.where((eb) =>
      eb.or([
        eb.and([
          eb('rank', '<>', 'leader'),
          eb.exists(
            eb
              .selectFrom('guild_members as a')
              .select('a.player_id')
              .where('a.guild_id', '=', guildId)
              .where('a.player_id', '=', actor)
              .where('a.rank', '=', 'leader'),
          ),
        ]),
        eb.and([
          eb('rank', '=', 'member'),
          eb.exists(
            eb
              .selectFrom('guild_members as a')
              .select('a.player_id')
              .where('a.guild_id', '=', guildId)
              .where('a.player_id', '=', actor)
              .where('a.rank', '=', 'officer'),
          ),
        ]),
      ]),
    );
  return [
    bumpStatement(k, guildId),
    remove.compile(),
    k
      .updateTable('guild_members')
      .set({ rank: 'leader' })
      .where('guild_id', '=', guildId)
      .where('player_id', '=', (eb) =>
        eb
          .selectFrom('guild_members as s')
          .select('s.player_id')
          .where('s.guild_id', '=', guildId)
          .orderBy(sql`CASE s.rank WHEN 'officer' THEN 0 ELSE 1 END`)
          .orderBy('s.joined_at')
          .orderBy('s.player_id')
          .limit(1),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('guild_members as l')
              .select('l.player_id')
              .where('l.guild_id', '=', guildId)
              .where('l.rank', '=', 'leader'),
          ),
        ),
      )
      .compile(),
    recountStatement(k, guildId),
    k
      .deleteFrom('guild_invites')
      .where('guild_id', '=', guildId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('guild_members as m')
              .select('m.player_id')
              .where('m.guild_id', '=', guildId),
          ),
        ),
      )
      .compile(),
    k
      .deleteFrom('guilds')
      .where('id', '=', guildId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('guild_members as m')
              .select('m.player_id')
              .where('m.guild_id', '=', guildId),
          ),
        ),
      )
      .compile(),
  ];
}

/** Bumps the roster version: the first statement of every membership change (see the header). */
function bumpStatement(k: Kysely<Schema>, guildId: string): CompiledQuery {
  return k
    .updateTable('guilds')
    .set((eb) => ({ roster_version: eb('roster_version', '+', 1) }))
    .where('id', '=', guildId)
    .compile();
}

/** Recounts the members; CHECK (size <= max_size) aborts a join past the cap. */
function recountStatement(k: Kysely<Schema>, guildId: string): CompiledQuery {
  return k
    .updateTable('guilds')
    .set((eb) => ({
      size: eb
        .selectFrom('guild_members as c')
        .select((e) => e.fn.countAll<number>().as('n'))
        .where('c.guild_id', '=', guildId),
    }))
    .where('id', '=', guildId)
    .compile();
}

export function guildRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function get(id: string): Promise<Guild | null> {
    const row = await k.selectFrom('guilds').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toGuild(row) : null;
  }

  async function membership(
    playerId: string,
  ): Promise<{ guildId: string; rank: GuildRankName } | null> {
    const row = await k
      .selectFrom('guild_members')
      .select(['guild_id', 'rank'])
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    return row ? { guildId: row.guild_id, rank: asRank(row.rank) } : null;
  }

  async function rankIn(guildId: string, playerId: string): Promise<GuildRankName | null> {
    const row = await k
      .selectFrom('guild_members')
      .select('rank')
      .where('guild_id', '=', guildId)
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    return row ? asRank(row.rank) : null;
  }

  return {
    get,
    membership,
    rankIn,

    /** The guild id of a player, or null (PlayerInit, R-SEC-011 guild chat). */
    async guildIdOf(playerId: string): Promise<string | null> {
      return (await membership(playerId))?.guildId ?? null;
    },

    async getByTag(tag: string): Promise<Guild | null> {
      const row = await k
        .selectFrom('guilds')
        .selectAll()
        .where('tag', '=', tag.trim().toUpperCase())
        .executeTakeFirst();
      return row ? toGuild(row) : null;
    },

    /**
     * Found a guild led by `leaderId`. Names are unique regardless of case, tags are stored upper
     * case and unique; a player already in a guild cannot found another.
     */
    async create(input: {
      name: string;
      tag: string;
      leaderId: string;
      maxSize: number;
      now?: number;
    }): Promise<CreateGuildResult> {
      const now = input.now ?? ctx.now();
      const name = input.name.trim().replace(/\s+/g, ' ');
      const tag = input.tag.trim().toUpperCase();
      if (name.length === 0 || tag.length === 0)
        throw new RangeError('guild name and tag required');
      if (!Number.isInteger(input.maxSize) || input.maxSize < 1)
        throw new RangeError('maxSize must be a positive integer');
      const id = uuidv7(now);
      try {
        await ctx.atomic([
          k
            .insertInto('guilds')
            .values({
              id,
              name,
              name_key: guildNameKey(name),
              tag,
              owner_id: input.leaderId,
              created_at: now,
              max_size: input.maxSize,
              size: 0,
              roster_version: 0,
            })
            .compile(),
          k
            .insertInto('guild_members')
            .values({ guild_id: id, player_id: input.leaderId, rank: 'leader', joined_at: now })
            .compile(),
          recountStatement(k, id),
          k.deleteFrom('guild_invites').where('player_id', '=', input.leaderId).compile(),
        ]);
      } catch (err) {
        if (!(err instanceof DbConstraintError) || err.kind !== 'unique') throw err;
        if (await membership(input.leaderId)) return { status: 'in_guild' };
        const byName = await k
          .selectFrom('guilds')
          .select('id')
          .where('name_key', '=', guildNameKey(name))
          .executeTakeFirst();
        if (byName) return { status: 'name_taken' };
        return { status: 'tag_taken' };
      }
      return { status: 'created', guild: (await get(id)) as Guild };
    },

    /** Members with name, level and presence: leader, officers, members; each by join time. */
    async members(guildId: string): Promise<GuildMember[]> {
      const list = await k
        .selectFrom('guild_members')
        .innerJoin('players', 'players.id', 'guild_members.player_id')
        .select([
          'guild_members.player_id',
          'guild_members.rank',
          'guild_members.joined_at',
          'players.display_name',
          'players.level',
          'players.adult_from',
          'players.presence_zone',
          'players.presence_channel',
        ])
        .where('guild_members.guild_id', '=', guildId)
        .orderBy(RANK_ORDER)
        .orderBy('guild_members.joined_at')
        .orderBy('guild_members.player_id')
        .execute();
      return list.map((m) => ({
        playerId: m.player_id,
        name: m.display_name,
        rank: asRank(m.rank),
        level: m.level,
        joinedAt: m.joined_at,
        adultFrom: m.adult_from,
        zone: m.presence_zone,
        channel: m.presence_channel,
      }));
    },

    /** Members in a zone channel right now (presence), for delivering guild chat. */
    async online(guildId: string): Promise<{ playerId: string; zone: string; channel: number }[]> {
      const list = await k
        .selectFrom('guild_members')
        .innerJoin('players', 'players.id', 'guild_members.player_id')
        .select(['guild_members.player_id', 'players.presence_zone', 'players.presence_channel'])
        .where('guild_members.guild_id', '=', guildId)
        .where('players.presence_zone', 'is not', null)
        .where('players.presence_channel', 'is not', null)
        .orderBy('guild_members.player_id')
        .execute();
      return list.map((m) => ({
        playerId: m.player_id,
        zone: m.presence_zone ?? '',
        channel: m.presence_channel ?? 0,
      }));
    },

    /** The roster version alone (a GuildRoom checks it before trusting its cache). */
    async rosterVersion(guildId: string): Promise<number | null> {
      const row = await k
        .selectFrom('guilds')
        .select('roster_version')
        .where('id', '=', guildId)
        .executeTakeFirst();
      return row ? row.roster_version : null;
    },

    /**
     * Invite `targetId` to the guild. The actor must be its leader or an officer; the target must
     * not be in a guild. The insert carries both conditions, so a concurrent change cannot slip in.
     */
    async invite(
      guildId: string,
      actorId: string,
      targetId: string,
      now: number = ctx.now(),
    ): Promise<InviteResult> {
      const actorRank = await rankIn(guildId, actorId);
      if (actorRank !== 'leader' && actorRank !== 'officer') return 'not_allowed';
      if (await membership(targetId)) return 'in_guild';
      const g = await get(guildId);
      if (!g) return 'not_allowed';
      if (g.size >= g.maxSize) return 'full';
      const res = await k
        .insertInto('guild_invites')
        .columns(['guild_id', 'player_id', 'invited_by', 'created_at'])
        .expression((eb) =>
          eb
            .selectFrom('guild_members as a')
            .select([
              'a.guild_id',
              sql<string>`CAST(${targetId} AS TEXT)`.as('player_id'),
              'a.player_id as invited_by',
              sql.lit(now).as('created_at'),
            ])
            .where('a.guild_id', '=', guildId)
            .where('a.player_id', '=', actorId)
            .where('a.rank', 'in', ['leader', 'officer'])
            .where((w) =>
              w.not(
                w.exists(
                  w
                    .selectFrom('guild_members as t')
                    .select('t.player_id')
                    .where('t.player_id', '=', targetId),
                ),
              ),
            ),
        )
        .onConflict((oc) => oc.columns(['guild_id', 'player_id']).doNothing())
        .executeTakeFirst();
      if (rows(res.numInsertedOrUpdatedRows) === 1) return 'invited';
      const again = await k
        .selectFrom('guild_invites')
        .select('player_id')
        .where('guild_id', '=', guildId)
        .where('player_id', '=', targetId)
        .executeTakeFirst();
      if (again) return 'already_invited';
      return (await membership(targetId)) ? 'in_guild' : 'not_allowed';
    },

    /** Invitations waiting for a player, newest first. */
    async invitesFor(playerId: string): Promise<GuildInvite[]> {
      const list = await k
        .selectFrom('guild_invites as i')
        .innerJoin('guilds as g', 'g.id', 'i.guild_id')
        .innerJoin('players as p', 'p.id', 'i.player_id')
        .leftJoin('players as by', 'by.id', 'i.invited_by')
        .select([
          'i.guild_id',
          'i.player_id',
          'i.invited_by',
          'i.created_at',
          'g.name',
          'g.tag',
          'p.display_name as player_name',
          'by.display_name as by_name',
        ])
        .where('i.player_id', '=', playerId)
        .orderBy('i.created_at', 'desc')
        .orderBy('i.guild_id')
        .execute();
      return list.map((r) => ({
        guildId: r.guild_id,
        guildName: r.name,
        guildTag: r.tag,
        playerId: r.player_id,
        playerName: r.player_name,
        invitedBy: r.invited_by,
        invitedByName: r.by_name,
        createdAt: r.created_at,
      }));
    },

    /** Pending invitations of a guild, oldest first. */
    async invitesOf(guildId: string): Promise<GuildInvite[]> {
      const list = await k
        .selectFrom('guild_invites as i')
        .innerJoin('guilds as g', 'g.id', 'i.guild_id')
        .innerJoin('players as p', 'p.id', 'i.player_id')
        .leftJoin('players as by', 'by.id', 'i.invited_by')
        .select([
          'i.guild_id',
          'i.player_id',
          'i.invited_by',
          'i.created_at',
          'g.name',
          'g.tag',
          'p.display_name as player_name',
          'by.display_name as by_name',
        ])
        .where('i.guild_id', '=', guildId)
        .orderBy('i.created_at')
        .orderBy('i.player_id')
        .execute();
      return list.map((r) => ({
        guildId: r.guild_id,
        guildName: r.name,
        guildTag: r.tag,
        playerId: r.player_id,
        playerName: r.player_name,
        invitedBy: r.invited_by,
        invitedByName: r.by_name,
        createdAt: r.created_at,
      }));
    },

    /** The invitee declines, or the leader or an officer revokes; false when there was none. */
    async deleteInvite(guildId: string, playerId: string): Promise<boolean> {
      const r = await k
        .deleteFrom('guild_invites')
        .where('guild_id', '=', guildId)
        .where('player_id', '=', playerId)
        .executeTakeFirst();
      return rows(r.numDeletedRows) === 1;
    },

    /**
     * Accept an invitation: the member row is inserted only from the invitation itself, the
     * recount's CHECK refuses a full guild, the unique player index refuses a second guild, and the
     * player's other invitations go.
     */
    async accept(guildId: string, playerId: string, now: number = ctx.now()): Promise<JoinResult> {
      let counts: number[];
      try {
        counts = await ctx.atomic([
          bumpStatement(k, guildId),
          k
            .insertInto('guild_members')
            .columns(['guild_id', 'player_id', 'rank', 'joined_at'])
            .expression((eb) =>
              eb
                .selectFrom('guild_invites as i')
                .select([
                  'i.guild_id',
                  'i.player_id',
                  sql.lit('member').as('rank'),
                  sql.lit(now).as('joined_at'),
                ])
                .where('i.guild_id', '=', guildId)
                .where('i.player_id', '=', playerId),
            )
            .compile(),
          recountStatement(k, guildId),
          k
            .deleteFrom('guild_invites')
            .where('player_id', '=', playerId)
            .where((eb) =>
              eb.exists(
                eb
                  .selectFrom('guild_members as m')
                  .select('m.player_id')
                  .where('m.guild_id', '=', guildId)
                  .where('m.player_id', '=', playerId),
              ),
            )
            .compile(),
        ]);
      } catch (err) {
        if (!(err instanceof DbConstraintError)) throw err;
        if (err.kind === 'check') return 'full';
        if (err.kind === 'unique') return 'in_guild';
        throw err;
      }
      return counts[1] === 1 ? 'joined' : 'no_invite';
    },

    /**
     * Leave the guild. A leaving leader hands over to the longest-serving officer (else member); the
     * last member leaving deletes the guild. Resolves to what happened.
     */
    async leave(guildId: string, playerId: string): Promise<'left' | 'disbanded' | 'not_member'> {
      const counts = await ctx.atomic(guildRemovalStatements(k, guildId, playerId));
      if (counts[1] !== 1) return 'not_member';
      return counts[5] === 1 ? 'disbanded' : 'left';
    },

    /** Remove a member: the leader removes anyone else, an officer removes members. */
    async kick(guildId: string, actorId: string, targetId: string): Promise<RankResult> {
      if (actorId === targetId) return 'not_allowed';
      const counts = await ctx.atomic(guildRemovalStatements(k, guildId, targetId, actorId));
      return counts[1] === 1 ? 'ok' : 'not_allowed';
    },

    /**
     * Change a member's rank; only the leader may. `officer` promotes a member, `member` demotes an
     * officer, `leader` hands leadership to another member (the old leader becomes an officer).
     */
    async setRank(
      guildId: string,
      actorId: string,
      targetId: string,
      rank: GuildRankName,
    ): Promise<RankResult> {
      if (actorId === targetId) return 'not_allowed';
      const leaderCheck = k
        .selectFrom('guild_members as a')
        .select('a.player_id')
        .where('a.guild_id', '=', guildId)
        .where('a.player_id', '=', actorId)
        .where('a.rank', '=', 'leader');
      if (rank === 'officer' || rank === 'member') {
        const from = rank === 'officer' ? 'member' : 'officer';
        const counts = await ctx.atomic([
          bumpStatement(k, guildId),
          k
            .updateTable('guild_members')
            .set({ rank })
            .where('guild_id', '=', guildId)
            .where('player_id', '=', targetId)
            .where('rank', '=', from)
            .where((eb) => eb.exists(leaderCheck))
            .compile(),
        ]);
        return counts[1] === 1 ? 'ok' : 'not_allowed';
      }
      const counts = await ctx.atomic([
        bumpStatement(k, guildId),
        // The leader steps down to officer, if the target is a member of this guild...
        k
          .updateTable('guild_members')
          .set({ rank: 'officer' })
          .where('guild_id', '=', guildId)
          .where('player_id', '=', actorId)
          .where('rank', '=', 'leader')
          .where((eb) =>
            eb.exists(
              eb
                .selectFrom('guild_members as t')
                .select('t.player_id')
                .where('t.guild_id', '=', guildId)
                .where('t.player_id', '=', targetId),
            ),
          )
          .compile(),
        // ...and the target takes over only while the guild has no leader (the step above ran).
        k
          .updateTable('guild_members')
          .set({ rank: 'leader' })
          .where('guild_id', '=', guildId)
          .where('player_id', '=', targetId)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('guild_members as l')
                  .select('l.player_id')
                  .where('l.guild_id', '=', guildId)
                  .where('l.rank', '=', 'leader'),
              ),
            ),
          )
          .compile(),
      ]);
      return counts[2] === 1 ? 'ok' : 'not_allowed';
    },

    /** The leader disbands the guild: every member and invitation goes, then the guild. */
    async disband(guildId: string, actorId: string): Promise<RankResult> {
      const leaderCheck = k
        .selectFrom('guild_members as a')
        .select('a.player_id')
        .where('a.guild_id', '=', guildId)
        .where('a.player_id', '=', actorId)
        .where('a.rank', '=', 'leader');
      const counts = await ctx.atomic([
        bumpStatement(k, guildId),
        k
          .deleteFrom('guild_invites')
          .where('guild_id', '=', guildId)
          .where((eb) => eb.exists(leaderCheck))
          .compile(),
        // Everyone but the leader first, so the leader check holds for the whole statement.
        k
          .deleteFrom('guild_members')
          .where('guild_id', '=', guildId)
          .where('player_id', '<>', actorId)
          .where((eb) => eb.exists(leaderCheck))
          .compile(),
        k
          .deleteFrom('guild_members')
          .where('guild_id', '=', guildId)
          .where('player_id', '=', actorId)
          .where('rank', '=', 'leader')
          .compile(),
        k
          .deleteFrom('guilds')
          .where('id', '=', guildId)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('guild_members as m')
                  .select('m.player_id')
                  .where('m.guild_id', '=', guildId),
              ),
            ),
          )
          .compile(),
      ]);
      return counts[4] === 1 ? 'ok' : 'not_allowed';
    },

    /**
     * The guild leaderboard for one format and bracket (10.4): a guild's score is the mean rating of
     * its best `top` members who are listed on the player leaderboard (at most `maxRd` deviation, at
     * least `minGames` games); guilds with fewer than `minRated` such members are not listed.
     */
    async board(
      format: string,
      bracket: string,
      opts: { top: number; minRated: number; maxRd: number; minGames: number; limit: number },
    ): Promise<GuildBoardRow[]> {
      const r = await sql<{
        guild_id: string;
        name: string;
        tag: string;
        score: number | string;
        rated: number | string;
      }>`
        SELECT g.id AS guild_id, g.name AS name, g.tag AS tag, AVG(t.rating) AS score,
               COUNT(*) AS rated
        FROM (
          SELECT gm.guild_id AS guild_id, r.rating AS rating,
                 ROW_NUMBER() OVER (
                   PARTITION BY gm.guild_id ORDER BY r.rating DESC, r.player_id
                 ) AS rn
          FROM ratings r
          JOIN guild_members gm ON gm.player_id = r.player_id
          WHERE r.format = ${format} AND r.bracket = ${bracket}
            AND r.rd <= ${opts.maxRd} AND r.games >= ${opts.minGames}
        ) t
        JOIN guilds g ON g.id = t.guild_id
        WHERE t.rn <= ${opts.top}
        GROUP BY g.id, g.name, g.tag
        HAVING COUNT(*) >= ${opts.minRated}
        ORDER BY score DESC, g.id
        LIMIT ${opts.limit}`.execute(k);
      return r.rows.map((row) => ({
        guildId: row.guild_id,
        name: row.name,
        tag: row.tag,
        score: Number(row.score),
        rated: Number(row.rated),
      }));
    },
  };
}

export type GuildRepo = ReturnType<typeof guildRepo>;
