/**
 * WorldController against a scripted ZoneRoom (M5, spec 10.1–10.5): fresh tickets per connect
 * (R-SEC-006), step prediction and correction and the 8/s step limit (R-WORLD-001, R-SEC-005),
 * interpolation of other players, warps, the encounter hand-off, chat routing (R-WORLD-004,
 * R-SEC-011), dialogs, lesson puzzles (R-WORLD-003), parties and challenges (R-WORLD-006).
 * Every message the client sends is validated with the protocol's schemas.
 */
import { describe, expect, it } from 'vitest';
import { ClientZone, ServerZone, decode, encode, type Msg } from '@chain-theorem/protocol';
import {
  STEP_MS,
  WorldController,
  drawnPos,
  type Encounter,
  type SocketLike,
  type WorldOptions,
} from './controller.ts';
import { parseZone, type TiledMap, type ZoneGeometry } from '@chain-theorem/content/world';

type Sent = Msg<typeof ClientZone>;

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Sent[] = [];
  closed: { code?: number } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string): void {
    const m = decode(ClientZone, data);
    if (!m) throw new Error(`client sent an invalid message: ${data}`);
    this.sent.push(m);
  }
  close(code?: number): void {
    this.readyState = 3;
    this.closed = code === undefined ? {} : { code };
    this.onclose?.({ code });
  }
  /** The server closes the socket. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: Msg<typeof ServerZone>): void {
    this.onmessage?.({ data: encode(ServerZone, msg) });
  }
  types(): string[] {
    return this.sent.map((m) => m.t);
  }
}

// A 6x5 zone: trees around, grass, a tall-grass patch, a path; an NPC, a sign and a warp.
//   T T T T T T
//   T g g N p T      N: teacher at (3,1)
//   T g w w p T      w: wild grass
//   T S g g W T      S: sign at (1,3), W: warp at (4,3)
//   T T T T T T
function fixtureMap(): TiledMap {
  const G = 1;
  const T = 2;
  const W = 3;
  const P = 4;
  const kinds: [number, string, boolean, boolean][] = [
    [0, 'grass', false, false],
    [1, 'tree', true, false],
    [2, 'tall_grass', false, true],
    [3, 'path', false, false],
  ];
  const prop = (name: string, value: string | number) => ({
    name,
    type: typeof value === 'number' ? ('int' as const) : ('string' as const),
    value,
  });
  return {
    type: 'map',
    orientation: 'orthogonal',
    width: 6,
    height: 5,
    tilewidth: 16,
    tileheight: 16,
    infinite: false,
    tilesets: [
      {
        firstgid: 1,
        name: 'overworld',
        tilewidth: 16,
        tileheight: 16,
        tilecount: 4,
        columns: 4,
        tiles: kinds.map(([id, kind, solid, wild]) => ({
          id,
          properties: [
            { name: 'kind', type: 'string' as const, value: kind },
            { name: 'solid', type: 'bool' as const, value: solid },
            { name: 'wild', type: 'bool' as const, value: wild },
          ],
        })),
      },
    ],
    layers: [
      {
        type: 'tilelayer',
        name: 'ground',
        width: 6,
        height: 5,
        // prettier-ignore
        data: [
          T, T, T, T, T, T,
          T, G, G, G, P, T,
          T, G, W, W, P, T,
          T, G, G, G, P, T,
          T, T, T, T, T, T,
        ],
      },
      {
        type: 'objectgroup',
        name: 'objects',
        objects: [
          { id: 1, name: '', type: 'spawn', x: 16, y: 16, width: 0, height: 0 },
          {
            id: 2,
            name: '',
            type: 'npc',
            x: 48,
            y: 16,
            width: 0,
            height: 0,
            properties: [prop('npc', 'teacher')],
          },
          {
            id: 3,
            name: '',
            type: 'sign',
            x: 16,
            y: 48,
            width: 0,
            height: 0,
            properties: [prop('text', 'Welcome to the Academy.')],
          },
          {
            id: 4,
            name: '',
            type: 'warp',
            x: 64,
            y: 48,
            width: 0,
            height: 0,
            properties: [prop('to', 'route1'), prop('toX', 1), prop('toY', 1)],
          },
        ],
      },
    ],
  };
}

const GEO: ZoneGeometry = parseZone(fixtureMap());

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

interface Harness {
  c: WorldController;
  sockets: FakeSocket[];
  timers: { fn: () => void; ms: number }[];
  tickets: string[];
  clock: { t: number };
  last(): FakeSocket;
  encounters: Encounter[];
}

function setup(extra: Partial<WorldOptions> = {}, ticketZones: string[] = []): Harness {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const tickets: string[] = [];
  const clock = { t: 1000 };
  const encounters: Encounter[] = [];
  let n = 0;
  const c = new WorldController({
    ticket: async () => {
      const zone = ticketZones[n] ?? 'academy';
      n++;
      tickets.push(`t${n}`);
      return { zone, url: `/ws/zone/${zone}?t=t${n}` };
    },
    socketUrl: (p) => `wss://example.test${p}`,
    geometry: async (zone) => (zone === 'academy' ? GEO : null),
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    now: () => clock.t,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
    onEncounter: (e) => {
      encounters.push(e);
    },
    ...extra,
  });
  return {
    c,
    sockets,
    timers,
    tickets,
    clock,
    encounters,
    last: () => {
      const s = sockets.at(-1);
      if (!s) throw new Error('no socket');
      return s;
    },
  };
}

type ZoneSnap = Extract<Msg<typeof ServerZone>, { t: 'zsnap' }>['d'];

function snap(over: Partial<ZoneSnap> = {}): Msg<typeof ServerZone> {
  return {
    t: 'zsnap',
    d: {
      zone: 'academy',
      channel: 0,
      you: { p: 'me', x: 1, y: 1, dir: 's' },
      players: [
        { p: 'ann', name: 'Ann', x: 2, y: 3, dir: 'n', battling: false, level: 3 },
        { p: 'bob', name: 'Bob', x: 4, y: 2, dir: 'w', battling: true, level: 5 },
      ],
      npcs: [{ id: 'teacher', name: 'Professor Rook', x: 3, y: 1, dir: 's' }],
      challengeZone: false,
      quests: [{ id: 'first_steps', step: 0, done: false }],
      ...over,
    },
  };
}

/** Connect, open and deliver the snapshot; returns the open socket. */
async function joined(h: Harness, over: Partial<ZoneSnap> = {}): Promise<FakeSocket> {
  await flush();
  const s = h.last();
  s.open();
  s.deliver(snap(over));
  await flush();
  return s;
}

describe('WorldController connection (R-SEC-006, R-WORLD-001)', () => {
  it('R-SEC-006 asks a fresh world ticket, sends hello on open and takes the snapshot', async () => {
    const h = setup();
    await flush();
    expect(h.tickets).toEqual(['t1']);
    const s = h.last();
    expect(s.url).toBe('wss://example.test/ws/zone/academy?t=t1');
    expect(h.c.connection.value).toBe('connecting');
    s.open();
    expect(s.types()).toEqual(['hello']);
    // Steps wait for the snapshot (they would be predicted from an unknown tile).
    expect(h.c.step('e')).toBe(false);
    s.deliver(snap());
    await flush();
    expect(h.c.connection.value).toBe('open');
    expect(h.c.zone.value).toEqual({ id: 'academy', channel: 0 });
    expect(h.c.me.value).toMatchObject({ p: 'me', x: 1, y: 1, dir: 's' });
    expect([...h.c.players.value.keys()]).toEqual(['ann', 'bob']);
    expect(h.c.roster.value.map((r) => r.name)).toEqual(['Ann', 'Bob']);
    expect(h.c.npcs.value[0]?.name).toBe('Professor Rook');
    expect(h.c.quests.value).toEqual([{ id: 'first_steps', step: 0, done: false, text: null }]);
    expect(h.c.geometry.value).toBe(GEO);
  });

  it('R-SEC-006 reconnects with backoff and a fresh ticket each time', async () => {
    const h = setup({ backoff: [100, 400] });
    const s1 = await joined(h);
    s1.drop();
    expect(h.c.connection.value).toBe('reconnecting');
    expect(h.timers.map((t) => t.ms)).toEqual([100]);
    h.timers[0]?.fn();
    await flush();
    expect(h.tickets).toEqual(['t1', 't2']);
    // A second failure before opening backs off further.
    h.last().drop();
    expect(h.timers.map((t) => t.ms)).toEqual([100, 400]);
    h.timers[1]?.fn();
    await flush();
    expect(h.tickets).toEqual(['t1', 't2', 't3']);
    const s3 = h.last();
    s3.open();
    expect(s3.types()).toEqual(['hello']);
  });

  it('R-SEC-006 stops when the ticket is refused, on a policy close and when replaced elsewhere', async () => {
    const h = setup({
      ticket: () => Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 })),
    });
    await flush();
    expect(h.c.connection.value).toBe('closed');
    expect(h.c.notice.value).toMatch(/sign in/i);
    expect(h.timers).toEqual([]);

    const k = setup();
    const s = await joined(k);
    s.drop(1008);
    expect(k.c.connection.value).toBe('closed');
    expect(k.timers).toEqual([]);

    // Opened elsewhere (the zone replaced this socket): no reconnect ping-pong between tabs.
    const r = setup();
    const s2 = await joined(r);
    s2.drop(4000);
    expect(r.c.connection.value).toBe('closed');
    expect(r.c.notice.value).toMatch(/another tab/);
    expect(r.timers).toEqual([]);
    // The player can take the world back by hand.
    r.c.reconnect();
    await flush();
    expect(r.sockets).toHaveLength(2);
  });

  it('R-SEC-006 a suspension closes the world without reconnecting (M6 6.4)', async () => {
    const h = setup();
    const s = await joined(h);
    s.drop(4003);
    expect(h.c.connection.value).toBe('closed');
    expect(h.c.notice.value).toMatch(/suspended/);
    expect(h.timers).toEqual([]);
  });

  it('R-SEC-011 a chat ban is shown with the moderator line the zone sends once (M6 6.4)', async () => {
    const h = setup();
    const s = await joined(h);
    s.deliver({
      t: 'err',
      d: {
        code: 'chat_banned',
        msg: 'A moderator turned chat off for you until 2026-09-26 10:00 UTC.',
      },
    });
    s.deliver({ t: 'err', d: { code: 'chat_banned' } });
    expect(h.c.toasts.value.map((t) => ('text' in t ? t.text : ''))).toEqual([
      'A moderator turned chat off for you until 2026-09-26 10:00 UTC.',
      'A moderator turned chat off for you for a while.',
    ]);
  });

  it('R-SEC-011 sends the stored chat filter choice after every hello, and on change', async () => {
    const h = setup({ filterChat: true });
    const s = await joined(h);
    expect(s.sent.slice(0, 2)).toEqual([
      expect.objectContaining({ t: 'hello' }),
      expect.objectContaining({ t: 'prefs', d: { filterChat: true } }),
    ]);
    h.c.setFilterChat(false);
    expect(s.sent.at(-1)).toMatchObject({ t: 'prefs', d: { filterChat: false } });
    // Without a stored choice nothing is sent: the zone's default applies.
    const k = setup();
    const s2 = await joined(k);
    expect(s2.types()).toEqual(['hello']);
  });
});

describe('WorldController movement (R-WORLD-001, R-SEC-005)', () => {
  it('R-WORLD-001 predicts own steps at once and walks one tile per STEP_MS', async () => {
    const h = setup();
    const s = await joined(h);
    expect(h.c.step('e')).toBe(true);
    expect(h.c.me.value).toMatchObject({ x: 2, y: 1, dir: 'e', fromX: 1, fromY: 1 });
    expect(s.sent.at(-1)).toMatchObject({ t: 'step', d: { dir: 'e' } });
    // Mid-step: the next step waits.
    h.clock.t += STEP_MS / 2;
    expect(h.c.stepReadyIn()).toBe(STEP_MS / 2);
    expect(h.c.step('s')).toBe(false);
    const mid = drawnPos(h.c.me.value!, h.clock.t);
    expect(mid).toEqual({ x: 1.5, y: 1, moving: true });
    h.clock.t += STEP_MS / 2;
    expect(h.c.step('s')).toBe(true);
    expect(h.c.me.value).toMatchObject({ x: 2, y: 2, dir: 's' });
    expect(s.types().filter((t) => t === 'step')).toHaveLength(2);
  });

  it('R-WORLD-001 a wall or an NPC only turns the player; the zone answer is expected', async () => {
    const h = setup();
    const s = await joined(h);
    // North of (1,1) is a tree.
    expect(h.c.step('n')).toBe(true);
    expect(h.c.me.value).toMatchObject({ x: 1, y: 1, dir: 'n' });
    // Facing it again sends nothing.
    expect(h.c.step('n')).toBe(false);
    // The zone answers the bump with zpos; the player walks on meanwhile.
    h.clock.t += STEP_MS;
    expect(h.c.step('e')).toBe(true);
    s.deliver({ t: 'zpos', d: { x: 1, y: 1, dir: 'n' } });
    expect(h.c.me.value).toMatchObject({ x: 2, y: 1, dir: 'e' });
    expect(s.types().filter((t) => t === 'hello')).toHaveLength(1);
    // (3,1) holds the teacher: another turn, not a move.
    h.clock.t += STEP_MS;
    h.c.step('e');
    expect(h.c.me.value).toMatchObject({ x: 2, y: 1, dir: 'e' });
  });

  it('R-WORLD-001 a refused step snaps back and re-syncs with hello before walking again', async () => {
    const h = setup();
    const s = await joined(h);
    h.c.step('e');
    h.clock.t += STEP_MS;
    h.c.step('e'); // blocked by the NPC: turn only (already facing e): nothing sent
    h.c.step('s');
    expect(h.c.me.value).toMatchObject({ x: 2, y: 2 });
    // The zone refused the first step (say, too fast): back to (1,1).
    s.deliver({ t: 'zpos', d: { x: 1, y: 1, dir: 's' } });
    expect(h.c.me.value).toMatchObject({ x: 1, y: 1, dir: 's' });
    expect(s.types().at(-1)).toBe('hello');
    h.clock.t += STEP_MS;
    expect(h.c.step('s')).toBe(false); // waits for the fresh snapshot
    s.deliver({ t: 'zpos', d: { x: 1, y: 2, dir: 's' } }); // stale: ignored
    s.deliver(snap({ you: { p: 'me', x: 1, y: 2, dir: 's' } }));
    expect(h.c.me.value).toMatchObject({ x: 1, y: 2 });
    expect(h.c.step('e')).toBe(true);
  });

  it('R-SEC-005 never sends more than 8 steps in any second, however fast input comes', async () => {
    const h = setup();
    const s = await joined(h);
    const times: number[] = [];
    // Hammer every direction every 5 ms for 3 seconds (walks and wall bumps alike).
    const dirs = ['e', 's', 'w', 'n'] as const;
    for (let i = 0; i < 600; i++) {
      h.clock.t += 5;
      const before = s.sent.length;
      h.c.step(dirs[i % 4] ?? 'e');
      if (s.sent.length > before) times.push(h.clock.t);
      // Keep the player inside the map: zpos answers are expected turns or ignored.
    }
    expect(times.length).toBeGreaterThan(10);
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter((t) => t >= (times[i] ?? 0) && t < (times[i] ?? 0) + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(8);
    }
  });

  it('R-WORLD-001 interpolates other players over a step and draws jumps at once', async () => {
    const h = setup();
    const s = await joined(h);
    s.deliver({ t: 'zstep', d: { p: 'ann', x: 2, y: 2, dir: 'n' } });
    const ann = h.c.players.value.get('ann')!;
    expect(ann).toMatchObject({ x: 2, y: 2, fromX: 2, fromY: 3, at: h.clock.t });
    expect(drawnPos(ann, h.clock.t + STEP_MS / 4)).toEqual({ x: 2, y: 2.75, moving: true });
    expect(drawnPos(ann, h.clock.t + STEP_MS)).toEqual({ x: 2, y: 2, moving: false });
    // A second step mid-way starts from where Ann is drawn, not from her last tile.
    h.clock.t += STEP_MS / 2;
    s.deliver({ t: 'zstep', d: { p: 'ann', x: 2, y: 1, dir: 'n' } });
    expect(h.c.players.value.get('ann')).toMatchObject({ fromY: 2.5, y: 1 });
    // A jump of several tiles is not slid.
    s.deliver({ t: 'zstep', d: { p: 'ann', x: 4, y: 3, dir: 'e' } });
    expect(drawnPos(h.c.players.value.get('ann')!, h.clock.t)).toEqual({
      x: 4,
      y: 3,
      moving: false,
    });
  });

  it('R-WORLD-001 tracks joins, leaves and the battling marker', async () => {
    const h = setup();
    const s = await joined(h);
    s.deliver({
      t: 'zjoin',
      d: { p: 'cat', name: 'Cat', x: 1, y: 2, dir: 's', battling: false, level: 2 },
    });
    expect(h.c.roster.value.map((r) => r.p)).toEqual(['ann', 'bob', 'cat']);
    s.deliver({ t: 'zbattle', d: { p: 'cat', battling: true } });
    expect(h.c.players.value.get('cat')?.battling).toBe(true);
    expect(h.c.roster.value.find((r) => r.p === 'cat')?.battling).toBe(true);
    h.c.select('cat');
    s.deliver({ t: 'zleave', d: { p: 'cat' } });
    expect(h.c.players.value.has('cat')).toBe(false);
    expect(h.c.selected.value).toBeNull();
    expect(h.c.nearby(1).map((p) => p.p)).toEqual([]);
    expect(h.c.nearby(3).map((p) => p.p)).toEqual(['ann', 'bob']);
  });

  it('R-WORLD-001 a warp reconnects to the new zone with a new ticket', async () => {
    const h = setup({}, ['academy', 'route1']);
    const s = await joined(h);
    // Walk to the warp tile at (4,3): e, e, e (turn: NPC), s, s, e...
    const walk = (d: 'n' | 's' | 'e' | 'w') => {
      h.clock.t += STEP_MS;
      return h.c.step(d);
    };
    walk('s');
    walk('s'); // (1,3) is the sign: turn only
    walk('e'); // (2,2)
    walk('s'); // (2,3)
    walk('e'); // (3,3)
    expect(walk('e')).toBe(true); // (4,3): the warp
    expect(h.c.me.value).toMatchObject({ x: 4, y: 3 });
    // Waiting for the zone to move us: no more steps.
    expect(walk('n')).toBe(false);
    s.deliver({ t: 'zwarp', d: { zone: 'route1' } });
    expect(s.closed).toEqual({ code: 1000 });
    expect(h.c.connection.value).toBe('warping');
    await flush();
    expect(h.tickets).toEqual(['t1', 't2']);
    const s2 = h.last();
    expect(s2.url).toContain('/ws/zone/route1?t=t2');
    s2.open();
    s2.deliver(snap({ zone: 'route1', you: { p: 'me', x: 1, y: 1, dir: 's' }, players: [] }));
    await flush();
    expect(h.c.connection.value).toBe('open');
    expect(h.c.zone.value?.id).toBe('route1');
    expect(h.c.geometry.value).toBeNull(); // no map for route1 in this test
    expect(h.c.roster.value).toEqual([]);
    // The old socket closing later does not trigger a reconnect.
    expect(h.timers).toEqual([]);
  });
});

describe('WorldController encounters (R-WORLD-002)', () => {
  it('R-WORLD-002 hands an encounter to the battle screen and waits for it to end', async () => {
    let finish: () => void = () => undefined;
    const handed: Encounter[] = [];
    const h = setup({
      onEncounter: (e) => {
        handed.push(e);
        return new Promise<void>((r) => {
          finish = r;
        });
      },
    });
    const s = await joined(h);
    const enc = { battleId: 'b1', url: '/ws/battle/b1?t=x', kind: 'wild' } as const;
    s.deliver({ t: 'enc', d: enc });
    expect(handed).toEqual([enc]);
    expect(h.c.battle.value).toEqual(enc);
    expect(h.c.blocked()).toBe('battling');
    expect(h.c.step('e')).toBe(false);
    finish();
    await flush();
    expect(h.c.battle.value).toBeNull();
    expect(h.c.blocked()).toBeNull();
    expect(h.c.step('e')).toBe(true);
  });

  it('R-WORLD-002 the zone ending the battle (zbattle) also returns to the world', async () => {
    const h = setup();
    const s = await joined(h);
    s.deliver({ t: 'enc', d: { battleId: 'b2', url: '/ws/battle/b2', kind: 'challenge' } });
    expect(h.encounters).toHaveLength(1);
    s.deliver({ t: 'zbattle', d: { p: 'me', battling: false } });
    expect(h.c.battle.value).toBeNull();
    expect(h.c.battling.value).toBe(false);
  });
});

describe('WorldController chat (R-WORLD-004, R-SEC-011, R-SEC-005)', () => {
  it('R-WORLD-004 routes lines by channel, echoes own whispers and counts unread', async () => {
    const h = setup();
    const s = await joined(h);
    s.deliver({
      t: 'chatmsg',
      d: { ch: 'zone', from: 'ann', name: 'Ann', text: 'hi', filtered: false },
    });
    s.deliver({
      t: 'chatmsg',
      d: { ch: 'party', from: 'bob', name: 'Bob', text: '*** there', filtered: true },
    });
    s.deliver({
      t: 'chatmsg',
      d: { ch: 'zone', from: 'me', name: 'Me', text: 'hello all', filtered: false },
    });
    expect(h.c.chat.value.zone.map((l) => [l.name, l.text, l.own])).toEqual([
      ['Ann', 'hi', false],
      ['Me', 'hello all', true],
    ]);
    expect(h.c.chat.value.party[0]).toMatchObject({ text: '*** there', filtered: true });
    expect(h.c.unread.value).toMatchObject({ zone: 1, party: 1, whisper: 0 });
    h.c.markRead('zone');
    expect(h.c.unread.value.zone).toBe(0);
    // Zone and party lines come back from the zone; whispers are echoed locally.
    expect(h.c.sendChat('zone', '  hello  ')).toBe(true);
    expect(s.sent.at(-1)).toMatchObject({ t: 'chat', d: { ch: 'zone', text: 'hello' } });
    h.clock.t += 1000;
    expect(h.c.sendChat('whisper', 'psst')).toBe(false); // no recipient
    expect(h.c.sendChat('whisper', 'psst', { p: 'ann', name: 'Ann' })).toBe(true);
    expect(s.sent.at(-1)).toMatchObject({
      t: 'chat',
      d: { ch: 'whisper', text: 'psst', to: 'ann' },
    });
    expect(h.c.chat.value.whisper.at(-1)).toMatchObject({ own: true, to: 'ann', toName: 'Ann' });
  });

  it('R-SEC-005 chat sends are paced: a brief pause each, then 1 per second after a burst of 5', async () => {
    const h = setup();
    const s = await joined(h);
    let sent = 0;
    for (let i = 0; i < 40; i++) {
      if (h.c.sendChat('zone', `m${i}`)) sent++;
      h.clock.t += 100;
    }
    // 4 seconds: a burst of up to 5 plus about 1 per second, never faster than the pause.
    expect(sent).toBeGreaterThanOrEqual(5);
    expect(sent).toBeLessThanOrEqual(9);
    expect(s.types().filter((t) => t === 'chat')).toHaveLength(sent);
    expect(h.c.chatReadyAt.value).toBeGreaterThan(0);
  });
});

describe('WorldController NPCs and lessons (R-WORLD-003, R-WORLD-005)', () => {
  it('R-WORLD-003 talks to the NPC in front, shows the dialog and sends the choice', async () => {
    const h = setup();
    const s = await joined(h);
    // The teacher is two tiles east: walk next to them, facing them.
    h.clock.t += STEP_MS;
    h.c.step('e');
    h.clock.t += STEP_MS;
    expect(h.c.interact()).toBe(true);
    expect(s.sent.at(-1)).toEqual(
      expect.objectContaining({ t: 'interact', d: { npc: 'teacher' } }),
    );
    s.deliver({
      t: 'dialog',
      d: {
        npc: 'teacher',
        name: 'Professor Rook',
        lines: ['Welcome, {name}.', 'Ready?'],
        options: [
          { id: 'lesson:moves', label: 'Piece movement' },
          { id: 'skip:moves', label: 'Skip: Piece movement' },
        ],
      },
    });
    expect(h.c.dialog.value?.options).toHaveLength(2);
    expect(h.c.blocked()).toBe('dialog');
    expect(h.c.choose('lesson:moves')).toBe(true);
    expect(s.sent.at(-1)).toMatchObject({
      t: 'choose',
      d: { npc: 'teacher', option: 'lesson:moves' },
    });
    expect(h.c.dialog.value).toBeNull();

    // The lesson: a wrong answer shows the hint, a right one the next puzzle, the last completes.
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    s.deliver({
      t: 'puzzle',
      d: { lesson: 'moves', index: 0, count: 2, fen, prompt: 'Move the rook.' },
    });
    expect(h.c.puzzle.value).toMatchObject({ status: 'solving', npc: 'teacher', skippable: true });
    expect(h.c.blocked()).toBe('puzzle');
    expect(h.c.answer('not-a-move')).toBe(false);
    expect(h.c.answer('a1a2')).toBe(true);
    expect(s.sent.at(-1)).toMatchObject({
      t: 'answer',
      d: { lesson: 'moves', puzzle: 0, move: 'a1a2' },
    });
    expect(h.c.puzzle.value?.status).toBe('checking');
    expect(h.c.answer('a1a3')).toBe(false); // one answer at a time
    s.deliver({
      t: 'lessonResult',
      d: {
        lesson: 'moves',
        puzzle: 0,
        ok: false,
        hint: 'Rooks move in straight lines.',
        done: false,
      },
    });
    expect(h.c.puzzle.value).toMatchObject({
      status: 'wrong',
      hint: 'Rooks move in straight lines.',
    });
    h.c.answer('a1a8');
    s.deliver({ t: 'lessonResult', d: { lesson: 'moves', puzzle: 0, ok: true, done: false } });
    s.deliver({ t: 'puzzle', d: { lesson: 'moves', index: 1, count: 2, fen, prompt: 'Again.' } });
    expect(h.c.puzzle.value).toMatchObject({ index: 1, status: 'solving', hint: null });
    h.c.answer('a1a8');
    s.deliver({ t: 'lessonResult', d: { lesson: 'moves', puzzle: 1, ok: true, done: true } });
    expect(h.c.puzzle.value?.status).toBe('done');
    expect(h.c.blocked()).toBeNull();
  });

  it('R-WORLD-003 skips a chess lesson through the teacher without showing the dialog again', async () => {
    const h = setup({ skippable: (l) => l === 'check' });
    const s = await joined(h);
    h.clock.t += STEP_MS;
    h.c.step('e');
    s.deliver({
      t: 'dialog',
      d: {
        npc: 'teacher',
        name: 'Professor Rook',
        lines: ['Hi'],
        options: [{ id: 'lesson:check', label: 'Check' }],
      },
    });
    h.c.choose('lesson:check');
    s.deliver({
      t: 'puzzle',
      d: {
        lesson: 'check',
        index: 0,
        count: 3,
        fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        prompt: 'Check!',
      },
    });
    expect(h.c.puzzle.value?.skippable).toBe(true);
    expect(h.c.skipLesson()).toBe(true);
    expect(s.sent.slice(-2)).toEqual([
      expect.objectContaining({ t: 'interact', d: { npc: 'teacher' } }),
      expect.objectContaining({ t: 'choose', d: { npc: 'teacher', option: 'skip:check' } }),
    ]);
    expect(h.c.puzzle.value).toBeNull();
    s.deliver({
      t: 'dialog',
      d: { npc: 'teacher', name: 'Professor Rook', lines: ['Hi'], options: [] },
    });
    expect(h.c.dialog.value).toBeNull();
    // Ability lessons cannot be skipped (10.3).
    s.deliver({
      t: 'puzzle',
      d: {
        lesson: 'ability_1',
        index: 0,
        count: 1,
        fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        prompt: 'x',
      },
    });
    expect(h.c.puzzle.value?.skippable).toBe(false);
    expect(h.c.skipLesson()).toBe(false);
  });

  it('R-WORLD-001 reads a sign locally and selects a player in front', async () => {
    const h = setup();
    const s = await joined(h);
    h.clock.t += STEP_MS;
    h.c.step('s'); // (1,2)
    h.clock.t += STEP_MS;
    h.c.step('s'); // the sign at (1,3): turn
    const before = s.sent.length;
    expect(h.c.interact()).toBe(true);
    expect(h.c.dialog.value).toMatchObject({
      name: 'Sign',
      lines: ['Welcome to the Academy.'],
      local: true,
    });
    expect(s.sent.length).toBe(before);
    h.c.choose('x');
    expect(h.c.dialog.value).toBeNull();
    expect(s.sent.length).toBe(before);
    // Facing a player selects them (whisper, party, challenge actions).
    s.deliver(
      snap({
        you: { p: 'me', x: 1, y: 2, dir: 'e' },
        players: [{ p: 'ann', name: 'Ann', x: 2, y: 2, dir: 'w', battling: false, level: 3 }],
      }),
    );
    expect(h.c.interact()).toBe(true);
    expect(h.c.selected.value).toBe('ann');
    expect(s.sent.length).toBe(before);
  });

  it('R-WORLD-005 keeps quest progress with the zone text and shows rewards', async () => {
    const got: unknown[] = [];
    const h = setup({ onReward: (r) => got.push(r) });
    const s = await joined(h);
    s.deliver({
      t: 'quest',
      d: { id: 'first_steps', step: 1, done: false, text: 'Find the Academy.' },
    });
    expect(h.c.quests.value).toEqual([
      { id: 'first_steps', step: 1, done: false, text: 'Find the Academy.' },
    ]);
    const reward = {
      xp: 50,
      level: 2,
      levelUp: true,
      items: [],
      cards: [{ id: 'hit_and_run', qty: 1 }],
      keyItems: [],
      coins: 10,
    };
    s.deliver({ t: 'reward', d: reward });
    expect(got).toEqual([reward]);
    expect(h.c.toasts.value).toEqual([{ id: 1, kind: 'reward', reward }]);
    s.deliver({ t: 'err', d: { code: 'too_far' } });
    expect(h.c.toasts.value.at(-1)).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/in front/),
    });
    h.c.dismissToast(1);
    expect(h.c.toasts.value.map((t) => t.kind)).toEqual(['error']);
  });
});

describe('WorldController parties and challenges (R-WORLD-004, R-WORLD-006)', () => {
  it('R-WORLD-004 invites, answers invites, shows the party and leaves it', async () => {
    const h = setup();
    const s = await joined(h);
    h.c.invite('ann');
    expect(s.sent.at(-1)).toMatchObject({ t: 'party', d: { op: 'invite', to: 'ann' } });
    s.deliver({ t: 'partyInvite', d: { id: 'i1', from: 'bob', name: 'Bob' } });
    s.deliver({ t: 'partyInvite', d: { id: 'i1', from: 'bob', name: 'Bob' } });
    expect(h.c.invites.value).toHaveLength(1);
    h.c.replyInvite('i1', true);
    expect(s.sent.at(-1)).toMatchObject({ t: 'party', d: { op: 'reply', id: 'i1', accept: true } });
    expect(h.c.invites.value).toEqual([]);
    s.deliver({
      t: 'party',
      d: {
        id: 'pt1',
        leader: 'bob',
        members: [
          { p: 'bob', name: 'Bob', zone: 'academy' },
          { p: 'me', name: 'Me', zone: 'academy' },
        ],
      },
    });
    expect(h.c.party.value).toMatchObject({ id: 'pt1', leader: 'bob' });
    h.c.leaveParty();
    expect(s.sent.at(-1)).toMatchObject({ t: 'party', d: { op: 'leave' } });
    s.deliver({ t: 'party', d: { id: null, leader: null, members: [] } });
    expect(h.c.party.value).toBeNull();
  });

  it('R-WORLD-006 challenges, answers challenges and shows the challenge-zone banner', async () => {
    const h = setup();
    const s = await joined(h);
    h.c.challenge('ann', 'vanguard');
    expect(s.sent.at(-1)).toMatchObject({ t: 'chal', d: { to: 'ann', format: 'vanguard' } });
    s.deliver({ t: 'chalIn', d: { id: 'c1', from: 'bob', name: 'Bob', format: 'first_blood' } });
    expect(h.c.challenges.value).toHaveLength(1);
    h.c.replyChallenge('c1', false);
    expect(s.sent.at(-1)).toMatchObject({ t: 'chalReply', d: { id: 'c1', accept: false } });
    expect(h.c.challenges.value).toEqual([]);
    s.deliver({ t: 'banner', d: { kind: 'challengeZone', inside: true } });
    expect(h.c.challengeZone.value).toBe(true);
    expect(h.c.banner.value).toEqual({ inside: true, at: h.clock.t });
    s.deliver({ t: 'banner', d: { kind: 'challengeZone', inside: false } });
    expect(h.c.challengeZone.value).toBe(false);
  });

  it('R-WORLD-001 dispose closes the socket and never reconnects', async () => {
    const h = setup();
    const s = await joined(h);
    h.c.dispose();
    expect(s.closed).toEqual({ code: 1000 });
    expect(h.c.connection.value).toBe('closed');
    expect(h.timers).toEqual([]);
  });
});
