/**
 * SpectatorController against a scripted BattleRoom spectator socket (M7 7.2): it sends nothing but
 * `hello` (R-NET-001 replay from the last index shown), fetches a fresh ticket per connect
 * (R-SEC-006), holds only spectator projections (R-INFO-005), cannot act in the battle, and stops at
 * the result or when the battle cannot be watched. Server messages are built with the real engine's
 * projectSpectator()/projectSpectatorEvents(), as the BattleRoom sends them.
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { ClientSpectate, ServerSpectate, decode, encode, type Msg } from '@chain-theorem/protocol';
import { uciToMove, type Loadout } from '@chain-theorem/rules';
import type { SocketLike } from './online.ts';
import { SpectatorController, boardState } from './spectate.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Msg<typeof ClientSpectate>[] = [];
  readonly raw: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string): void {
    this.raw.push(data);
    const m = decode(ClientSpectate, data);
    if (!m) throw new Error(`spectator sent a non-spectator message: ${data}`);
    this.sent.push(m);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: Msg<typeof ServerSpectate>): void {
    this.onmessage?.({ data: encode(ServerSpectate, msg) });
  }
}

const HIDDEN: Loadout = {
  elements: ['grove'],
  items: ['dual_adepts_glove'],
  sets: [['veil', 'poisoned_meat']],
};
const PLAIN: Loadout = { elements: ['tide'], items: [], sets: [[]] };
const players = { white: { name: 'Ada', level: 30 }, black: { name: 'Bo', level: 30 } };

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function setup(fail?: () => Error) {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  let tickets = 0;
  const c = new SpectatorController({
    battleId: 'b1',
    connectUrl: async () => {
      if (fail) throw fail();
      return `wss://x/ws/spectate/b1?t=ticket${++tickets}`;
    },
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => undefined,
  });
  return { c, sockets, timers };
}

describe('spectator controller (M7 7.2)', () => {
  it('R-INFO-005 R-NET-001 says hello, draws the spectator projection, logs delayed events and cannot act', async () => {
    const { c, sockets } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    expect(s.sent).toEqual([{ t: 'hello', d: { from: 0 } }]);
    const start = engine.newBattle({
      format: 'full',
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { level: 30, loadout: PLAIN },
      black: { level: 30, loadout: HIDDEN },
    });
    const pub0 = engine.projectSpectator(start.state);
    s.deliver({
      t: 'sstart',
      d: {
        battleId: 'b1',
        format: 'full',
        public: pub0 as unknown as Record<string, unknown>,
        players,
        delay: 2,
        eventCount: start.events.length,
        clocks: null,
        watchers: 4,
      },
    });
    const events0 = engine.projectSpectatorEvents(start.state, start.events);
    s.deliver({
      t: 'sev',
      d: {
        from: 0,
        to: start.events.length,
        events: events0 as unknown as Record<string, unknown>[],
        public: pub0 as unknown as Record<string, unknown>,
        clocks: null,
      },
    });
    let snap = c.snapshot.value;
    expect(snap.names).toEqual({ white: 'Ada', black: 'Bo' });
    expect(snap.spectate).toEqual({ delay: 2, watchers: 4 });
    expect(snap.controls).toEqual([]);
    expect(snap.pub.legal).toEqual([]);
    expect(snap.pub.armies.white.loadout).toBeUndefined();
    expect(snap.pub.armies.black.loadout).toBeUndefined();

    // The veiled Poisoned Meat fires, shown unnamed.
    const r = engine.applyAction(start.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('c3d5'),
    });
    const updates: number[] = [];
    c.onUpdate((u) => updates.push(u.events.length));
    const evs = engine.projectSpectatorEvents(r.state, r.events);
    const to = start.events.length + r.events.length;
    s.deliver({
      t: 'sev',
      d: {
        from: start.events.length,
        to,
        events: evs as unknown as Record<string, unknown>[],
        public: engine.projectSpectator(r.state) as unknown as Record<string, unknown>,
        clocks: { white: 60_000, black: 59_000, running: null, at: 1, inc: 0 },
      },
    });
    snap = c.snapshot.value;
    expect(updates).toEqual([evs.length]);
    expect(snap.log.length).toBe(events0.length + evs.length);
    expect(snap.log.map((l) => l.text).join(' ')).toContain('an unknown ability');
    expect(JSON.stringify(snap)).not.toContain('poisoned_meat');
    expect(snap.clocks).toMatchObject({ white: 60_000, black: 59_000, running: null });

    // Read-only: nothing leaves the socket.
    c.move();
    c.resign();
    c.offerDraw();
    c.answer();
    expect(s.raw).toHaveLength(1);
    c.dispose();
  });

  it('R-SEC-006 R-NET-001 reconnects with a fresh ticket from the last event shown, and stops at the result', async () => {
    const { c, sockets, timers } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    const { state, events } = engine.newBattle({
      format: 'first_blood',
      white: { level: 1, loadout: PLAIN },
      black: { level: 1, loadout: PLAIN },
    });
    const pub = engine.projectSpectator(state) as unknown as Record<string, unknown>;
    s.deliver({
      t: 'sev',
      d: {
        from: 0,
        to: events.length,
        events: engine.projectSpectatorEvents(state, events) as unknown as Record<
          string,
          unknown
        >[],
        public: pub,
        clocks: null,
      },
    });
    s.close();
    expect(c.snapshot.value.connection).toBe('reconnecting');
    (timers.shift() as () => void)();
    await flush();
    const s2 = sockets[1] as FakeSocket;
    expect(s2.url).toMatch(/ticket2$/);
    s2.open();
    expect(s2.sent).toEqual([{ t: 'hello', d: { from: events.length } }]);
    s2.deliver({ t: 'watchers', d: { count: 7 } });
    expect(c.snapshot.value.spectate?.watchers).toBe(7);
    s2.deliver({ t: 'send', d: { result: { winner: 'black', reason: 'resign' } } });
    expect(c.snapshot.value.status).toBe('ended');
    expect(c.snapshot.value.result).toEqual({ winner: 'black', reason: 'resign' });
    expect(c.snapshot.value.connection).toBe('closed');
    expect(timers).toHaveLength(0);
    c.dispose();
  });

  it('R-INFO-005 a battle that cannot be watched stops the controller with a notice', async () => {
    const { c, sockets } = setup();
    await flush();
    (sockets[0] as FakeSocket).open();
    (sockets[0] as FakeSocket).deliver({ t: 'err', d: { code: 'not_public' } });
    expect(c.snapshot.value.notice).toMatch(/can no longer be watched/);
    expect(c.snapshot.value.connection).toBe('closed');
    const gone = setup(() => Object.assign(new Error('not_found'), { code: 'not_found' }));
    await flush();
    expect(gone.sockets).toHaveLength(0);
    expect(gone.c.snapshot.value.notice).toMatch(/can no longer be watched/);
    expect(gone.timers).toHaveLength(0);
  });

  it('R-INFO-005 the board state from a spectator projection has no legal moves and turns with the flip', () => {
    const { state } = engine.newBattle({
      format: 'full',
      white: { level: 30, loadout: PLAIN },
      black: { level: 30, loadout: HIDDEN },
    });
    const spec = engine.projectSpectator(state);
    expect(boardState(spec, 'black')).toMatchObject({ viewer: 'black', legal: [] });
    const { c } = setup();
    expect(c.snapshot.value.viewer).toBe('white');
    c.flip();
    expect(c.snapshot.value.viewer).toBe('black');
    c.dispose();
  });
});
