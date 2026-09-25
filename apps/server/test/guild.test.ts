/**
 * Guilds inside workerd (M6 6.1; `pnpm test:workers`): the REST contract (create, invite by name,
 * accept, ranks, kick, leave, disband), the GuildRoom roster cache, and guild chat on the zone socket
 * delivered to every online member through presence, filtered for everyone while any member is under
 * 18 and recomputed on every membership change (R-WORLD-004, R-SEC-011); account deletion hands a
 * guild over (R-SEC-010).
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { MyGuild, WorldTicket } from '@chain-theorem/protocol';
import { guildStub, type RosterInfo } from '../src/rooms/guild-room.ts';
import { basicChatFilter } from '../src/zone/index.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const open: Sock[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) s.ws.close(1000);
  await new Promise((r) => setTimeout(r, 50));
});

let n = 0;
const uniq = (base: string) => `${base}${++n}${String(Date.now()).slice(-5)}`;
/** A unique guild name: at most 6 digits in a row (7 would read as a phone number and be refused). */
const gname = (base: string) => `${base} ${++n}${String(Date.now()).slice(-4)}`;
const RUDE = 'well shit, visit www.example.com';
const CLEAN = basicChatFilter.clean(RUDE);

async function guildOf(cookie: string): Promise<MyGuild> {
  const r = await call<MyGuild>('GET', '/api/guilds/me', undefined, cookie);
  expect(r.status).toBe(200);
  return r.data;
}

async function enter(cookie: string): Promise<Sock> {
  const t = await call<WorldTicket>('POST', '/api/world/ticket', undefined, cookie);
  expect(t.status).toBe(200);
  const s = await openSocket(t.data.url);
  open.push(s);
  s.send('hello');
  await s.wait('zsnap');
  return s;
}

async function roster(guildId: string): Promise<RosterInfo> {
  const res = await guildStub(env, guildId).fetch(
    `https://guild/roster?g=${encodeURIComponent(guildId)}`,
  );
  return (await res.json()) as RosterInfo;
}

/** Say something in guild chat and wait for `who` to receive the next guild line. */
async function guildLine(from: Sock, who: Sock, text: string): Promise<Record<string, unknown>> {
  const mark = who.msgs.length;
  from.send('chat', { ch: 'guild', text });
  const until = Date.now() + 5000;
  for (;;) {
    const m = who.msgs.slice(mark).find((x) => x.t === 'chatmsg' && x.d.ch === 'guild');
    if (m) return m.d;
    if (Date.now() > until) throw new Error(`no guild line; got ${who.msgs.map((x) => x.t)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('guilds (M6 6.1)', () => {
  it('R-WORLD-004 create, invite by name, accept, promote, demote, kick, leave and disband', async () => {
    const leadName = uniq('Lead');
    const lead = await signUp(env, leadName);
    const offName = uniq('Offi');
    const off = await signUp(env, offName);
    const mem = await signUp(env, uniq('Memb'));
    const guildName = gname('Castle');
    const tag = `C${String(n).padStart(2, '0')}`.slice(0, 5);
    expect((await guildOf(lead.cookie)).guild).toBeNull();
    // Validation: empty, overlong and rude names are refused.
    for (const bad of [
      { name: '', tag: 'AB' },
      { name: 'x'.repeat(25), tag: 'AB' },
      { name: 'Good Name', tag: 'TOOLONG' },
      { name: 'shit club', tag: 'AB' },
    ]) {
      const r = await call<{ error: string }>('POST', '/api/guilds', bad, lead.cookie);
      expect(r.status).toBe(400);
    }
    const made = await call<MyGuild>(
      'POST',
      '/api/guilds',
      { name: `  ${guildName} `, tag: tag.toLowerCase() },
      lead.cookie,
    );
    expect(made.status).toBe(200);
    expect(made.data.rank).toBe('leader');
    expect(made.data.guild).toMatchObject({ name: guildName, tag, size: 1, maxMembers: 50 });
    const gid = made.data.guild!.id;
    const dup = await call<{ error: string }>(
      'POST',
      '/api/guilds',
      { name: guildName.toUpperCase(), tag: 'ZZZ' },
      off.cookie,
    );
    expect([dup.status, dup.data.error]).toEqual([409, 'name_taken']);

    // Invite by display name; the invitee sees it and accepts.
    const inv = await call<MyGuild>('POST', '/api/guilds/invites', { to: offName }, lead.cookie);
    expect(inv.status).toBe(200);
    expect(inv.data.guild?.invited.map((i) => i.name)).toEqual([offName]);
    const offView = await guildOf(off.cookie);
    expect(offView.invites).toEqual([
      expect.objectContaining({ guildId: gid, name: guildName, tag, from: leadName }),
    ]);
    const joined = await call<MyGuild>(
      'POST',
      `/api/guilds/invites/${gid}/accept`,
      undefined,
      off.cookie,
    );
    expect(joined.data).toMatchObject({ rank: 'member', invites: [] });
    // A member cannot invite; the leader promotes to officer, who then can.
    expect((await call('POST', '/api/guilds/invites', { to: mem.id }, off.cookie)).status).toBe(
      403,
    );
    const promoted = await call<MyGuild>(
      'PUT',
      `/api/guilds/members/${off.id}`,
      { rank: 'officer' },
      lead.cookie,
    );
    expect(promoted.data.guild?.members.map((m) => m.rank)).toEqual(['leader', 'officer']);
    expect((await call('POST', '/api/guilds/invites', { to: mem.id }, off.cookie)).status).toBe(
      200,
    );
    await call('POST', `/api/guilds/invites/${gid}/accept`, undefined, mem.cookie);
    expect((await guildOf(mem.cookie)).guild?.invited).toEqual([]);
    // Officers cannot promote; the officer kicks a member; the leader demotes the officer.
    expect(
      (await call('PUT', `/api/guilds/members/${mem.id}`, { rank: 'officer' }, off.cookie)).status,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/guilds/members/${mem.id}`, undefined, off.cookie)).status,
    ).toBe(200);
    expect((await guildOf(mem.cookie)).guild).toBeNull();
    await call('PUT', `/api/guilds/members/${off.id}`, { rank: 'member' }, lead.cookie);
    expect((await guildOf(off.cookie)).rank).toBe('member');
    // The roster cache follows (GuildRoom).
    expect((await roster(gid)).roster?.members.map((m) => [m.p, m.rank])).toEqual([
      [lead.id, 'leader'],
      [off.id, 'member'],
    ]);
    // Leaving, then disbanding.
    expect(
      (await call<MyGuild>('POST', '/api/guilds/leave', undefined, off.cookie)).data.guild,
    ).toBeNull();
    expect((await call('DELETE', `/api/guilds/${gid}`, undefined, off.cookie)).status).toBe(403);
    const gone = await call<MyGuild>('DELETE', `/api/guilds/${gid}`, undefined, lead.cookie);
    expect(gone.data.guild).toBeNull();
    expect((await roster(gid)).roster).toBeNull();
    expect((await call('GET', '/api/guilds/me')).status).toBe(401);
  });

  it('R-WORLD-004 R-SEC-011 guild chat reaches online members; any minor filters it for everyone, recomputed on membership change', async () => {
    const a = await signUp(env, uniq('Gca'));
    const b = await signUp(env, uniq('Gcb'));
    const kid = await signUp(env, uniq('Gck'), '2012-06-01');
    const out = await signUp(env, uniq('Gco'));
    const made = await call<MyGuild>(
      'POST',
      '/api/guilds',
      { name: gname('Chat Hall'), tag: `H${n}`.slice(0, 5) },
      a.cookie,
    );
    const gid = made.data.guild!.id;
    const sa = await enter(a.cookie);
    const sb = await enter(b.cookie);
    const so = await enter(out.cookie);
    // b joins while online: guild chat works at once (the zone learns the guild).
    await call('POST', '/api/guilds/invites', { to: b.id }, a.cookie);
    await call('POST', `/api/guilds/invites/${gid}/accept`, undefined, b.cookie);
    expect(await guildLine(sa, sb, RUDE)).toMatchObject({
      ch: 'guild',
      from: a.id,
      text: RUDE,
      filtered: false,
    });
    expect(await guildLine(sb, sa, 'hello guild')).toMatchObject({
      from: b.id,
      text: 'hello guild',
    });
    // Not a member: refused, and nothing reaches the guild.
    const mark = so.msgs.length;
    so.send('chat', { ch: 'guild', text: 'let me in' });
    expect((await so.wait('err', mark)).d.code).toBe('no_guild');
    expect(so.msgs.slice(mark).some((m) => m.t === 'chatmsg')).toBe(false);

    // A minor joins (offline): the very next line is filtered for everyone.
    await call('POST', '/api/guilds/invites', { to: kid.id }, a.cookie);
    await call('POST', `/api/guilds/invites/${gid}/accept`, undefined, kid.cookie);
    expect((await roster(gid)).filtered).toBe(true);
    expect(await guildLine(sa, sb, RUDE)).toMatchObject({ text: CLEAN, filtered: true });
    expect(await guildLine(sb, sa, RUDE)).toMatchObject({ text: CLEAN, filtered: true });
    // The minor leaves: adults only again.
    await call('POST', '/api/guilds/leave', undefined, kid.cookie);
    expect((await roster(gid)).filtered).toBe(false);
    expect(await guildLine(sa, sb, RUDE)).toMatchObject({ text: RUDE, filtered: false });

    // Kicked while online: guild chat stops at once.
    await call('DELETE', `/api/guilds/members/${b.id}`, undefined, a.cookie);
    const m2 = sb.msgs.length;
    sb.send('chat', { ch: 'guild', text: 'still here?' });
    expect((await sb.wait('err', m2)).d.code).toBe('no_guild');
  });

  it('R-SEC-010 deleting the leader account hands the guild to the next member', async () => {
    const lead = await signUp(env, uniq('Del'));
    const heir = await signUp(env, uniq('Heir'));
    const made = await call<MyGuild>(
      'POST',
      '/api/guilds',
      { name: gname('Heirloom'), tag: `D${n}`.slice(0, 5) },
      lead.cookie,
    );
    const gid = made.data.guild!.id;
    await call('POST', '/api/guilds/invites', { to: heir.id }, lead.cookie);
    await call('POST', `/api/guilds/invites/${gid}/accept`, undefined, heir.cookie);
    const exported = await call<{ guildMemberships: { guildId: string }[] }>(
      'GET',
      '/api/me/export',
      undefined,
      lead.cookie,
    );
    expect(exported.data.guildMemberships.map((m) => m.guildId)).toEqual([gid]);
    expect((await call('DELETE', '/api/me', undefined, lead.cookie)).status).toBe(204);
    const view = await guildOf(heir.cookie);
    expect(view.rank).toBe('leader');
    expect(view.guild?.members.map((m) => m.id)).toEqual([heir.id]);
    // The GuildRoom notices the version change before its next use.
    expect((await roster(gid)).roster?.members.map((m) => m.p)).toEqual([heir.id]);
  });
});
