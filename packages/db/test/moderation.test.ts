/**
 * Report, mute and block, suspensions, chat bans, player lookup and guild invitation expiry on every
 * engine (M6 6.4; spec 15 R-SEC-011, R-SEC-006, R-SEC-010; 10.4 R-WORLD-004).
 */
import { describe, expect, it } from 'vitest';
import type { Db, Player } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function players(db: Db, n: number, prefix = 'P'): Promise<Player[]> {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await makePlayer(db, undefined, `${prefix}${i}`));
  return out;
}

describe.each(ENGINES)('moderation on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-011 a report is filed with its reason, note and chat context, and queued oldest first', async () => {
        const [a, b, c] = await players(db(), 3);
        const r1 = await db().moderation.fileReport({
          reporterId: a!.id,
          targetId: b!.id,
          reason: 'harassment',
          note: '  said mean things  ',
          context: { chat: { text: 'you are bad', ch: 'zone' } },
          perDay: 10,
          now: T0,
        });
        expect(r1.status).toBe('filed');
        const r2 = await db().moderation.fileReport({
          reporterId: c!.id,
          targetId: b!.id,
          reason: 'cheating',
          context: { battleId: 'battle-1' },
          perDay: 10,
          now: T0 - 5,
        });
        expect(r2.status).toBe('filed');
        const queue = await db().moderation.openReports();
        expect(queue.map((r) => r.reason)).toEqual(['cheating', 'harassment']);
        expect(queue[1]).toMatchObject({
          reporterId: a!.id,
          reporterName: 'P0',
          targetId: b!.id,
          targetName: 'P1',
          note: 'said mean things',
          context: { chat: { text: 'you are bad', ch: 'zone' } },
          status: 'open',
          createdAt: T0,
        });
        expect(await db().moderation.reportCounts(b!.id)).toEqual({ total: 2, open: 2 });
        expect(await db().moderation.countOpen()).toBe(2);
        await expect(
          db().moderation.fileReport({
            reporterId: a!.id,
            targetId: a!.id,
            reason: 'spam',
            perDay: 10,
          }),
        ).rejects.toThrow(RangeError);
        expect(
          await db().moderation.fileReport({
            reporterId: a!.id,
            targetId: 'nobody',
            reason: 'spam',
            perDay: 10,
          }),
        ).toEqual({ status: 'no_player' });
      });

      it('R-SEC-011 a reporter may file at most perDay reports per rolling 24 hours', async () => {
        const [a, b] = await players(db(), 2);
        const file = (now: number) =>
          db().moderation.fileReport({
            reporterId: a!.id,
            targetId: b!.id,
            reason: 'spam',
            perDay: 3,
            now,
          });
        for (let i = 0; i < 3; i++) expect((await file(T0 + i)).status).toBe('filed');
        expect(await file(T0 + 10)).toEqual({ status: 'rate_limited' });
        // A day after the first one, a slot is free again.
        expect((await file(T0 + DAY + 1)).status).toBe('filed');
        expect(await db().moderation.countFiledSince(a!.id, T0 - 1)).toBe(4);
      });

      it('R-SEC-011 a report is closed once, as reviewed or dismissed, with the moderator and a note', async () => {
        const [a, b, mod] = await players(db(), 3);
        const f = await db().moderation.fileReport({
          reporterId: a!.id,
          targetId: b!.id,
          reason: 'hate',
          perDay: 10,
          now: T0,
        });
        if (f.status !== 'filed') throw new Error(f.status);
        const closed = await db().moderation.resolveReport(f.report.id, {
          status: 'reviewed',
          by: mod!.id,
          note: 'chat ban 24 h',
          now: T0 + 5,
        });
        expect(closed).toMatchObject({
          status: 'reviewed',
          resolvedAt: T0 + 5,
          resolvedBy: mod!.id,
          resolvedByName: 'P2',
          resolutionNote: 'chat ban 24 h',
        });
        expect(
          await db().moderation.resolveReport(f.report.id, { status: 'dismissed', by: mod!.id }),
        ).toBeNull();
        expect(await db().moderation.openReports()).toEqual([]);
        expect((await db().moderation.reportsAbout(b!.id)).map((r) => r.status)).toEqual([
          'reviewed',
        ]);
        expect(await db().moderation.reportCounts(b!.id)).toEqual({ total: 1, open: 0 });
      });

      it('R-SEC-011 mutes are private lists with a cap', async () => {
        const [a, b, c, d] = await players(db(), 4);
        expect(await db().safety.mute(a!.id, b!.id, 2, T0)).toBe('added');
        expect(await db().safety.mute(a!.id, b!.id, 2, T0)).toBe('exists');
        expect(await db().safety.mute(a!.id, c!.id, 2, T0 + 1)).toBe('added');
        expect(await db().safety.mute(a!.id, d!.id, 2, T0 + 2)).toBe('limit');
        expect(await db().safety.mute(a!.id, 'nobody', 2)).toBe('no_player');
        await expect(db().safety.mute(a!.id, a!.id, 2)).rejects.toThrow(RangeError);
        expect(await db().safety.mutes(a!.id)).toEqual([
          { id: b!.id, name: 'P1', at: T0 },
          { id: c!.id, name: 'P2', at: T0 + 1 },
        ]);
        expect(await db().safety.mutedIds(a!.id)).toEqual([b!.id, c!.id].sort());
        expect(await db().safety.mutedIds(b!.id)).toEqual([]);
        expect(await db().safety.unmute(a!.id, b!.id)).toBe(true);
        expect(await db().safety.unmute(a!.id, b!.id)).toBe(false);
        expect(await db().safety.mutedIds(a!.id)).toEqual([c!.id]);
      });

      it('R-SEC-011 R-WORLD-004 blocking removes the friendship and pending requests both ways', async () => {
        const [a, b, c, d] = await players(db(), 4);
        expect(await db().social.requestFriend(a!.id, b!.id, T0)).toBe('requested');
        expect(await db().social.requestFriend(b!.id, a!.id, T0)).toBe('friends');
        expect(await db().social.requestFriend(c!.id, a!.id, T0)).toBe('requested');
        expect(await db().social.requestFriend(a!.id, d!.id, T0)).toBe('requested');
        expect(await db().safety.block(a!.id, b!.id, 10, T0)).toBe('added');
        expect(await db().safety.block(a!.id, c!.id, 10, T0 + 1)).toBe('added');
        expect(await db().safety.block(a!.id, c!.id, 10, T0 + 1)).toBe('exists');
        expect(await db().social.areFriends(a!.id, b!.id)).toBe(false);
        // Only the blocked pairs lose their rows; the request to D stays.
        expect((await db().social.friends(a!.id)).map((f) => [f.name, f.status])).toEqual([
          ['P3', 'outgoing'],
        ]);
        expect(await db().safety.blockedEither(a!.id, b!.id)).toBe(true);
        expect(await db().safety.blockedEither(b!.id, a!.id)).toBe(true);
        expect(await db().safety.blockedEither(b!.id, c!.id)).toBe(false);
        expect([...(await db().safety.blockedAmong(b!.id, [a!.id, c!.id, d!.id]))]).toEqual([
          a!.id,
        ]);
        expect([...(await db().safety.blockedAmong(a!.id, [b!.id, c!.id, d!.id]))].sort()).toEqual(
          [b!.id, c!.id].sort(),
        );
        expect((await db().safety.blocks(a!.id)).map((x) => x.name)).toEqual(['P1', 'P2']);
        expect(await db().safety.blockedIds(b!.id)).toEqual([]);
        expect(await db().safety.block(b!.id, d!.id, 0)).toBe('limit');
        expect(await db().safety.unblock(a!.id, b!.id)).toBe(true);
        expect(await db().safety.blockedEither(a!.id, b!.id)).toBe(false);
      });

      it('R-SEC-006 a suspension revokes every session; lifting it and chat bans are stored', async () => {
        const [a, b] = await players(db(), 2);
        const s1 = await db().sessions.create(a!.id, { ttlMs: DAY, now: T0 });
        await db().sessions.create(a!.id, { ttlMs: DAY, now: T0 });
        const other = await db().sessions.create(b!.id, { ttlMs: DAY, now: T0 });
        expect(await db().moderation.suspend(a!.id, T0 + DAY, T0 + 1)).toBe(true);
        expect(await db().sessions.getValid(s1.token, T0 + 2)).toBeNull();
        expect(await db().sessions.getValid(other.token, T0 + 2)).not.toBeNull();
        expect(await db().players.getById(a!.id)).toMatchObject({
          suspendedAt: T0 + 1,
          suspendedUntil: T0 + DAY,
          chatBanUntil: null,
        });
        expect(await db().moderation.suspend(a!.id, null, T0 + 3)).toBe(true);
        expect(await db().players.getById(a!.id)).toMatchObject({
          suspendedAt: T0 + 3,
          suspendedUntil: null,
        });
        expect(await db().moderation.liftSuspension(a!.id)).toBe(true);
        expect(await db().players.getById(a!.id)).toMatchObject({
          suspendedAt: null,
          suspendedUntil: null,
        });
        expect(await db().moderation.setChatBan(b!.id, T0 + HOUR)).toBe(true);
        expect((await db().players.getById(b!.id))?.chatBanUntil).toBe(T0 + HOUR);
        expect(await db().moderation.setChatBan(b!.id, null)).toBe(true);
        expect((await db().players.getById(b!.id))?.chatBanUntil).toBeNull();
        expect(await db().moderation.suspend('nobody', null)).toBe(false);
      });

      it('R-SEC-011 lookup finds players by id, exact email or display name prefix', async () => {
        const d = db();
        const a = await makePlayer(d, 'Alice.Smith@Example.com', 'Alice');
        const b = await makePlayer(d, 'alfred@example.com', 'Alfred');
        await makePlayer(d, 'bob@example.com', 'Bob_1');
        await makePlayer(d, 'bob2@example.com', 'Bobby');
        expect(
          (await d.moderation.findPlayers('alice.smith@example.com')).map((p) => p.id),
        ).toEqual([a.id]);
        expect((await d.moderation.findPlayers(b.id)).map((p) => p.displayName)).toEqual([
          'Alfred',
        ]);
        expect((await d.moderation.findPlayers('AL')).map((p) => p.displayName)).toEqual([
          'Alfred',
          'Alice',
        ]);
        expect((await d.moderation.findPlayers('alice')).map((p) => p.displayName)).toEqual([
          'Alice',
        ]);
        // LIKE wildcards in the query are literal.
        expect((await d.moderation.findPlayers('Bob_')).map((p) => p.displayName)).toEqual([
          'Bob_1',
        ]);
        expect(await d.moderation.findPlayers('%')).toEqual([]);
        expect(await d.moderation.findPlayers('  ')).toEqual([]);
      });

      it('R-WORLD-004 guild invitations expire after the TTL and can be sent again', async () => {
        const [lead, x] = await players(db(), 2);
        const r = await db().guilds.create({
          name: 'Expiry',
          tag: 'EX',
          leaderId: lead!.id,
          maxSize: 10,
          now: T0,
        });
        if (r.status !== 'created') throw new Error(r.status);
        const ttl = 7 * DAY;
        expect(await db().guilds.invite(r.guild.id, lead!.id, x!.id, T0, ttl)).toBe('invited');
        expect(await db().guilds.invitesFor(x!.id, T0 + ttl - 1 - ttl)).toHaveLength(1);
        // Expired: hidden from both lists, and accepting it fails.
        const later = T0 + ttl + 1;
        expect(await db().guilds.invitesFor(x!.id, later - ttl)).toEqual([]);
        expect(await db().guilds.invitesOf(r.guild.id, later - ttl)).toEqual([]);
        expect(await db().guilds.accept(r.guild.id, x!.id, later, later - ttl)).toBe('no_invite');
        // A new invitation replaces the expired one.
        expect(await db().guilds.invite(r.guild.id, lead!.id, x!.id, later, ttl)).toBe('invited');
        expect(await db().guilds.invitesFor(x!.id, later - ttl)).toHaveLength(1);
        expect(await db().guilds.accept(r.guild.id, x!.id, later + 1, later + 1 - ttl)).toBe(
          'joined',
        );
        await db().guilds.invite(r.guild.id, lead!.id, (await makePlayer(db())).id, T0, ttl);
        expect(await db().guilds.deleteExpiredInvites(T0)).toBe(1);
      });

      it('R-SEC-010 export includes own mutes, blocks and reports; deletion removes or anonymizes them', async () => {
        const d = db();
        const [p, other, mod] = await players(d, 3);
        await d.safety.mute(p!.id, other!.id, 10, T0);
        await d.safety.block(p!.id, other!.id, 10, T0 + 1);
        await d.safety.mute(other!.id, p!.id, 10, T0 + 2);
        await d.safety.block(other!.id, p!.id, 10, T0 + 3);
        const mine = await d.moderation.fileReport({
          reporterId: p!.id,
          targetId: other!.id,
          reason: 'spam',
          note: 'ads',
          context: { tradeId: 't-1' },
          perDay: 10,
          now: T0,
        });
        const about = await d.moderation.fileReport({
          reporterId: other!.id,
          targetId: p!.id,
          reason: 'inappropriate_name',
          note: 'secret note by the reporter',
          perDay: 10,
          now: T0 + 1,
        });
        if (mine.status !== 'filed' || about.status !== 'filed') throw new Error('not filed');
        // p also closed a report as a moderator.
        const third = await d.moderation.fileReport({
          reporterId: other!.id,
          targetId: mod!.id,
          reason: 'other',
          perDay: 10,
          now: T0 + 2,
        });
        if (third.status !== 'filed') throw new Error('not filed');
        await d.moderation.resolveReport(third.report.id, { status: 'dismissed', by: p!.id });

        const ex = await d.players.exportData(p!.id, T0 + 10);
        expect(ex!.mutes).toEqual([{ targetId: other!.id, createdAt: T0 }]);
        expect(ex!.blocks).toEqual([{ targetId: other!.id, createdAt: T0 + 1 }]);
        expect(ex!.reportsFiled).toEqual([
          {
            id: mine.report.id,
            targetId: other!.id,
            reason: 'spam',
            note: 'ads',
            context: { tradeId: 't-1' },
            status: 'open',
            createdAt: T0,
            resolvedAt: null,
          },
        ]);
        // The reported player learns the reason and status, never the reporter or the note.
        expect(ex!.reportsAbout).toEqual([
          { id: about.report.id, reason: 'inappropriate_name', status: 'open', createdAt: T0 + 1 },
        ]);
        expect(JSON.stringify(ex)).not.toContain('secret note');
        expect(JSON.stringify(ex!.reportsAbout)).not.toContain(other!.id);
        expect(ex!.player).toMatchObject({ suspendedAt: null, chatBanUntil: null });

        expect(await d.players.delete(p!.id)).toBe(true);
        const k = d.kysely;
        const left = async (t: 'mutes' | 'blocks') =>
          (
            await k
              .selectFrom(t)
              .select('player_id')
              .where((eb) => eb.or([eb('player_id', '=', p!.id), eb('target_id', '=', p!.id)]))
              .execute()
          ).length;
        expect(await left('mutes')).toBe(0);
        expect(await left('blocks')).toBe(0);
        // The report p filed stays, anonymized; the one about p is gone; p's resolution stays.
        expect(await d.moderation.getReport(mine.report.id)).toMatchObject({
          reporterId: null,
          targetId: other!.id,
        });
        expect(await d.moderation.getReport(about.report.id)).toBeNull();
        expect(await d.moderation.getReport(third.report.id)).toMatchObject({
          status: 'dismissed',
          resolvedBy: null,
        });
      });
    },
  );
});
