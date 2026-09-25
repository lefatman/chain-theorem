/**
 * The Worker end to end inside workerd (M4 4.1–4.3): sign-up by magic link, sessions, loadouts, NPC
 * battles, challenge links with a disconnect and reconnect, the casual queue, and ticket checks. Every
 * battle message a client receives is scanned for hidden information (R-SEC-001).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { scanPayload } from '@chain-theorem/content/scan';
import type { GameState, Side } from '@chain-theorem/rules';
import type { BattleRoom } from '../src/rooms/battle-room.ts';
import { call, openSocket, signUp, type Sock } from './helpers.ts';

const TIDE = { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] };

async function saveLoadout(cookie: string): Promise<string> {
  const r = await call<{ id: string; valid: boolean; errors: unknown[] }>(
    'PUT',
    '/api/loadouts',
    { name: 'Tide', loadout: TIDE },
    cookie,
  );
  expect(r.status).toBe(200);
  expect(r.data.errors).toEqual([]);
  expect(r.data.valid).toBe(true);
  return r.data.id;
}

async function fullState(battleId: string): Promise<GameState> {
  const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(battleId));
  return runInDurableObject(stub, (room: BattleRoom) =>
    (room as unknown as { core: { fullState(): GameState } }).core.fullState(),
  );
}

/** R-SEC-001: no message a side received names anything that side may not know. */
async function scanAll(battleId: string, sock: Sock, viewer: Side): Promise<void> {
  const state = await fullState(battleId);
  for (const m of sock.msgs) {
    const leak =
      scanPayload(m.d, state, viewer) ??
      (Array.isArray(m.d.events) ? scanPayload(m.d.events, state, viewer) : null);
    expect(leak, `${m.t} leaked`).toBeNull();
  }
}

describe('Worker (M4)', () => {
  it('R-SEC-006 R-SEC-011 signs up by magic link; the session cookie is HttpOnly; only adult_from is kept', async () => {
    const a = await signUp(env, 'Ada');
    const me = await call<{ me: { name: string; level: number; adult: boolean } }>(
      'GET',
      '/api/me',
      undefined,
      a.cookie,
    );
    expect(me.data.me).toMatchObject({ name: 'Ada', level: 1, adult: true });
    const anon = await call<{ me: null }>('GET', '/api/me');
    expect(anon.status).toBe(200);
    expect(anon.data.me).toBeNull();
    const inv = await call<{ items: { id: string }[]; cards: { id: string }[] }>(
      'GET',
      '/api/inventory',
      undefined,
      a.cookie,
    );
    expect(inv.data.items.map((x) => x.id)).toEqual(['dual_adepts_glove']);
    expect(inv.data.cards.map((x) => x.id).sort()).toEqual(['hit_and_run', 'last_word', 'scout']);
    const exported = await call<{ player: Record<string, unknown> }>(
      'GET',
      '/api/me/export',
      undefined,
      a.cookie,
    );
    expect(JSON.stringify(exported.data)).not.toContain('2000-01-01');
    expect(exported.data.player.adultFrom).toBe(Date.UTC(2018, 0, 1));
    const out = await call('POST', '/api/auth/signout', undefined, a.cookie);
    expect(out.status).toBe(204);
    expect((await call<{ me: null }>('GET', '/api/me', undefined, a.cookie)).data.me).toBeNull();
  });

  it('R-SEC-006 a magic link works once; under-age sign-ups are refused (DD-06)', async () => {
    const r = await call<{ status: string }>('POST', '/api/auth/verify', { token: 'x'.repeat(43) });
    expect(r.status).toBe(400);
    await expect(signUp(env, 'Kid', '2020-01-01')).rejects.toThrow(/complete 400/);
  });

  it('R-LOAD-004 loadouts are validated against the account level and collection', async () => {
    const a = await signUp(env, 'Bea');
    const bad = await call<{ valid: boolean; errors: { code: string }[] }>(
      'PUT',
      '/api/loadouts',
      {
        name: 'Too strong',
        loadout: { elements: ['ember'], items: ['headmaster_ring'], sets: [['cleave']] },
      },
      a.cookie,
    );
    expect(bad.data.valid).toBe(false);
    expect(bad.data.errors.map((e) => e.code)).toContain('item_level');
    const id = await saveLoadout(a.cookie);
    const npc = await call(
      'POST',
      '/api/battles',
      {
        kind: 'npc',
        format: 'first_blood',
        loadoutId: (bad.data as unknown as { id: string }).id ?? 'x',
        tier: 'wild',
      },
      a.cookie,
    );
    expect(npc.status).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/api/battles',
          { kind: 'npc', format: 'first_blood', loadoutId: id, tier: 'wild' },
          a.cookie,
        )
      ).status,
    ).toBe(200);
  });

  it('R-FMT-005 R-NET-001 R-SEC-001 an NPC battle over a socket: hello, projection, a move, the NPC reply', async () => {
    const a = await signUp(env, 'Cy');
    const id = await saveLoadout(a.cookie);
    const t = await call<{ battleId: string; url: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'full', loadoutId: id, tier: 'wild' },
      a.cookie,
    );
    const s = await openSocket(t.data.url);
    s.send('hello', { from: 0 });
    const start = await s.wait('bstart');
    const you = start.d.you as Side;
    const pub = start.d.public as { legal: string[]; turn: Side };
    if (pub.turn === you) {
      s.send('mv', { move: pub.legal[0] });
      await s.wait('bev', s.msgs.length);
    }
    // The NPC has moved at least once (it replies at once to White or to our move).
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !s.msgs.some(
        (m) =>
          m.t === 'bev' &&
          JSON.stringify(m.d.events).includes(
            '"side":"' + (you === 'white' ? 'black' : 'white') + '"',
          ),
      )
    )
      await new Promise((r) => setTimeout(r, 10));
    await scanAll(t.data.battleId, s, you);
    s.ws.close(1000);
  });

  it('R-SEC-006 sockets need a valid ticket for that battle', async () => {
    const a = await signUp(env, 'Dee');
    const id = await saveLoadout(a.cookie);
    const t = await call<{ battleId: string; url: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'full', loadoutId: id, tier: 'wild' },
      a.cookie,
    );
    await expect(openSocket(`/ws/battle/${t.data.battleId}?t=forged.ticket`)).rejects.toThrow(
      /403/,
    );
    const other = await call<{ battleId: string }>(
      'POST',
      '/api/battles',
      { kind: 'npc', format: 'full', loadoutId: id, tier: 'wild' },
      a.cookie,
    );
    const token = new URL(`http://x${t.data.url}`).searchParams.get('t') ?? '';
    await expect(
      openSocket(`/ws/battle/${other.data.battleId}?t=${encodeURIComponent(token)}`),
    ).rejects.toThrow(/403/);
    const b = await signUp(env, 'Eve');
    expect(
      (await call('POST', `/api/battles/${t.data.battleId}/ticket`, undefined, b.cookie)).status,
    ).toBe(404);
  });

  it('R-FMT-003 R-NET-001 R-SEC-001 a challenge link battle with a disconnect and a reconnect replay', async () => {
    const a = await signUp(env, 'Fay');
    const b = await signUp(env, 'Gus');
    const la = await saveLoadout(a.cookie);
    const lb = await saveLoadout(b.cookie);
    const c = await call<{ code: string; url: string; ticket: { battleId: string; url: string } }>(
      'POST',
      '/api/battles',
      { kind: 'challenge', format: 'full', loadoutId: la },
      a.cookie,
    );
    expect(c.data.url).toContain(`#/online?c=${c.data.code}`);
    const info = await call<{ open: boolean; from: { name: string } }>(
      'GET',
      `/api/challenges/${c.data.code}`,
      undefined,
      b.cookie,
    );
    expect(info.data).toMatchObject({ open: true, from: { name: 'Fay' } });
    const waiting = await openSocket(c.data.ticket.url);
    expect(
      (
        await call<{ error: string }>(
          'POST',
          `/api/challenges/${c.data.code}/accept`,
          { loadoutId: la },
          a.cookie,
        )
      ).data.error,
    ).toBe('own_challenge');
    const tb = await call<{ battleId: string; url: string }>(
      'POST',
      `/api/challenges/${c.data.code}/accept`,
      { loadoutId: lb },
      b.cookie,
    );
    expect(tb.status).toBe(200);
    expect(await waiting.closed).toBe(4001);
    expect(
      (await call<{ open: boolean }>('GET', `/api/challenges/${c.data.code}`, undefined, b.cookie))
        .data.open,
    ).toBe(false);

    const battleId = tb.data.battleId;
    const ta = await call<{ url: string }>(
      'POST',
      `/api/battles/${battleId}/ticket`,
      undefined,
      a.cookie,
    );
    const sa = await openSocket(ta.data.url);
    const sb = await openSocket(tb.data.url);
    sa.send('hello', { from: 0 });
    sb.send('hello', { from: 0 });
    const aStart = await sa.wait('bstart');
    await sb.wait('bstart');
    const aSide = aStart.d.you as Side;
    const [white, black] = aSide === 'white' ? [sa, sb] : [sb, sa];
    const wPub = (await white.wait('bstart')).d.public as { legal: string[] };
    const before = white.msgs.length;
    white.send('mv', { move: wPub.legal.includes('e2e4') ? 'e2e4' : wPub.legal[0] });
    const wBev = await white.wait('bev', before);
    await black.wait('bev', 1);
    // Black drops; White sees the grace countdown (9.2).
    black.ws.close(1000);
    const opp = await white.wait('opp', before);
    const graceUntil = (opp.d as { graceUntil?: number }).graceUntil;
    expect(opp.d.connected).toBe(false);
    expect(graceUntil).toBeGreaterThan(Date.now());
    // Black reconnects with a fresh ticket and catches up from index 0.
    const blackCookie = black === sa ? a.cookie : b.cookie;
    const fresh = await call<{ url: string }>(
      'POST',
      `/api/battles/${battleId}/ticket`,
      undefined,
      blackCookie,
    );
    const again = await openSocket(fresh.data.url);
    again.send('hello', { from: 0 });
    const replay = await again.wait('bev');
    expect(replay.d.to).toBe(wBev.d.to);
    expect(JSON.stringify(replay.d.events)).toContain('MoveMade');
    await scanAll(battleId, white, 'white');
    await scanAll(battleId, again, 'black');
    // Resign ends the battle; the log is archived to R2 and the battles row is finished.
    again.send('resign');
    const end = await white.wait('bend', before);
    expect((end.d.result as { reason: string }).reason).toBe('resign');
    const obj = await env.BATTLE_LOGS.get(`battles/${battleId}.json`);
    expect(obj).not.toBeNull();
    white.ws.close(1000);
    again.ws.close(1000);
  });

  it('R-FMT-004 two players in the casual queue are matched into one battle', async () => {
    const a = await signUp(env, 'Hal');
    const b = await signUp(env, 'Ivy');
    const la = await saveLoadout(a.cookie);
    const lb = await saveLoadout(b.cookie);
    const qa = await call<{ url: string }>(
      'POST',
      '/api/queue/ticket',
      { format: 'first_blood', loadoutId: la },
      a.cookie,
    );
    const qb = await call<{ url: string }>(
      'POST',
      '/api/queue/ticket',
      { format: 'first_blood', loadoutId: lb },
      b.cookie,
    );
    const sa = await openSocket(qa.data.url);
    await sa.wait('queued');
    const sb = await openSocket(qb.data.url);
    const ma = await sa.wait('matched');
    const mb = await sb.wait('matched');
    expect(ma.d.battleId).toBe(mb.d.battleId);
    const active = await call<{ battles: { id: string }[] }>(
      'GET',
      '/api/battles/active',
      undefined,
      a.cookie,
    );
    expect(active.data.battles.map((x) => x.id)).toContain(ma.d.battleId);
  });
});
