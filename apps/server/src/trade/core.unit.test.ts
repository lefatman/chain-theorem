/**
 * The pure trade core (M6 6.1): two-step confirmation where any change resets both players' marks
 * (10.4 R-WORLD-004), wager negotiation with explicit consent and visible stakes that never reveal a
 * loadout (9.5 R-FMT-006, R-SEC-001), rate limits (R-SEC-005) and alarm-only expiry (R-COST-002).
 * Every outgoing message is checked against its protocol schema (R-NET-001).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ServerTrade, type Offer } from '@chain-theorem/protocol';
import {
  CLOSE_DONE,
  CLOSE_POLICY,
  EXEC_WATCHDOG_MS,
  IDLE_TTL_MS,
  INVITE_TTL_MS,
  PURGE_AFTER_MS,
  TradeCore,
  type KnownModules,
} from './index.ts';
import type { Outbox, Owned, ServerMsg, TradeInit, TradeSide } from './types.ts';

const T0 = 1_760_000_000_000;
const KNOWN: KnownModules = {
  items: new Set(['quick_boots', 'lantern', 'masquerade_mask']),
  cards: new Set(['scout', 'spark', 'hit_and_run']),
};
const OWNED: Record<TradeSide, Owned> = {
  a: { items: { quick_boots: 2, masquerade_mask: 1 }, cards: { scout: 3 } },
  b: { items: { lantern: 1 }, cards: { spark: 2, hit_and_run: 1 } },
};

let problems: string[] = [];
afterEach(() => {
  expect(problems).toEqual([]);
});

function check(_to: TradeSide, msg: ServerMsg): void {
  const wire = JSON.parse(JSON.stringify(msg)) as { t: string; d: unknown };
  const schema = ServerTrade[wire.t as keyof typeof ServerTrade];
  if (!schema) problems.push(`unknown message ${wire.t}`);
  else {
    const r = schema.safeParse(wire.d);
    if (!r.success) problems.push(`${wire.t}: ${r.error.message}`);
  }
}

const frame = (t: string, d?: unknown) => JSON.stringify(d === undefined ? { t } : { t, d });

class H {
  core: TradeCore;
  t = T0;
  constructor(init: Partial<TradeInit> = {}) {
    problems = [];
    this.core = TradeCore.create(
      {
        id: 'trade-1',
        mode: 'trade',
        a: { id: 'pa', name: 'Ada', level: 5 },
        b: { id: 'pb', name: 'Bo', level: 7 },
        ...init,
      },
      this.t,
      { known: KNOWN, observe: check },
    );
  }
  tick(ms = 300): number {
    this.t += ms;
    return this.t;
  }
  join(): void {
    this.core.connect('a', OWNED.a, this.tick());
    this.core.connect('b', OWNED.b, this.tick());
  }
  send(side: TradeSide, t: string, d?: unknown): Outbox {
    return this.core.message(side, frame(t, d), this.tick());
  }
  rev(): number {
    return this.core.view('a').rev;
  }
}

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;
function msgs<T extends ServerMsg['t']>(out: Outbox, to: TradeSide, t: T): Msg<T>['d'][] {
  return out.send.filter((o) => o.to === to && o.msg.t === t).map((o) => o.msg.d) as Msg<T>['d'][];
}
const last = <T extends ServerMsg['t']>(out: Outbox, to: TradeSide, t: T) =>
  msgs(out, to, t).at(-1);
const offer = (items: [string, number][], cards: [string, number][] = []): Offer => ({
  items: items.map(([id, qty]) => ({ id, qty })),
  cards: cards.map(([id, qty]) => ({ id, qty })),
});

describe('trade negotiation (10.4)', () => {
  it('R-WORLD-004 the invitee joins by connecting; both see both offers', () => {
    const h = new H();
    expect(h.core.phase).toBe('invited');
    h.core.connect('a', OWNED.a, h.tick());
    // The inviter may prepare an offer while the invitation is out.
    const pre = h.send('a', 'offer', offer([['quick_boots', 1]]));
    expect(last(pre, 'a', 'tstate')?.me.offer).toEqual(offer([['quick_boots', 1]]));
    expect(h.send('a', 'ready', { rev: h.rev(), on: true }).send[0]?.msg).toEqual({
      t: 'err',
      d: { code: 'not_open' },
    });
    const joined = h.core.connect('b', OWNED.b, h.tick());
    expect(h.core.phase).toBe('open');
    expect(last(joined, 'a', 'tstate')?.them).toMatchObject({ name: 'Bo', level: 7, here: true });
    const hello = h.send('b', 'hello');
    expect(last(hello, 'b', 'tstate')).toMatchObject({
      phase: 'open',
      me: { name: 'Bo', offer: offer([]) },
      them: { name: 'Ada', offer: offer([['quick_boots', 1]]) },
    });
  });

  it('R-WORLD-004 two-step confirm: both ready, then both confirm, then it runs once', () => {
    const h = new H();
    h.join();
    h.send('a', 'offer', offer([['quick_boots', 1]], [['scout', 2]]));
    h.send('b', 'offer', offer([], [['spark', 1]]));
    const rev = h.rev();
    expect(last(h.send('a', 'confirm', { rev }), 'a', 'err')?.code).toBe('not_ready');
    h.send('a', 'ready', { rev, on: true });
    expect(last(h.send('a', 'confirm', { rev }), 'a', 'err')?.code).toBe('not_ready');
    const bReady = h.send('b', 'ready', { rev, on: true });
    expect(last(bReady, 'a', 'tstate')?.them.ready).toBe(true);
    const first = h.send('a', 'confirm', { rev });
    expect(first.effects).toEqual([]);
    expect(last(first, 'b', 'tstate')?.them.confirmed).toBe(true);
    const both = h.send('b', 'confirm', { rev });
    expect(both.effects).toEqual([
      {
        kind: 'execute',
        mode: 'trade',
        format: null,
        offers: { a: offer([['quick_boots', 1]], [['scout', 2]]), b: offer([], [['spark', 1]]) },
        attempt: 1,
      },
    ]);
    expect(h.core.phase).toBe('executing');
    // Nothing moves while it runs.
    expect(last(h.send('a', 'offer', offer([])), 'a', 'err')?.code).toBe('not_open');
    expect(last(h.send('b', 'cancel'), 'b', 'err')?.code).toBe('not_open');
    const done = h.core.executed(
      { ok: true, mode: 'trade', invalid: { a: ['Main'], b: [] } },
      h.tick(),
    );
    expect(last(done, 'a', 'tdone')).toEqual({
      mode: 'trade',
      got: offer([], [['spark', 1]]),
      gave: offer([['quick_boots', 1]], [['scout', 2]]),
      invalid: ['Main'],
    });
    expect(last(done, 'b', 'tdone')).toMatchObject({
      got: offer([['quick_boots', 1]], [['scout', 2]]),
    });
    expect(done.effects).toEqual([
      { kind: 'close', side: 'a', code: CLOSE_DONE, reason: 'done' },
      { kind: 'close', side: 'b', code: CLOSE_DONE, reason: 'done' },
    ]);
    expect(h.core.phase).toBe('done');
  });

  it('R-WORLD-004 any change to either side resets both confirmations, and says who changed it', () => {
    const h = new H();
    h.join();
    h.send('a', 'offer', offer([['quick_boots', 1]]));
    h.send('b', 'offer', offer([['lantern', 1]]));
    const rev = h.rev();
    h.send('a', 'ready', { rev, on: true });
    h.send('b', 'ready', { rev, on: true });
    h.send('a', 'confirm', { rev });
    // B adds a card: every mark is gone, the revision moves on.
    const change = h.send('b', 'offer', offer([['lantern', 1]], [['spark', 1]]));
    const seenByA = last(change, 'a', 'tstate');
    expect(seenByA).toMatchObject({
      rev: rev + 1,
      reset: 'them',
      me: { ready: false, confirmed: false },
      them: { ready: false, confirmed: false, offer: offer([['lantern', 1]], [['spark', 1]]) },
    });
    expect(last(change, 'b', 'tstate')?.reset).toBe('you');
    // A confirmation of the old revision is refused.
    expect(last(h.send('b', 'confirm', { rev }), 'b', 'err')?.code).toBe('stale');
    expect(last(h.send('a', 'ready', { rev, on: true }), 'a', 'err')?.code).toBe('stale');
    // Removing a line resets too; re-sending the same offer does not.
    const r2 = h.rev();
    h.send('a', 'ready', { rev: r2, on: true });
    const same = h.send('b', 'offer', offer([['lantern', 1]], [['spark', 1]]));
    expect(msgs(same, 'a', 'tstate')).toEqual([]);
    expect(h.core.view('a').me.ready).toBe(true);
    expect(h.rev()).toBe(r2);
    const drop = h.send('a', 'offer', offer([]));
    expect(last(drop, 'b', 'tstate')).toMatchObject({ reset: 'them', them: { ready: false } });
    // Withdrawing a ready mark withdraws both confirmations but is not an offer change.
    const r3 = h.rev();
    h.send('a', 'offer', offer([['quick_boots', 2]]));
    const r4 = h.rev();
    expect(r4).toBe(r3 + 1);
    h.send('a', 'ready', { rev: r4, on: true });
    h.send('b', 'ready', { rev: r4, on: true });
    h.send('b', 'confirm', { rev: r4 });
    const off = h.send('a', 'ready', { rev: r4, on: false });
    expect(last(off, 'b', 'tstate')).toMatchObject({ rev: r4, me: { confirmed: false } });
  });

  it('R-WORLD-004 offers must name real modules the player owns; repeats are merged', () => {
    const h = new H();
    h.join();
    expect(last(h.send('a', 'offer', offer([['sword', 1]])), 'a', 'err')?.code).toBe('unknown');
    expect(last(h.send('a', 'offer', offer([['quick_boots', 3]])), 'a', 'err')?.code).toBe(
      'not_owned',
    );
    expect(last(h.send('a', 'offer', offer([], [['spark', 1]])), 'a', 'err')?.code).toBe(
      'not_owned',
    );
    const merged = h.send(
      'a',
      'offer',
      offer(
        [
          ['quick_boots', 1],
          ['quick_boots', 1],
        ],
        [['scout', 1]],
      ),
    );
    expect(last(merged, 'a', 'tstate')?.me.offer).toEqual(
      offer([['quick_boots', 2]], [['scout', 1]]),
    );
    // An empty trade cannot be confirmed.
    h.send('a', 'offer', offer([]));
    const rev = h.rev();
    h.send('a', 'ready', { rev, on: true });
    h.send('b', 'ready', { rev, on: true });
    expect(last(h.send('a', 'confirm', { rev }), 'a', 'err')?.code).toBe('empty');
    // The inventory can change under an offer: confirming it is refused (the database decides last).
    h.send('a', 'offer', offer([['quick_boots', 2]]));
    const r2 = h.rev();
    h.send('a', 'ready', { rev: r2, on: true });
    h.send('b', 'ready', { rev: r2, on: true });
    h.core.setOwned('a', { items: { quick_boots: 1 }, cards: {} }, h.tick());
    expect(last(h.send('a', 'confirm', { rev: r2 }), 'a', 'err')?.code).toBe('not_owned');
    // Malformed frames are dropped and counted.
    expect(last(h.send('a', 'offer', { items: [{ id: 'X', qty: 1 }] }), 'a', 'err')?.code).toBe(
      'bad_message',
    );
    expect(last(h.send('a', 'format', { format: 'full' }), 'a', 'err')?.code).toBe('not_wager');
  });

  it('R-SEC-004 a failed run reopens the negotiation with every mark cleared', () => {
    const h = new H();
    h.join();
    h.send('a', 'offer', offer([['quick_boots', 1]]));
    const rev = h.rev();
    for (const s of ['a', 'b'] as const) h.send(s, 'ready', { rev, on: true });
    for (const s of ['a', 'b'] as const) h.send(s, 'confirm', { rev });
    h.core.setOwned('a', { items: {}, cards: {} }, h.tick());
    const failed = h.core.executed({ ok: false, code: 'not_owned' }, h.tick());
    expect(h.core.phase).toBe('open');
    expect(last(failed, 'b', 'err')?.code).toBe('not_owned');
    expect(last(failed, 'a', 'tstate')).toMatchObject({
      rev: rev + 1,
      failure: 'not_owned',
      me: { ready: false, confirmed: false },
      them: { ready: false, confirmed: false },
    });
  });
});

describe('item wagers (9.5)', () => {
  it('R-FMT-006 both stake and both confirm; a format change resets; it runs with the format', () => {
    const h = new H({ mode: 'wager', format: 'vanguard' });
    h.join();
    expect(h.core.view('b').format).toBe('vanguard');
    h.send('a', 'offer', offer([['quick_boots', 1]]));
    let rev = h.rev();
    h.send('a', 'ready', { rev, on: true });
    h.send('b', 'ready', { rev, on: true });
    // Explicit consent: a stake from each player.
    expect(last(h.send('a', 'confirm', { rev }), 'a', 'err')?.code).toBe('no_stakes');
    h.send('b', 'offer', offer([], [['spark', 2]]));
    rev = h.rev();
    h.send('a', 'ready', { rev, on: true });
    h.send('b', 'ready', { rev, on: true });
    h.send('a', 'confirm', { rev });
    const fmt = h.send('b', 'format', { format: 'full' });
    expect(last(fmt, 'a', 'tstate')).toMatchObject({
      format: 'full',
      reset: 'them',
      me: { ready: false, confirmed: false },
    });
    rev = h.rev();
    for (const s of ['a', 'b'] as const) h.send(s, 'ready', { rev, on: true });
    h.send('b', 'confirm', { rev });
    const go = h.send('a', 'confirm', { rev });
    expect(go.effects[0]).toMatchObject({
      kind: 'execute',
      mode: 'wager',
      format: 'full',
      offers: { a: offer([['quick_boots', 1]]), b: offer([], [['spark', 2]]) },
    });
    const done = h.core.executed(
      {
        ok: true,
        mode: 'wager',
        battleId: 'battle-1',
        urls: { a: '/ws/battle/battle-1?t=A', b: '/ws/battle/battle-1?t=B' },
      },
      h.tick(),
    );
    expect(last(done, 'a', 'tdone')).toEqual({
      mode: 'wager',
      battleId: 'battle-1',
      url: '/ws/battle/battle-1?t=A',
    });
    expect(last(done, 'b', 'tdone')).toEqual({
      mode: 'wager',
      battleId: 'battle-1',
      url: '/ws/battle/battle-1?t=B',
    });
  });

  it('R-FMT-006 R-SEC-001 stakes are visible to both, but no message names an inventory, a loadout or an equipped item', () => {
    const h = new H({ mode: 'wager' });
    const seen: string[] = [];
    const keep = (out: Outbox) => {
      for (const o of out.send) if (o.to === 'b') seen.push(JSON.stringify(o.msg));
    };
    keep(h.core.connect('a', OWNED.a, h.tick()));
    keep(h.core.connect('b', OWNED.b, h.tick()));
    keep(h.send('b', 'hello'));
    // A stakes the Masquerade Mask (possibly equipped: nothing may say so).
    keep(h.send('a', 'offer', offer([['masquerade_mask', 1]])));
    keep(h.send('b', 'offer', offer([], [['spark', 1]])));
    const rev = h.rev();
    for (const s of ['a', 'b'] as const) keep(h.send(s, 'ready', { rev, on: true }));
    const all = seen.join('\n');
    expect(all).toContain('masquerade_mask');
    // A owns Quick Boots and Scout but did not offer them: B must never learn about them.
    expect(all).not.toContain('quick_boots');
    expect(all).not.toContain('scout');
    expect(all).not.toMatch(/equip|loadout|owned|inventory/i);
  });
});

describe('ending a session', () => {
  it('R-WORLD-004 the invitee declines, or either side cancels: both are told and closed', () => {
    const h = new H();
    h.core.connect('a', OWNED.a, h.tick());
    const decline = h.core.cancelBy('b', h.tick());
    expect(last(decline, 'a', 'tend')).toEqual({ reason: 'declined', by: 'them' });
    expect(decline.effects.map((e) => e.kind)).toEqual(['close', 'close']);
    expect(h.core.over).toBe(true);
    expect(last(h.send('a', 'offer', offer([])), 'a', 'err')?.code).toBe('not_open');

    const k = new H();
    k.join();
    const out = k.send('a', 'cancel');
    expect(last(out, 'b', 'tend')).toEqual({ reason: 'cancelled', by: 'them' });
    expect(last(out, 'a', 'tend')).toEqual({ reason: 'cancelled', by: 'you' });
  });

  it('R-COST-002 alarms only: the invitation lapses, an idle session expires, a finished one is purged', () => {
    const h = new H();
    h.core.connect('a', OWNED.a, h.tick());
    expect(h.core.nextAlarm()).toBe(T0 + INVITE_TTL_MS);
    expect(h.core.alarm(T0 + INVITE_TTL_MS - 1).send).toEqual([]);
    const lapsed = h.core.alarm(T0 + INVITE_TTL_MS);
    expect(last(lapsed, 'a', 'tend')).toEqual({ reason: 'expired', by: null });
    expect(h.core.phase).toBe('expired');
    const ended = h.core.nextAlarm();
    expect(ended).toBe(T0 + INVITE_TTL_MS + PURGE_AFTER_MS);
    expect(h.core.alarm(ended ?? 0).effects).toEqual([{ kind: 'purge' }]);

    const idle = new H();
    idle.join();
    const touched = idle.t;
    expect(idle.core.nextAlarm()).toBe(touched + IDLE_TTL_MS);
    idle.core.alarm(touched + IDLE_TTL_MS);
    expect(idle.core.phase).toBe('expired');
  });

  it('R-SEC-004 an execution interrupted by a restart is asked for again by the watchdog', () => {
    const h = new H();
    h.join();
    h.send('a', 'offer', offer([['quick_boots', 1]]));
    const rev = h.rev();
    for (const s of ['a', 'b'] as const) h.send(s, 'ready', { rev, on: true });
    for (const s of ['a', 'b'] as const) h.send(s, 'confirm', { rev });
    const restored = TradeCore.restore(h.core.snapshot(), { known: KNOWN, observe: check });
    const due = restored.nextAlarm() ?? 0;
    expect(due).toBe(h.t + EXEC_WATCHDOG_MS);
    const again = restored.alarm(due);
    expect(again.effects).toEqual([
      expect.objectContaining({ kind: 'execute', mode: 'trade', attempt: 1 }),
    ]);
  });

  it('R-SEC-005 excess and invalid frames are dropped; a repeat offender is closed', () => {
    const h = new H();
    h.join();
    let closed = false;
    for (let i = 0; i < 80 && !closed; i++) {
      const out = h.core.message('a', 'not json', h.t);
      closed = out.effects.some((e) => e.kind === 'close' && e.code === CLOSE_POLICY);
    }
    expect(closed).toBe(true);
    const flood = new H();
    flood.join();
    const outs = Array.from({ length: 12 }, () => flood.core.message('b', frame('hello'), flood.t));
    expect(outs.filter((o) => o.send.some((m) => m.msg.t === 'err')).length).toBeGreaterThan(0);
  });
});
