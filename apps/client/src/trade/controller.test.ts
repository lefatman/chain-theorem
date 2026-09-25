/**
 * TradeController against a scripted TradeSession (M6 6.1; spec 10.4, 9.5): the first connect uses
 * the ticket that came with the invitation, every reconnect asks for a fresh one (R-SEC-006); marks
 * and confirmations always name the revision the player is looking at, so a change by the other
 * side makes a stale confirmation fail on the server (R-WORLD-004); a finished session never
 * reconnects. Every message the client sends is validated with the protocol's schemas.
 */
import { describe, expect, it } from 'vitest';
import { ClientTrade, ServerTrade, decode, encode, type Msg } from '@chain-theorem/protocol';
import { CLOSE_DONE, TradeController, type SocketLike, type TradeState } from './controller.ts';

type Sent = Msg<typeof ClientTrade>;

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Sent[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string): void {
    const m = decode(ClientTrade, data);
    if (!m) throw new Error(`client sent an invalid message: ${data}`);
    this.sent.push(m);
  }
  close(code?: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: Msg<typeof ServerTrade>): void {
    this.onmessage?.({ data: encode(ServerTrade, msg) });
  }
}

function tstate(over: Partial<TradeState> = {}): TradeState {
  return {
    id: 't1',
    mode: 'trade',
    format: null,
    rev: 3,
    phase: 'open',
    me: { name: 'Ana', offer: { items: [], cards: [] }, ready: false, confirmed: false },
    them: {
      name: 'Ben',
      level: 4,
      offer: { items: [], cards: [] },
      ready: false,
      confirmed: false,
      here: true,
    },
    reset: null,
    failure: null,
    expiresAt: 0,
    ...over,
  };
}

function harness() {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  let tickets = 0;
  const c = new TradeController({
    id: 't1',
    mode: 'trade',
    url: '/ws/trade/t1?t=first',
    ticket: async () => ({ url: `/ws/trade/t1?t=fresh${++tickets}` }),
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { c, sockets, timers, tickets: () => tickets };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TradeController (M6)', () => {
  it('R-SEC-006 uses the invitation ticket first and a fresh ticket for every reconnect', async () => {
    const h = harness();
    await flush();
    expect(h.sockets[0]?.url).toBe('/ws/trade/t1?t=first');
    h.sockets[0]?.open();
    expect(h.sockets[0]?.sent).toEqual([{ t: 'hello', s: 0, d: {} }]);
    h.sockets[0]?.drop();
    expect(h.c.connection.value).toBe('reconnecting');
    h.timers.shift()?.();
    await flush();
    expect(h.sockets[1]?.url).toBe('/ws/trade/t1?t=fresh1');
    h.sockets[1]?.open();
    expect(h.c.connection.value).toBe('open');
    expect(h.sockets[1]?.sent.map((m) => m.t)).toEqual(['hello']);
  });

  it('R-WORLD-004 marks and confirmations name the revision on screen; offers replace the whole side', async () => {
    const h = harness();
    await flush();
    const ws = h.sockets[0] as FakeSocket;
    ws.open();
    expect(h.c.ready(true)).toBe(false); // no state yet: nothing to mark
    ws.deliver({ t: 'tstate', d: tstate({ rev: 3 }) });
    h.c.offer({ items: [{ id: 'quick_boots', qty: 1 }], cards: [] });
    h.c.ready(true);
    ws.deliver({
      t: 'tstate',
      d: tstate({ rev: 4, reset: 'them', them: { ...tstate().them, ready: false } }),
    });
    h.c.confirm();
    expect(ws.sent.slice(1).map((m) => [m.t, m.d])).toEqual([
      ['offer', { items: [{ id: 'quick_boots', qty: 1 }], cards: [] }],
      ['ready', { rev: 3, on: true }],
      ['confirm', { rev: 4 }],
    ]);
    ws.deliver({ t: 'err', d: { code: 'stale' } });
    expect(h.c.error.value).toMatch(/changed/);
    ws.deliver({ t: 'tstate', d: tstate({ rev: 5 }) });
    expect(h.c.error.value).toBeNull();
    expect(h.c.state.value?.reset).toBeNull();
  });

  it('R-WORLD-004 R-FMT-006 a finished session keeps its result and never reconnects', async () => {
    const h = harness();
    await flush();
    const ws = h.sockets[0] as FakeSocket;
    ws.open();
    ws.deliver({ t: 'tstate', d: tstate({ mode: 'wager', format: 'first_blood' }) });
    ws.deliver({
      t: 'tdone',
      d: { mode: 'wager', battleId: 'b1', url: '/ws/battle/b1?t=x' },
    });
    ws.drop(CLOSE_DONE);
    expect(h.c.done.value).toEqual({ mode: 'wager', battleId: 'b1', url: '/ws/battle/b1?t=x' });
    expect(h.c.connection.value).toBe('closed');
    expect(h.timers).toEqual([]);
    expect(h.c.offer({ items: [], cards: [] })).toBe(false);

    const k = harness();
    await flush();
    const w2 = k.sockets[0] as FakeSocket;
    w2.open();
    w2.deliver({ t: 'tend', d: { reason: 'declined', by: 'them' } });
    w2.drop(CLOSE_DONE);
    expect(k.c.ended.value).toEqual({ reason: 'declined', by: 'them' });
    expect(k.timers).toEqual([]);
  });

  it('R-SEC-006 a session that is gone stops instead of retrying forever', async () => {
    const sockets: FakeSocket[] = [];
    const timers: (() => void)[] = [];
    const c = new TradeController({
      id: 't2',
      mode: 'trade',
      url: '/ws/trade/t2?t=first',
      ticket: async () => {
        throw Object.assign(new Error('closed'), { status: 409 });
      },
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      setTimer: (fn) => {
        timers.push(fn);
        return 1;
      },
    });
    await flush();
    sockets[0]?.drop();
    timers.shift()?.();
    await flush();
    expect(c.connection.value).toBe('closed');
    expect(c.error.value).toMatch(/no longer open/);
    c.dispose();
  });
});
