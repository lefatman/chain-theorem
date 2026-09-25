/**
 * OnlineController against a scripted BattleRoom (R-NET-001 reconnect replay, R-SEC-006 fresh
 * tickets per connect, R-INFO-005 only projections held). Server messages are built with the real
 * engine's project()/projectEvents(), as the BattleRoom sends them.
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { ClientBattle, ServerBattle, decode, encode, type Msg } from '@chain-theorem/protocol';
import { uciToMove, type GameState, type Loadout } from '@chain-theorem/rules';
import { OnlineController, type SocketLike } from './online.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Msg<typeof ClientBattle>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string): void {
    const m = decode(ClientBattle, data);
    if (!m) throw new Error(`client sent an invalid message: ${data}`);
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
  deliver(msg: Msg<typeof ServerBattle>): void {
    this.onmessage?.({ data: encode(ServerBattle, msg) });
  }
}

const army: Loadout = { elements: ['ember'], items: [], sets: [['hit_and_run']] };
const clocks = {
  white: 180_000,
  black: 180_000,
  running: 'white' as const,
  at: Date.now(),
  inc: 2000,
};

function start(): { state: GameState } {
  const { state } = engine.newBattle({
    format: 'first_blood',
    white: { level: 1, loadout: army },
    black: { level: 1, loadout: army },
    strict: true,
  });
  return { state };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  let tickets = 0;
  const c = new OnlineController({
    battleId: 'b1',
    connectUrl: async () => `wss://x/ws/battle/b1?t=ticket${++tickets}`,
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

describe('online battle controller (R-NET-001)', () => {
  it('R-NET-001 R-INFO-005 says hello, draws the projection and forwards moves', async () => {
    const { c, sockets } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    expect(s.sent[0]).toMatchObject({ t: 'hello', d: { from: 0 } });
    const { state } = start();
    const players = { white: { name: 'Ada', level: 1 }, black: { name: 'Bo', level: 1 } };
    s.deliver({
      t: 'bstart',
      d: {
        battleId: 'b1',
        you: 'white',
        format: 'first_blood',
        public: engine.project(state, 'white') as never,
        clocks,
        players,
        eventCount: 1,
      },
    });
    expect(c.snapshot.value.status).toBe('playing');
    expect(c.snapshot.value.names).toEqual({ white: 'Ada', black: 'Bo' });
    expect(c.snapshot.value.own).toEqual(army);

    const updates: number[] = [];
    c.onUpdate((u) => updates.push(u.events.length));
    const r = engine.applyAction(state, { kind: 'move', side: 'white', move: uciToMove('e2e4') });
    const events = engine.projectEvents(r.state, r.events, 'white');
    s.deliver({
      t: 'bev',
      d: {
        from: 1,
        to: 1 + r.events.length,
        events: events as never,
        public: engine.project(r.state, 'white') as never,
        clocks,
      },
    });
    expect(updates).toEqual([events.length]);
    expect(c.snapshot.value.log.map((l) => l.event.k)).toContain('MoveMade');
    // The same events again (a duplicate after reconnect) are ignored.
    s.deliver({
      t: 'bev',
      d: {
        from: 1,
        to: 1 + r.events.length,
        events: events as never,
        public: engine.project(r.state, 'white') as never,
        clocks,
      },
    });
    expect(updates).toEqual([events.length]);

    c.move('d2d4');
    expect(s.sent.at(-1)).toMatchObject({ t: 'mv', d: { move: 'd2d4' } });
    c.dispose();
  });

  it('R-NET-001 R-SEC-006 reconnects with a fresh ticket and resumes from the last index', async () => {
    const { c, sockets, timers } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    const { state } = start();
    s.deliver({
      t: 'bev',
      d: { from: 0, to: 7, events: [], public: engine.project(state, 'white') as never, clocks },
    });
    s.close();
    expect(c.snapshot.value.connection).toBe('reconnecting');
    expect(timers).toHaveLength(1);
    timers[0]?.();
    await flush();
    const s2 = sockets[1] as FakeSocket;
    expect(s2.url).toContain('ticket2');
    s2.open();
    expect(s2.sent[0]).toMatchObject({ t: 'hello', d: { from: 7 } });
    c.dispose();
  });

  it('R-FMT-003 prompts, draw offers, opponent status, watchers and the result reach the snapshot', async () => {
    const { c, sockets } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    s.deliver({
      t: 'prompt',
      d: {
        promptId: '3.0',
        request: {
          promptId: '3.0',
          chooser: 'white',
          source: { ability: 'momentum', piece: 1, side: 'white' },
          kind: 'bonusMove',
          options: [{ kind: 'decline' }],
          defaultOption: 0,
        },
        deadline: 123,
      },
    });
    expect(c.snapshot.value.prompt).toMatchObject({ promptId: '3.0', deadline: 123 });
    c.answer(0);
    expect(s.sent.at(-1)).toMatchObject({ t: 'ch', d: { promptId: '3.0', option: 0 } });
    expect(c.snapshot.value.prompt).toBeNull();

    s.deliver({ t: 'drawOffer', d: { by: 'black' } });
    expect(c.snapshot.value.drawOffer).toBe('black');
    c.replyDraw(false);
    expect(s.sent.at(-1)).toMatchObject({ t: 'drawReply', d: { accept: false } });

    s.deliver({ t: 'opp', d: { connected: false, graceUntil: 60_000 } });
    expect(c.snapshot.value.opponent).toEqual({ connected: false, graceUntil: 60_000 });

    // A public battle tells the players how many people are watching (DD-92).
    expect(c.snapshot.value.watchers).toBe(0);
    s.deliver({ t: 'watchers', d: { count: 3 } });
    expect(c.snapshot.value.watchers).toBe(3);

    s.deliver({ t: 'bend', d: { result: { winner: 'white', reason: 'abandon' } } });
    expect(c.snapshot.value.status).toBe('ended');
    s.close();
    expect(c.snapshot.value.connection).toBe('closed');
    c.dispose();
  });

  it('R-SEC-002 ignores malformed server frames', async () => {
    const { c, sockets } = setup();
    await flush();
    const s = sockets[0] as FakeSocket;
    s.open();
    s.onmessage?.({ data: 'garbage' });
    s.onmessage?.({ data: JSON.stringify({ t: 'bev', d: { from: 'x' } }) });
    expect(c.snapshot.value.status).toBe('waiting');
    c.dispose();
  });
});
