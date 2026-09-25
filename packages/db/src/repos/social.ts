/**
 * Friends and parties (M5, 10.4). Friendships are one row per pair (a = requester); parties hold at
 * most four players and each player is in at most one party. Parties live in the database because
 * they span zones (party chat and travel go through each member's zone).
 */
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';
import { rows } from '../db-types.ts';

export const PARTY_MAX = 4;

export interface FriendView {
  id: string;
  name: string;
  /** `friends` both ways; `incoming` asks the viewer; `outgoing` waits for the other player. */
  status: 'friends' | 'incoming' | 'outgoing';
  /** Online zone, or null when offline. */
  zone: string | null;
}

export interface PartyMember {
  playerId: string;
  name: string;
  zone: string | null;
  channel: number | null;
}

export interface Party {
  id: string;
  leaderId: string;
  members: PartyMember[];
}

export function socialRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;

  async function party(partyId: string): Promise<Party | null> {
    const p = await k
      .selectFrom('parties')
      .selectAll()
      .where('id', '=', partyId)
      .executeTakeFirst();
    if (!p) return null;
    const members = await k
      .selectFrom('party_members')
      .innerJoin('players', 'players.id', 'party_members.player_id')
      .select([
        'party_members.player_id',
        'players.display_name',
        'players.presence_zone',
        'players.presence_channel',
        'party_members.joined_at',
      ])
      .where('party_members.party_id', '=', partyId)
      .orderBy('party_members.joined_at')
      .orderBy('party_members.player_id')
      .execute();
    return {
      id: p.id,
      leaderId: p.leader_id,
      members: members.map((m) => ({
        playerId: m.player_id,
        name: m.display_name,
        zone: m.presence_zone,
        channel: m.presence_channel,
      })),
    };
  }

  async function partyOf(playerId: string): Promise<Party | null> {
    const m = await k
      .selectFrom('party_members')
      .select('party_id')
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    return m ? party(m.party_id) : null;
  }

  return {
    /** Ask to be friends; accepting an incoming request instead makes the pair friends. */
    async requestFriend(
      from: string,
      to: string,
      now: number = ctx.now(),
    ): Promise<'requested' | 'friends'> {
      if (from === to) throw new RangeError('cannot befriend yourself');
      const incoming = await k
        .updateTable('friends')
        .set({ status: 'accepted' })
        .where('a_id', '=', to)
        .where('b_id', '=', from)
        .executeTakeFirst();
      if (rows(incoming.numUpdatedRows) === 1) return 'friends';
      await k
        .insertInto('friends')
        .values({ a_id: from, b_id: to, status: 'pending', created_at: now })
        .onConflict((oc) => oc.columns(['a_id', 'b_id']).doNothing())
        .execute();
      const back = await k
        .selectFrom('friends')
        .select('status')
        .where('a_id', '=', from)
        .where('b_id', '=', to)
        .executeTakeFirst();
      return back?.status === 'accepted' ? 'friends' : 'requested';
    },

    async removeFriend(a: string, b: string): Promise<void> {
      await k
        .deleteFrom('friends')
        .where((eb) =>
          eb.or([
            eb.and([eb('a_id', '=', a), eb('b_id', '=', b)]),
            eb.and([eb('a_id', '=', b), eb('b_id', '=', a)]),
          ]),
        )
        .execute();
    },

    async areFriends(a: string, b: string): Promise<boolean> {
      const r = await k
        .selectFrom('friends')
        .select('status')
        .where('status', '=', 'accepted')
        .where((eb) =>
          eb.or([
            eb.and([eb('a_id', '=', a), eb('b_id', '=', b)]),
            eb.and([eb('a_id', '=', b), eb('b_id', '=', a)]),
          ]),
        )
        .executeTakeFirst();
      return r !== undefined;
    },

    /** Friend ids (accepted only), for chat rules (R-SEC-011). */
    async friendIds(playerId: string): Promise<string[]> {
      const list = await k
        .selectFrom('friends')
        .select(['a_id', 'b_id'])
        .where('status', '=', 'accepted')
        .where((eb) => eb.or([eb('a_id', '=', playerId), eb('b_id', '=', playerId)]))
        .execute();
      return list.map((f) => (f.a_id === playerId ? f.b_id : f.a_id)).sort();
    },

    async friends(playerId: string): Promise<FriendView[]> {
      const sent = await k
        .selectFrom('friends')
        .innerJoin('players', 'players.id', 'friends.b_id')
        .select(['friends.status', 'players.id', 'players.display_name', 'players.presence_zone'])
        .where('friends.a_id', '=', playerId)
        .execute();
      const received = await k
        .selectFrom('friends')
        .innerJoin('players', 'players.id', 'friends.a_id')
        .select(['friends.status', 'players.id', 'players.display_name', 'players.presence_zone'])
        .where('friends.b_id', '=', playerId)
        .execute();
      const view = (r: (typeof sent)[number], mine: boolean): FriendView => ({
        id: r.id,
        name: r.display_name,
        status: r.status === 'accepted' ? 'friends' : mine ? 'outgoing' : 'incoming',
        zone: r.status === 'accepted' ? r.presence_zone : null,
      });
      return [...sent.map((r) => view(r, true)), ...received.map((r) => view(r, false))].sort(
        (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1),
      );
    },

    party,
    partyOf,

    /** Create a party led by `leader` (who must not be in one). */
    async createParty(leader: string, now: number = ctx.now()): Promise<Party> {
      const id = uuidv7(now);
      await ctx.atomic([
        k
          .insertInto('parties')
          .values({ id, leader_id: leader, size: 1, created_at: now })
          .compile(),
        k
          .insertInto('party_members')
          .values({ player_id: leader, party_id: id, joined_at: now })
          .compile(),
      ]);
      return (await party(id)) as Party;
    },

    /**
     * Join a party if it has room and the player is in none; false otherwise. Race-safe: the size
     * increment and the member insert are one atomic list, and CHECK (size <= 4) or the one-party
     * primary key rolls both back (DD-15).
     */
    async joinParty(partyId: string, playerId: string, now: number = ctx.now()): Promise<boolean> {
      try {
        const [bumped] = await ctx.atomic([
          k
            .updateTable('parties')
            .set((eb) => ({ size: eb('size', '+', 1) }))
            .where('id', '=', partyId)
            .compile(),
          k
            .insertInto('party_members')
            .values({ player_id: playerId, party_id: partyId, joined_at: now })
            .compile(),
        ]);
        return bumped === 1;
      } catch {
        return false;
      }
    },

    /** Leave the party; a leaving leader hands over to the next member; an empty party is removed. */
    async leaveParty(playerId: string): Promise<void> {
      const p = await partyOf(playerId);
      if (!p) return;
      const rest = p.members.filter((m) => m.playerId !== playerId);
      const statements = [
        k.deleteFrom('party_members').where('player_id', '=', playerId).compile(),
        k
          .updateTable('parties')
          .set((eb) => ({ size: eb('size', '-', 1) }))
          .where('id', '=', p.id)
          .compile(),
      ];
      if (rest.length === 0)
        statements.push(k.deleteFrom('parties').where('id', '=', p.id).compile());
      else if (p.leaderId === playerId)
        statements.push(
          k
            .updateTable('parties')
            .set({ leader_id: rest[0]?.playerId ?? playerId })
            .where('id', '=', p.id)
            .compile(),
        );
      await ctx.atomic(statements);
    },
  };
}

export type SocialRepo = ReturnType<typeof socialRepo>;
