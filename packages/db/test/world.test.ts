/** Overworld progress, friends and parties on every engine (M5; R-SEC-003, R-SEC-004, R-SEC-010, R-WORLD-004). */
import { describe, expect, it } from 'vitest';
import { ENGINES, makePlayer, useDb } from './engines.ts';

describe.each(ENGINES)('world and social on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-003 a reward grants coins, key items and flags once, atomically', async () => {
        const p = await makePlayer(db());
        const input = {
          key: 'quest:academy:3',
          playerId: p.id,
          xp: 50,
          coins: 30,
          keyItems: ['calm_bell'],
          flags: ['lesson:knight'],
        };
        expect((await db().rewards.grant(input)).status).toBe('granted');
        expect((await db().rewards.grant(input)).status).toBe('duplicate');
        expect(await db().world.coins(p.id)).toBe(30);
        expect(await db().world.keyItems(p.id)).toEqual(['calm_bell']);
        expect(await db().world.flags(p.id)).toEqual(['lesson:knight']);
        expect((await db().players.getById(p.id))?.xp).toBe(50);
      });

      it('R-SEC-004 coins never go negative', async () => {
        const p = await makePlayer(db());
        await db().atomic([db().world.addCoinsStatement(p.id, 10)]);
        const spends = await Promise.all([1, 2, 3].map(() => db().world.spendCoins(p.id, 4)));
        expect(spends.filter(Boolean)).toHaveLength(2);
        expect(await db().world.coins(p.id)).toBe(2);
      });

      it('R-WORLD-005 quest progress, flags, positions, presence and the chat preference round-trip', async () => {
        const p = await makePlayer(db());
        await db().world.setQuest(p.id, 'academy', 2, { wins: 1 }, 5);
        await db().world.setQuest(p.id, 'academy', 3, { wins: 2 }, 6);
        expect(await db().world.quests(p.id)).toEqual([
          { questId: 'academy', step: 3, data: { wins: 2 }, updatedAt: 6 },
        ]);
        await db().world.setFlag(p.id, 'npc:rival');
        await db().world.setFlag(p.id, 'npc:rival');
        expect(await db().world.flags(p.id)).toEqual(['npc:rival']);
        await db().world.setPosition(p.id, 'route1', 4, 9);
        expect(await db().players.getById(p.id)).toMatchObject({
          zoneId: 'route1',
          tileX: 4,
          tileY: 9,
        });
        expect(await db().world.presence(p.id)).toBeNull();
        await db().world.setPresence(p.id, 'academy', 1);
        expect(await db().world.presence(p.id)).toEqual({ zone: 'academy', channel: 1 });
        expect(await db().world.filterChat(p.id)).toBe(false);
        await db().world.setFilterChat(p.id, true);
        expect(await db().world.filterChat(p.id)).toBe(true);
      });

      it('R-WORLD-004 friend requests become friendships when both ask; presence shows only for friends', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        expect(await db().social.requestFriend(a.id, b.id)).toBe('requested');
        expect((await db().social.friends(b.id)).map((f) => f.status)).toEqual(['incoming']);
        expect(await db().social.areFriends(a.id, b.id)).toBe(false);
        await db().world.setPresence(b.id, 'route1', 0);
        expect((await db().social.friends(a.id))[0]).toMatchObject({
          status: 'outgoing',
          zone: null,
        });
        expect(await db().social.requestFriend(b.id, a.id)).toBe('friends');
        expect(await db().social.areFriends(a.id, b.id)).toBe(true);
        expect(await db().social.friendIds(a.id)).toEqual([b.id]);
        expect((await db().social.friends(a.id))[0]).toMatchObject({
          id: b.id,
          status: 'friends',
          zone: 'route1',
        });
        await db().social.removeFriend(b.id, a.id);
        expect(await db().social.friends(a.id)).toEqual([]);
      });

      it('R-WORLD-004 parties hold at most four, one party per player, and hand over leadership', async () => {
        const ps = await Promise.all([1, 2, 3, 4, 5].map(() => makePlayer(db())));
        const [lead, ...rest] = ps as [(typeof ps)[number], ...typeof ps];
        const party = await db().social.createParty(lead.id);
        const joins = await Promise.all(rest.map((p) => db().social.joinParty(party.id, p.id)));
        expect(joins.filter(Boolean)).toHaveLength(3);
        const full = await db().social.party(party.id);
        expect(full?.members).toHaveLength(4);
        // The one who did not fit leads a party of their own; members of the first cannot join it.
        const outsider = rest.find((p) => !full?.members.some((m) => m.playerId === p.id));
        const other = await db().social.createParty(outsider?.id as string);
        expect(other.members).toHaveLength(1);
        const member = full?.members[1]?.playerId as string;
        expect(await db().social.joinParty(other.id, member)).toBe(false);
        await db().social.leaveParty(lead.id);
        const after = await db().social.party(party.id);
        expect(after?.members).toHaveLength(3);
        expect(after?.leaderId).toBe(member);
      });

      it('R-SEC-010 export includes and delete removes the new rows; a led party dissolves', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        await db().rewards.grant({
          key: 'k1',
          playerId: a.id,
          coins: 5,
          keyItems: ['calm_bell'],
          flags: ['lesson:pawn'],
        });
        const party = await db().social.createParty(a.id);
        await db().social.joinParty(party.id, b.id);
        const ex = await db().players.exportData(a.id);
        expect(ex).toMatchObject({
          coins: 5,
          keyItems: [{ keyId: 'calm_bell' }],
          progressFlags: [{ flag: 'lesson:pawn' }],
          partyId: party.id,
        });
        expect(await db().players.delete(a.id)).toBe(true);
        expect(await db().social.party(party.id)).toBeNull();
        expect(await db().social.partyOf(b.id)).toBeNull();
        expect(await db().world.coins(a.id)).toBe(0);
      });
    },
  );
});
