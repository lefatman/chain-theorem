/**
 * Guild chat, pure (M6 6.1; spec 10.4 R-WORLD-004, R-SEC-011): the roster a GuildRoom caches and the
 * line it delivers. A guild channel is filtered for everyone while ANY member is under 18; the level
 * is computed from the current roster for every line, and the roster is reloaded whenever the guild's
 * roster version moved (every membership change bumps it), so a change always applies before the
 * next line is delivered.
 */
import type { GuildRankName } from '@chain-theorem/db';
import { conversationFiltered, type ChatFilter } from '../zone/chat.ts';
import type { RoutedChat } from '../zone/index.ts';

export interface RosterMember {
  p: string;
  name: string;
  rank: GuildRankName;
  /** Epoch ms when the member turns 18 (the only age data, R-SEC-011). */
  adultFrom: number;
}

export interface Roster {
  guild: string;
  /** `guilds.roster_version` the members were read at. */
  version: number;
  members: RosterMember[];
}

/** R-SEC-011: the guild channel's level: filtered while any member is under 18 at `now`. */
export function guildFiltered(roster: Roster, now: number): boolean {
  return conversationFiltered(roster.members.map((m) => ({ adult: now >= m.adultFrom })));
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * The line to deliver to every online member, or null when the sender is not a member (a stale
 * zone core). A filtered channel never carries the raw text: it is cleaned here unless the sender's
 * zone core already cleaned it (a minor sender).
 */
export function guildLine(
  roster: Roster,
  msg: RoutedChat,
  now: number,
  filter: ChatFilter,
): RoutedChat | null {
  const sender = roster.members.find((m) => m.p === msg.from);
  if (!sender) return null;
  const filtered = guildFiltered(roster, now) || msg.filtered || !msg.fromAdult;
  const text = filtered && !msg.filtered ? cut(filter.clean(msg.text), 200) : cut(msg.text, 200);
  return {
    ch: 'guild',
    from: sender.p,
    name: cut(sender.name, 40),
    text,
    filtered,
    fromAdult: now >= sender.adultFrom,
    friend: true,
  };
}
