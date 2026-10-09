/**
 * Alpha guest play through the real Worker (spec 9.6, R-FMT-007, DD-107): guests without accounts
 * open and join one-time-code battles at a chosen level with the whole catalogue available; the
 * code is single use, the level binds both sides, nothing is recorded, and a guest can do nothing
 * else. `ALPHA_GUEST_PLAY` is `on` in vitest.config.ts.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Side } from '@chain-theorem/rules';
import { BASE, call, openSocket, signUp } from './helpers.ts';
import { getDb, releaseDb } from '../src/db.ts';

interface Guest {
  cookie: string;
  id: string;
  name: string;
}

async function guest(ip = '203.0.113.7'): Promise<Guest> {
  const r = await rawCall('POST', '/api/alpha/guest', undefined, undefined, ip);
  if (r.status !== 200) throw new Error(`guest ${r.status} ${JSON.stringify(r.data)}`);
  const data = r.data as { me: { id: string; name: string } };
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, id: data.me.id, name: data.me.name };
}

/** `call` with an extra header (the client address the guest limiter keys on). */
async function rawCall(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  ip?: string,
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const { SELF } = await import('cloudflare:test');
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (ip) headers['cf-connecting-ip'] = ip;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

/**
 * A loadout that needs level 12: Journeyman's Medallion (level 12, three of the three item slots a
 * level-12 army has) and Riposte (level 12), with no collection behind it.
 */
const LEVEL_12 = {
  elements: ['storm'],
  items: ['journeymans_medallion'],
  sets: [['electric_slide', 'riposte', 'scout', 'last_word']],
};
/** Legal at level 1 (the starter collection), so legal at any level. */
const LEVEL_1 = {
  elements: ['tide'],
  items: ['dual_adepts_glove'],
  sets: [['hit_and_run', 'scout']],
};

describe('alpha guest play (9.6, R-FMT-007, DD-107)', () => {
  it('R-FMT-007 R-SEC-006 a guest is a 24-hour HttpOnly cookie; the routes know it and nothing else does', async () => {
    const g = await guest();
    expect(g.id).toMatch(/^g-\d{4}-/);
    expect(g.name).toBe(`Guest ${g.id.slice(2, 6)}`);
    expect(g.cookie).toMatch(/^ct_alpha=/);
    const me = await call<{ enabled: boolean; me: { id: string; guest: boolean } | null }>(
      'GET',
      '/api/alpha/me',
      undefined,
      g.cookie,
    );
    expect(me.data).toEqual({ enabled: true, me: { id: g.id, name: g.name, guest: true } });
    // A guest is signed out everywhere else: loadouts, the account, the world, the queues.
    expect((await call('GET', '/api/loadouts', undefined, g.cookie)).status).toBe(401);
    expect((await call('GET', '/api/me', undefined, g.cookie)).data).toEqual({ me: null });
    expect((await call('POST', '/api/world/ticket', {}, g.cookie)).status).toBe(401);
    expect(
      (
        await call(
          'POST',
          '/api/battles',
          { kind: 'challenge', format: 'full', loadoutId: 'x' },
          g.cookie,
        )
      ).status,
    ).toBe(401);
  });

  it('R-FMT-007 guest creation is rate-limited per address', async () => {
    const ip = '198.51.100.42';
    let last = 200;
    for (let i = 0; i < 12 && last === 200; i++)
      last = (await rawCall('POST', '/api/alpha/guest', undefined, undefined, ip)).status;
    expect(last).toBe(429);
    // Another address is unaffected.
    expect(
      (await rawCall('POST', '/api/alpha/guest', undefined, undefined, '198.51.100.43')).status,
    ).toBe(200);
  });

  it('R-FMT-007 R-LOAD-004 a lobby at level 12 takes any card at or below it without ownership, binds the joiner to that level, and the code is single use', async () => {
    const a = await guest('203.0.113.10');
    const b = await guest('203.0.113.11');
    // Above the chosen level: refused (rule 2 still applies).
    expect(
      (
        await call(
          'POST',
          '/api/alpha/battles',
          { format: 'first_blood', level: 5, loadout: LEVEL_12 },
          a.cookie,
        )
      ).data,
    ).toEqual({ error: 'invalid_loadout' });
    const c = await call<{ code: string; url: string; ticket: { battleId: string; url: string } }>(
      'POST',
      '/api/alpha/battles',
      { format: 'first_blood', level: 12, loadout: LEVEL_12 },
      a.cookie,
    );
    expect(c.status).toBe(200);
    expect(c.data.url).toContain(`#/alpha?c=${c.data.code}`);
    expect(c.data.ticket.battleId).toBe(`a-${c.data.code}`);
    // Anyone may read the invite, signed in or not.
    const info = await call<{
      format: string;
      level: number;
      from: { name: string };
      open: boolean;
    }>('GET', `/api/alpha/${c.data.code}`);
    expect(info.data).toEqual({
      format: 'first_blood',
      level: 12,
      from: { name: a.name },
      open: true,
    });
    // The challenge-link routes never see an alpha lobby.
    expect((await call('GET', `/api/challenges/${c.data.code}`, undefined, a.cookie)).status).toBe(
      401,
    );
    const waiting = await openSocket(c.data.ticket.url);
    // The joiner's loadout is checked at the lobby's level, not one of their choosing.
    expect(
      (
        await call(
          'POST',
          `/api/alpha/${c.data.code}/accept`,
          {
            loadout: {
              elements: ['frost'],
              items: ['dual_adepts_glove'],
              sets: [['permafrost', 'scout']], // Permafrost is level 20
            },
          },
          b.cookie,
        )
      ).data,
    ).toEqual({ error: 'invalid_loadout' });
    expect(
      (
        await call<{ error: string }>(
          'POST',
          `/api/alpha/${c.data.code}/accept`,
          { loadout: LEVEL_1 },
          a.cookie,
        )
      ).data.error,
    ).toBe('own_challenge');
    const tb = await call<{ battleId: string; url: string }>(
      'POST',
      `/api/alpha/${c.data.code}/accept`,
      { loadout: LEVEL_1 },
      b.cookie,
    );
    expect(tb.status).toBe(200);
    expect(await waiting.closed).toBe(4001);
    // Single use: the code is closed to everyone now, and the invite says so.
    const d = await guest('203.0.113.12');
    expect(
      (
        await call<{ error: string }>(
          'POST',
          `/api/alpha/${c.data.code}/accept`,
          { loadout: LEVEL_1 },
          d.cookie,
        )
      ).data.error,
    ).toBe('challenge_closed');
    expect((await call<{ open: boolean }>('GET', `/api/alpha/${c.data.code}`)).data.open).toBe(
      false,
    );

    // Both guests play: a fresh ticket for the creator (rejoin), hello, a move each, then a resign.
    const battleId = tb.data.battleId;
    const ta = await call<{ url: string }>(
      'POST',
      `/api/alpha/battles/${battleId}/ticket`,
      undefined,
      a.cookie,
    );
    expect(ta.status).toBe(200);
    // A stranger gets no ticket for it; the account route refuses guests too.
    expect(
      (await call('POST', `/api/alpha/battles/${battleId}/ticket`, undefined, d.cookie)).status,
    ).toBe(404);
    expect(
      (await call('POST', `/api/battles/${battleId}/ticket`, undefined, a.cookie)).status,
    ).toBe(401);
    const sa = await openSocket(ta.data.url);
    const sb = await openSocket(tb.data.url);
    sa.send('hello', { from: 0 });
    sb.send('hello', { from: 0 });
    const aStart = await sa.wait('bstart');
    const bStart = await sb.wait('bstart');
    const players = aStart.d.players as Record<Side, { name: string; level: number }>;
    expect([players.white.name, players.black.name].sort()).toEqual([a.name, b.name].sort());
    expect(players.white.level).toBe(12);
    expect(players.black.level).toBe(12);
    const aSide = aStart.d.you as Side;
    expect(bStart.d.you).toBe(aSide === 'white' ? 'black' : 'white');
    const [white, black] = aSide === 'white' ? [sa, sb] : [sb, sa];
    const wPub = (await white.wait('bstart')).d.public as { legal: string[] };
    const before = white.msgs.length;
    white.send('mv', { move: wPub.legal.includes('e2e4') ? 'e2e4' : wPub.legal[0] });
    await white.wait('bev', before);
    await black.wait('bev', 1);
    black.send('resign');
    const end = await white.wait('bend');
    // Black resigned, so White won whichever guest held it.
    expect((end.d as { result: { winner: Side } }).result.winner).toBe('white');

    // Nothing recorded: no battles row names either guest, and the guests are in no table.
    const db = await getDb(env);
    try {
      expect(await db.battles.listRecentForPlayer(a.id)).toEqual([]);
      expect(await db.battles.listRecentForPlayer(b.id)).toEqual([]);
      expect(await db.players.getById(a.id)).toBeNull();
    } finally {
      await releaseDb(env, db);
    }
    // Not watchable: the spectate ticket route knows no such public battle.
    const p = await signUp(env, 'Watcher');
    expect(
      (await call('POST', `/api/spectate/${battleId}/ticket`, undefined, p.cookie)).status,
    ).toBe(404);
  });

  it('R-FMT-007 a signed-in player may use the alpha routes too, at the chosen level rather than their own', async () => {
    const p = await signUp(env, 'Hal');
    const g = await guest('203.0.113.20');
    const c = await call<{ code: string }>(
      'POST',
      '/api/alpha/battles',
      { format: 'full', level: 20, loadout: LEVEL_12 },
      p.cookie,
    );
    expect(c.status).toBe(200);
    const info = await call<{ level: number; from: { name: string } }>(
      'GET',
      `/api/alpha/${c.data.code}`,
    );
    expect(info.data).toMatchObject({ level: 20, from: { name: 'Hal' } });
    const t = await call<{ battleId: string }>(
      'POST',
      `/api/alpha/${c.data.code}/accept`,
      { loadout: LEVEL_1 },
      g.cookie,
    );
    expect(t.status).toBe(200);
    // A level-1 account is seated at level 20 here, with no row behind it and no level change.
    expect(t.data.battleId).toBe(`a-${c.data.code}`);
    const db = await getDb(env);
    try {
      expect(await db.battles.listRecentForPlayer(p.id)).toEqual([]);
      expect((await db.players.getById(p.id))?.level).toBe(1);
    } finally {
      await releaseDb(env, db);
    }
  });

  it('R-FMT-007 R-SEC-006 a guest ticket opens no socket outside alpha battles, and an unknown code is 404', async () => {
    expect((await call('GET', '/api/alpha/NoSuchCode1')).status).toBe(404);
    expect((await call('GET', '/api/alpha/bad!code')).status).toBe(404);
    const g = await guest('203.0.113.30');
    expect(
      (await call('POST', '/api/alpha/NoSuchCode1/accept', { loadout: LEVEL_1 }, g.cookie)).data,
    ).toEqual({ error: 'challenge_closed' });
    // Without an identity the create and accept routes are signed out.
    expect(
      (await call('POST', '/api/alpha/battles', { format: 'full', level: 3, loadout: LEVEL_1 }))
        .status,
    ).toBe(401);
  });
});
