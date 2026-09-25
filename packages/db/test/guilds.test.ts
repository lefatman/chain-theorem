/**
 * Guilds on every engine (M6 6.1, spec 10.4 R-WORLD-004): unique names and tags, invitations, the
 * member cap and one guild per player under concurrency (DD-15), ranks with one leader, leaving with
 * a hand-over, kicks, disbanding, the roster version, the guild leaderboard, and account deletion
 * (R-SEC-010).
 */
import { describe, expect, it } from 'vitest';
import type { Db, Player } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);

async function players(db: Db, n: number): Promise<Player[]> {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await makePlayer(db, undefined, `P${i}`));
  return out;
}

async function found(db: Db, leaderId: string, name = 'Rook Riders', tag = 'rr', maxSize = 50) {
  const r = await db.guilds.create({ name, tag, leaderId, maxSize, now: T0 });
  if (r.status !== 'created') throw new Error(r.status);
  return r.guild;
}

async function join(db: Db, guildId: string, actor: string, target: string) {
  expect(await db.guilds.invite(guildId, actor, target, T0)).toBe('invited');
  expect(await db.guilds.accept(guildId, target, T0 + 1)).toBe('joined');
}

const ranks = async (db: Db, guildId: string) =>
  (await db.guilds.members(guildId)).map((m) => [m.name, m.rank]);

describe.each(ENGINES)('guilds on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-WORLD-004 names are unique regardless of case, tags are upper case and unique', async () => {
        const [a, b, c] = await players(db(), 3);
        const g = await found(db(), a!.id, '  Rook   Riders ', 'rr');
        expect(g).toMatchObject({ name: 'Rook Riders', tag: 'RR', size: 1, maxSize: 50 });
        expect(await db().guilds.membership(a!.id)).toEqual({ guildId: g.id, rank: 'leader' });
        const same = await db().guilds.create({
          name: 'rook riders',
          tag: 'XY',
          leaderId: b!.id,
          maxSize: 50,
        });
        expect(same.status).toBe('name_taken');
        const tag = await db().guilds.create({
          name: 'Other',
          tag: 'Rr',
          leaderId: b!.id,
          maxSize: 50,
        });
        expect(tag.status).toBe('tag_taken');
        const twice = await db().guilds.create({
          name: 'Second',
          tag: 'SC',
          leaderId: a!.id,
          maxSize: 50,
        });
        expect(twice.status).toBe('in_guild');
        expect(
          (await db().guilds.create({ name: 'Third', tag: 'TH', leaderId: c!.id, maxSize: 5 }))
            .status,
        ).toBe('created');
        expect((await db().guilds.getByTag('rr'))?.id).toBe(g.id);
      });

      it('R-WORLD-004 invitations: leader and officers invite, members do not; accepting joins once', async () => {
        const [lead, off, mem, x, y] = await players(db(), 5);
        const g = await found(db(), lead!.id);
        await join(db(), g.id, lead!.id, off!.id);
        await join(db(), g.id, lead!.id, mem!.id);
        expect(await db().guilds.setRank(g.id, lead!.id, off!.id, 'officer')).toBe('ok');
        expect(await db().guilds.invite(g.id, mem!.id, x!.id)).toBe('not_allowed');
        expect(await db().guilds.invite(g.id, off!.id, x!.id)).toBe('invited');
        expect(await db().guilds.invite(g.id, lead!.id, x!.id)).toBe('already_invited');
        expect(await db().guilds.invite(g.id, lead!.id, mem!.id)).toBe('in_guild');
        const inv = await db().guilds.invitesFor(x!.id);
        expect(inv).toHaveLength(1);
        expect(inv[0]).toMatchObject({ guildId: g.id, guildTag: 'RR', invitedByName: 'P1' });
        expect((await db().guilds.invitesOf(g.id)).map((i) => i.playerName)).toEqual(['P3']);
        // Without an invitation nobody joins; declining removes it.
        expect(await db().guilds.accept(g.id, y!.id)).toBe('no_invite');
        expect(await db().guilds.accept(g.id, x!.id)).toBe('joined');
        expect(await db().guilds.invitesFor(x!.id)).toEqual([]);
        expect((await db().guilds.get(g.id))?.size).toBe(4);
        expect(await db().guilds.invite(g.id, lead!.id, y!.id)).toBe('invited');
        expect(await db().guilds.deleteInvite(g.id, y!.id)).toBe(true);
        expect(await db().guilds.accept(g.id, y!.id)).toBe('no_invite');
      });

      it('R-WORLD-004 one guild per player: a second acceptance fails and leaves no trace', async () => {
        const [a, b, x] = await players(db(), 3);
        const g1 = await found(db(), a!.id, 'First', 'ONE');
        const g2 = await found(db(), b!.id, 'Second', 'TWO');
        expect(await db().guilds.invite(g1.id, a!.id, x!.id)).toBe('invited');
        expect(await db().guilds.invite(g2.id, b!.id, x!.id)).toBe('invited');
        expect(await db().guilds.accept(g1.id, x!.id)).toBe('joined');
        // Joining removed the other invitation too.
        expect(await db().guilds.accept(g2.id, x!.id)).toBe('no_invite');
        expect((await db().guilds.get(g2.id))?.size).toBe(1);
        expect(await db().guilds.guildIdOf(x!.id)).toBe(g1.id);
      });

      it('R-WORLD-004 the member cap holds under concurrent acceptances (DD-15)', async () => {
        const [lead, ...rest] = await players(db(), 6);
        const g = await found(db(), lead!.id, 'Small', 'SM', 3);
        for (const p of rest)
          expect(await db().guilds.invite(g.id, lead!.id, p.id)).toBe('invited');
        const results = await Promise.all(rest.map((p) => db().guilds.accept(g.id, p.id)));
        expect(results.filter((r) => r === 'joined')).toHaveLength(2);
        expect(results.filter((r) => r === 'full')).toHaveLength(3);
        const after = await db().guilds.get(g.id);
        expect(after?.size).toBe(3);
        expect(await db().guilds.members(g.id)).toHaveLength(3);
        // A full guild cannot invite anyone else.
        expect(await db().guilds.invite(g.id, lead!.id, rest[4]!.id)).toBe('full');
      });

      it('R-WORLD-004 ranks: only the leader promotes, demotes and hands over; one leader at a time', async () => {
        const [lead, a, b] = await players(db(), 3);
        const g = await found(db(), lead!.id);
        await join(db(), g.id, lead!.id, a!.id);
        await join(db(), g.id, lead!.id, b!.id);
        const v0 = (await db().guilds.rosterVersion(g.id)) ?? 0;
        expect(await db().guilds.setRank(g.id, a!.id, b!.id, 'officer')).toBe('not_allowed');
        expect(await db().guilds.setRank(g.id, lead!.id, a!.id, 'officer')).toBe('ok');
        expect(await db().guilds.setRank(g.id, lead!.id, a!.id, 'officer')).toBe('not_allowed');
        expect(await db().guilds.setRank(g.id, a!.id, b!.id, 'officer')).toBe('not_allowed');
        expect(await ranks(db(), g.id)).toEqual([
          ['P0', 'leader'],
          ['P1', 'officer'],
          ['P2', 'member'],
        ]);
        expect(await db().guilds.setRank(g.id, lead!.id, a!.id, 'member')).toBe('ok');
        // Hand-over: the target becomes leader and the old leader an officer.
        expect(await db().guilds.setRank(g.id, a!.id, b!.id, 'leader')).toBe('not_allowed');
        expect(await db().guilds.setRank(g.id, lead!.id, b!.id, 'leader')).toBe('ok');
        expect(await ranks(db(), g.id)).toEqual([
          ['P2', 'leader'],
          ['P0', 'officer'],
          ['P1', 'member'],
        ]);
        expect(await db().guilds.setRank(g.id, lead!.id, a!.id, 'leader')).toBe('not_allowed');
        const leaders = (await db().guilds.members(g.id)).filter((m) => m.rank === 'leader');
        expect(leaders).toHaveLength(1);
        expect((await db().guilds.rosterVersion(g.id)) ?? 0).toBeGreaterThan(v0 + 3);
      });

      it('R-WORLD-004 kicks: the leader removes anyone, an officer removes members only', async () => {
        const [lead, off, m1, m2] = await players(db(), 4);
        const g = await found(db(), lead!.id);
        for (const p of [off, m1, m2]) await join(db(), g.id, lead!.id, p!.id);
        await db().guilds.setRank(g.id, lead!.id, off!.id, 'officer');
        expect(await db().guilds.kick(g.id, m1!.id, m2!.id)).toBe('not_allowed');
        expect(await db().guilds.kick(g.id, off!.id, lead!.id)).toBe('not_allowed');
        expect(await db().guilds.kick(g.id, off!.id, m1!.id)).toBe('ok');
        expect(await db().guilds.kick(g.id, lead!.id, off!.id)).toBe('ok');
        expect(await db().guilds.kick(g.id, lead!.id, lead!.id)).toBe('not_allowed');
        expect((await db().guilds.members(g.id)).map((m) => m.name)).toEqual(['P0', 'P3']);
        expect((await db().guilds.get(g.id))?.size).toBe(2);
      });

      it('R-WORLD-004 a leaving leader hands over to the longest-serving officer; the last one out removes the guild', async () => {
        const [lead, m1, off, x] = await players(db(), 4);
        const g = await found(db(), lead!.id);
        await join(db(), g.id, lead!.id, m1!.id);
        await join(db(), g.id, lead!.id, off!.id);
        await db().guilds.setRank(g.id, lead!.id, off!.id, 'officer');
        expect(await db().guilds.invite(g.id, lead!.id, x!.id)).toBe('invited');
        expect(await db().guilds.leave(g.id, lead!.id)).toBe('left');
        expect(await ranks(db(), g.id)).toEqual([
          ['P2', 'leader'],
          ['P1', 'member'],
        ]);
        expect(await db().guilds.leave(g.id, lead!.id)).toBe('not_member');
        expect(await db().guilds.leave(g.id, off!.id)).toBe('left');
        expect(await ranks(db(), g.id)).toEqual([['P1', 'leader']]);
        expect(await db().guilds.leave(g.id, m1!.id)).toBe('disbanded');
        expect(await db().guilds.get(g.id)).toBeNull();
        expect(await db().guilds.invitesFor(x!.id)).toEqual([]);
        // The name is free again.
        expect(
          (
            await db().guilds.create({
              name: 'rook riders',
              tag: 'RR',
              leaderId: x!.id,
              maxSize: 5,
            })
          ).status,
        ).toBe('created');
      });

      it('R-WORLD-004 only the leader disbands; members and invitations go with the guild', async () => {
        const [lead, off, x] = await players(db(), 3);
        const g = await found(db(), lead!.id);
        await join(db(), g.id, lead!.id, off!.id);
        await db().guilds.setRank(g.id, lead!.id, off!.id, 'officer');
        await db().guilds.invite(g.id, off!.id, x!.id);
        expect(await db().guilds.disband(g.id, off!.id)).toBe('not_allowed');
        expect(await db().guilds.members(g.id)).toHaveLength(2);
        expect(await db().guilds.disband(g.id, lead!.id)).toBe('ok');
        expect(await db().guilds.get(g.id)).toBeNull();
        expect(await db().guilds.guildIdOf(off!.id)).toBeNull();
        expect(await db().guilds.invitesFor(x!.id)).toEqual([]);
      });

      it('R-WORLD-004 the guild leaderboard averages the best listed members per format and bracket', async () => {
        const ps = await players(db(), 6);
        const g1 = await found(db(), ps[0]!.id, 'Alpha', 'AL');
        const g2 = await found(db(), ps[3]!.id, 'Beta', 'BE');
        await join(db(), g1.id, ps[0]!.id, ps[1]!.id);
        await join(db(), g1.id, ps[0]!.id, ps[2]!.id);
        await join(db(), g2.id, ps[3]!.id, ps[4]!.id);
        const rate = (i: number, rating: number, rd = 80, games = 10) =>
          db().ratings.upsert({
            playerId: ps[i]!.id,
            format: 'full',
            bracket: '1-2',
            rating,
            rd,
            volatility: 0.06,
            games,
          });
        await rate(0, 1700);
        await rate(1, 1600);
        await rate(2, 2400, 300); // too uncertain: not listed, not counted
        await rate(3, 1500);
        await rate(4, 1640);
        await rate(5, 1900); // no guild
        const opts = { top: 5, minRated: 2, maxRd: 200, minGames: 5, limit: 10 };
        const board = await db().guilds.board('full', '1-2', opts);
        expect(board.map((r) => [r.tag, Math.round(r.score), r.rated])).toEqual([
          ['AL', 1650, 2],
          ['BE', 1570, 2],
        ]);
        expect(await db().guilds.board('full', '1-2', { ...opts, top: 1 })).toHaveLength(0);
        expect(
          (await db().guilds.board('full', '1-2', { ...opts, top: 1, minRated: 1 }))[0]?.tag,
        ).toBe('AL');
        expect(await db().guilds.board('vanguard', '1-2', opts)).toEqual([]);
      });

      it('R-SEC-010 deleting a leader hands the guild over and removes invitations, exported first', async () => {
        const [lead, m, x, y, w] = await players(db(), 5);
        const g = await found(db(), lead!.id);
        await join(db(), g.id, lead!.id, m!.id);
        expect(await db().guilds.invite(g.id, lead!.id, x!.id, T0 + 5)).toBe('invited');
        const other = await found(db(), y!.id, 'Other', 'OT');
        expect(await db().guilds.invite(other.id, y!.id, w!.id, T0 + 6)).toBe('invited');
        expect(await db().guilds.invite(g.id, lead!.id, w!.id, T0 + 7)).toBe('invited');
        const exported = await db().players.exportData(lead!.id);
        expect(exported?.guildInvites.map((i) => [i.guildId, i.playerId])).toEqual([
          [g.id, x!.id],
          [g.id, w!.id],
        ]);
        const invited = await db().players.exportData(w!.id);
        expect(invited?.guildInvites.map((i) => i.invitedBy)).toEqual([y!.id, lead!.id]);
        expect(await db().players.delete(lead!.id)).toBe(true);
        expect(await ranks(db(), g.id)).toEqual([['P1', 'leader']]);
        expect(await db().guilds.get(g.id)).toMatchObject({ size: 1, founderId: null });
        const inv = await db().guilds.invitesOf(g.id);
        expect(inv.map((i) => [i.playerId, i.invitedBy])).toEqual([
          [x!.id, null],
          [w!.id, null],
        ]);
        // An invitee's deletion removes the invitations to it.
        expect(await db().players.delete(w!.id)).toBe(true);
        expect(await db().guilds.invitesOf(other.id)).toEqual([]);
        expect((await db().guilds.invitesOf(g.id)).map((i) => i.playerId)).toEqual([x!.id]);
        // A sole member's deletion removes the guild.
        expect(await db().players.delete(y!.id)).toBe(true);
        expect(await db().guilds.get(other.id)).toBeNull();
      });
    },
  );
});
