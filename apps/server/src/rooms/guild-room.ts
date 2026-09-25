/**
 * GuildRoom Durable Object (M6 6.1, spec 12.2): one instance per guild, named by the guild id. It
 * holds the roster cache (members, ranks, when each turns 18) and routes guild chat (10.4): a zone
 * channel forwards a member's line (`POST /chat`), the room checks the sender against the roster,
 * filters the line for everyone while any member is under 18 (R-SEC-011) and delivers it to every
 * online member through presence (the ZoneRoom host call `/deliver`).
 *
 * The cache is only trusted at the guild's current roster version: every membership change bumps the
 * version in the same atomic list, so a stale cache is reloaded before the next line is delivered.
 * The REST routes also call `POST /refresh` after each change. No sockets, no timers, no loops: the
 * room only answers requests (R-COST-002).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Db } from '@chain-theorem/db';
import { getDb, releaseDb } from '../db.ts';
import type { Env } from '../env.ts';
import { guildFiltered, guildLine, type Roster } from '../guild/chat.ts';
import { zoneStub } from '../world/routing.ts';
import { basicChatFilter, type RoutedChat } from '../zone/index.ts';

export function guildStub(env: Env, guildId: string): DurableObjectStub {
  return env.GUILD_ROOM.get(env.GUILD_ROOM.idFromName(guildId));
}

/** What `GET /roster` answers (tests and support). */
export interface RosterInfo {
  roster: Roster | null;
  filtered: boolean;
}

export class GuildRoom extends DurableObject<Env> {
  private roster: Roster | null = null;
  private loaded = false;

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const guild = url.searchParams.get('g') ?? '';
    if (!guild) return new Response('missing guild', { status: 400 });
    const db = await getDb(this.env);
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'POST /refresh': {
          const r = await this.reload(db, guild);
          return Response.json({ ok: true, filtered: r ? guildFiltered(r, Date.now()) : false });
        }
        case 'GET /roster': {
          const r = await this.current(db, guild);
          const info: RosterInfo = {
            roster: r,
            filtered: r ? guildFiltered(r, Date.now()) : false,
          };
          return Response.json(info);
        }
        case 'POST /chat': {
          const { msg } = (await req.json()) as { msg: RoutedChat };
          return await this.chat(db, guild, msg);
        }
        default:
          return new Response('not found', { status: 404 });
      }
    } finally {
      await releaseDb(this.env, db);
    }
  }

  private async chat(db: Db, guild: string, msg: RoutedChat): Promise<Response> {
    const roster = await this.current(db, guild);
    const now = Date.now();
    const line = roster ? guildLine(roster, msg, now, basicChatFilter) : null;
    if (!line) return Response.json({ error: 'not_member' }, { status: 404 });
    const online = await db.guilds.online(guild);
    const members = new Set(roster?.members.map((m) => m.p));
    const sent = await Promise.all(
      online
        .filter((m) => members.has(m.playerId))
        .map(async (m) => {
          try {
            const res = await zoneStub(this.env, m.zone, m.channel).fetch('https://zone/deliver', {
              method: 'POST',
              body: JSON.stringify({ to: m.playerId, msg: line }),
            });
            return res.ok;
          } catch {
            return false;
          }
        }),
    );
    return Response.json({ ok: true, delivered: sent.filter(Boolean).length });
  }

  /** The roster at the guild's current version (reloaded when a membership change moved it). */
  private async current(db: Db, guild: string): Promise<Roster | null> {
    if (!this.loaded) {
      this.roster = (await this.ctx.storage.get<Roster>('roster')) ?? null;
      this.loaded = true;
    }
    const version = await db.guilds.rosterVersion(guild);
    if (version === null) return this.reload(db, guild);
    if (this.roster?.guild === guild && this.roster.version === version) return this.roster;
    return this.reload(db, guild);
  }

  /** Read the members again (after a membership change); null once the guild is gone. */
  private async reload(db: Db, guild: string): Promise<Roster | null> {
    const g = await db.guilds.get(guild);
    this.loaded = true;
    if (!g) {
      this.roster = null;
      await this.ctx.storage.delete('roster');
      return null;
    }
    const members = await db.guilds.members(guild);
    const roster: Roster = {
      guild,
      version: g.rosterVersion,
      members: members.map((m) => ({
        p: m.playerId,
        name: m.name,
        rank: m.rank,
        adultFrom: m.adultFrom,
      })),
    };
    this.roster = roster;
    await this.ctx.storage.put('roster', roster);
    return roster;
  }
}
