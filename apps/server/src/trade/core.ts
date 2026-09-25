/**
 * TradeCore (M6 6.1): one trade or wager negotiation as a pure state machine. No Cloudflare API, no
 * clock and no I/O: the TradeSession Durable Object passes the time in, sends the returned messages,
 * runs the returned effects and stores `snapshot()` when an outbox says `save`.
 *
 * - 10.4 (R-WORLD-004): each player edits only their own offer of items and ability cards; ANY
 *   change to either offer (or to a wager's format) resets both players' ready marks and
 *   confirmations and bumps the revision; the trade runs only when both marked the current revision
 *   ready and then both confirmed it. The database decides at the end (one atomic list, R-SEC-004).
 * - 9.5 (R-FMT-006, COMMITTED): the same negotiation in `wager` mode with a format: both players
 *   stake something and both confirm (explicit consent, even inside challenge zones). Stakes are
 *   visible to both players; nothing here ever says whether an item is equipped, and no loadout is
 *   ever sent (R-SEC-001).
 * - R-SEC-005: a token bucket per side (5 messages per second, burst 10); excess and invalid frames
 *   are dropped and counted; a repeat offender is closed.
 * - Alarms only (R-COST-002): the invitation lapses after INVITE_TTL_MS, an idle session after
 *   IDLE_TTL_MS; an execution interrupted by a restart is resumed by a watchdog.
 */
import { abilities as allAbilities, items as allItems } from '@chain-theorem/content';
import {
  ClientTrade,
  LIMITS,
  type ClientTradeMap,
  type Msg,
  type Offer,
  type TradeErrCode,
  TradeErr,
  decode,
  newBucket,
  strike,
  take,
  tooManyStrikes,
} from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';
import type {
  ExecResult,
  Outbox,
  Owned,
  ServerMsg,
  TradeInit,
  TradeSide,
  TradeSnapshot,
} from './types.ts';

/** The invitee must join within this long (10.4). */
export const INVITE_TTL_MS = 2 * 60_000;
/** A session with no change and no message for this long expires. */
export const IDLE_TTL_MS = 10 * 60_000;
/** An execution not reported back within this long (a restart mid-way) is run again. */
export const EXEC_WATCHDOG_MS = 15_000;
/** A finished session's storage is deleted this long after the end. */
export const PURGE_AFTER_MS = 60_000;
/** Close code for a finished session; clients do not reconnect. */
export const CLOSE_DONE = 4100;
/** Close code for a repeat offender (R-SEC-005). */
export const CLOSE_POLICY = 1008;

type ClientMsg = Msg<ClientTradeMap>;

/** Ids a player may put in an offer: current (not retired) items and ability cards. */
export interface KnownModules {
  items: ReadonlySet<string>;
  cards: ReadonlySet<string>;
}

export const CONTENT_MODULES: KnownModules = {
  items: new Set(allItems.filter((i) => !i.retired).map((i) => i.id)),
  cards: new Set(allAbilities.filter((a) => !a.retired).map((a) => a.id)),
};

export interface TradeOptions {
  known?: KnownModules;
  /** Observer of every queued message (tests: schema checks). Never used to send anything. */
  observe?: (to: TradeSide, msg: ServerMsg) => void;
}

const SIDES: readonly TradeSide[] = ['a', 'b'];
const other = (s: TradeSide): TradeSide => (s === 'a' ? 'b' : 'a');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const EMPTY: Offer = { items: [], cards: [] };

function checkTime(now: number): number {
  if (!Number.isFinite(now)) throw new Error(`TradeCore: bad time ${String(now)}`);
  return now;
}

/** Merges repeated ids and sorts lines by id, so equal offers compare equal. */
export function normalizeOffer(o: Offer): Offer {
  const sum = (lines: Offer['items']) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.id, (m.get(l.id) ?? 0) + l.qty);
    return [...m]
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([id, qty]) => ({ id, qty }));
  };
  return { items: sum(o.items), cards: sum(o.cards) };
}

export function isEmptyOffer(o: Offer): boolean {
  return o.items.length === 0 && o.cards.length === 0;
}

const sameOffer = (x: Offer, y: Offer) => JSON.stringify(x) === JSON.stringify(y);

/** Why `offer` is not acceptable for a player who owns `owned`, or null. */
export function offerProblem(
  offer: Offer,
  owned: Owned | null,
  known: KnownModules,
): TradeErrCode | null {
  for (const l of offer.items) if (!known.items.has(l.id)) return TradeErr.unknown;
  for (const l of offer.cards) if (!known.cards.has(l.id)) return TradeErr.unknown;
  if (!owned) return TradeErr.not_owned;
  for (const l of offer.items) if ((owned.items[l.id] ?? 0) < l.qty) return TradeErr.not_owned;
  for (const l of offer.cards) if ((owned.cards[l.id] ?? 0) < l.qty) return TradeErr.not_owned;
  return null;
}

function emptyOutbox(): Outbox {
  return { send: [], effects: [], save: false };
}

export class TradeCore {
  private readonly s: TradeSnapshot;
  private readonly known: KnownModules;
  private readonly observe: TradeOptions['observe'];
  private out: Outbox = emptyOutbox();

  private constructor(s: TradeSnapshot, opts: TradeOptions) {
    this.s = s;
    this.known = opts.known ?? CONTENT_MODULES;
    this.observe = opts.observe;
  }

  /** A new session: the invitation is out, `a`'s side is open for editing. */
  static create(init: TradeInit, now: number, opts: TradeOptions = {}): TradeCore {
    const t = checkTime(now);
    if (init.a.id === init.b.id)
      throw new Error('TradeCore: a player cannot trade with themselves');
    if (!init.id || init.id.length > 64) throw new Error('TradeCore: bad id');
    const format: FormatId | null = init.mode === 'wager' ? (init.format ?? 'first_blood') : null;
    return new TradeCore(
      {
        v: 1,
        id: init.id,
        mode: init.mode,
        format,
        parties: { a: clone(init.a), b: clone(init.b) },
        offers: { a: clone(EMPTY), b: clone(EMPTY) },
        owned: { a: null, b: null },
        ready: { a: false, b: false },
        confirmed: { a: false, b: false },
        connected: { a: false, b: false },
        phase: 'invited',
        rev: 0,
        reset: null,
        failure: null,
        attempt: 0,
        createdAt: t,
        touchedAt: t,
        endedAt: null,
        now: t,
        buckets: { a: newBucket(LIMITS.battle, t), b: newBucket(LIMITS.battle, t) },
      },
      opts,
    );
  }

  static restore(snapshot: TradeSnapshot, opts: TradeOptions = {}): TradeCore {
    if (snapshot.v !== 1) throw new Error(`TradeCore: unknown snapshot version ${snapshot.v}`);
    return new TradeCore(clone(snapshot), opts);
  }

  snapshot(): TradeSnapshot {
    return clone(this.s);
  }

  get id(): string {
    return this.s.id;
  }

  get phase(): TradeSnapshot['phase'] {
    return this.s.phase;
  }

  get mode(): TradeSnapshot['mode'] {
    return this.s.mode;
  }

  get over(): boolean {
    const p = this.s.phase;
    return p === 'done' || p === 'cancelled' || p === 'expired';
  }

  /** The side a player sits on, or null for anyone else. */
  sideOf(playerId: string): TradeSide | null {
    if (this.s.parties.a.id === playerId) return 'a';
    if (this.s.parties.b.id === playerId) return 'b';
    return null;
  }

  party(side: TradeSide): TradeSnapshot['parties'][TradeSide] {
    return clone(this.s.parties[side]);
  }

  /** When the host must call `alarm` next (epoch ms), or null. */
  nextAlarm(): number | null {
    const s = this.s;
    switch (s.phase) {
      case 'invited':
        return Math.min(s.createdAt + INVITE_TTL_MS, s.touchedAt + IDLE_TTL_MS);
      case 'open':
        return s.touchedAt + IDLE_TTL_MS;
      case 'executing':
        return s.touchedAt + EXEC_WATCHDOG_MS;
      default:
        return s.endedAt === null ? null : s.endedAt + PURGE_AFTER_MS;
    }
  }

  // ---- host inputs --------------------------------------------------------------------------------

  /**
   * A socket for `side` opened (the ticket was checked, R-SEC-006), with that player's inventory
   * as the database has it now. The invitee's first connect accepts the invitation.
   */
  connect(side: TradeSide, owned: Owned, now: number): Outbox {
    this.begin(now);
    const s = this.s;
    s.connected[side] = true;
    s.owned[side] = clone(owned);
    if (!this.over) {
      if (s.phase === 'invited' && side === 'b') s.phase = 'open';
      s.touchedAt = s.now;
      this.state(other(side));
    }
    this.out.save = true;
    return this.flush();
  }

  /** The last socket of `side` closed. The session stays open until it expires or is cancelled. */
  disconnect(side: TradeSide, now: number): Outbox {
    this.begin(now);
    if (!this.s.connected[side]) return this.flush();
    this.s.connected[side] = false;
    this.out.save = true;
    if (!this.over) this.state(other(side));
    return this.flush();
  }

  /** Fresh inventories from the database (after a failed attempt, or anything else changed). */
  setOwned(side: TradeSide, owned: Owned, now: number): Outbox {
    this.begin(now);
    this.s.owned[side] = clone(owned);
    this.out.save = true;
    return this.flush();
  }

  /** One frame from `side`. Invalid or excess frames are dropped and counted (R-SEC-005). */
  message(side: TradeSide, raw: unknown, now: number): Outbox {
    this.begin(now);
    const bucket = this.s.buckets[side];
    if (!take(bucket, LIMITS.battle, this.s.now)) {
      this.err(side, TradeErr.rate_limited);
      this.checkStrikes(side);
      return this.flush();
    }
    const msg = decode(ClientTrade, raw);
    if (!msg) {
      strike(bucket);
      this.err(side, TradeErr.bad_message);
      this.checkStrikes(side);
      return this.flush();
    }
    this.handle(side, msg);
    return this.flush();
  }

  /** End the session on behalf of `side` (REST decline, a failed invitation). */
  cancelBy(side: TradeSide, now: number): Outbox {
    this.begin(now);
    this.cancel(side);
    return this.flush();
  }

  /** The host ran an `execute` effect. */
  executed(result: ExecResult, now: number): Outbox {
    this.begin(now);
    const s = this.s;
    if (s.phase !== 'executing') {
      this.error(`executed while ${s.phase}`);
      return this.flush();
    }
    this.out.save = true;
    if (!result.ok) {
      s.phase = 'open';
      s.rev++;
      s.ready = { a: false, b: false };
      s.confirmed = { a: false, b: false };
      s.reset = null;
      s.failure = result.code;
      s.touchedAt = s.now;
      for (const side of SIDES) this.err(side, result.code);
      this.states();
      return this.flush();
    }
    s.phase = 'done';
    s.endedAt = s.now;
    s.failure = null;
    for (const side of SIDES) {
      if (result.mode === 'trade')
        this.send(side, {
          t: 'tdone',
          d: {
            mode: 'trade',
            got: clone(s.offers[other(side)]),
            gave: clone(s.offers[side]),
            invalid: result.invalid[side].slice(0, 5),
          },
        });
      else
        this.send(side, {
          t: 'tdone',
          d: { mode: 'wager', battleId: result.battleId, url: result.urls[side] },
        });
    }
    this.states();
    this.closeAll('done');
    return this.flush();
  }

  /** Deadlines: the invitation or an idle session expires; the execution watchdog; the purge. */
  alarm(now: number): Outbox {
    this.begin(now);
    const s = this.s;
    const due = this.nextAlarm();
    if (due === null || s.now < due) return this.flush();
    if (s.phase === 'invited' || s.phase === 'open') {
      s.phase = 'expired';
      s.endedAt = s.now;
      this.out.save = true;
      for (const side of SIDES) this.send(side, { t: 'tend', d: { reason: 'expired', by: null } });
      this.states();
      this.closeAll('expired');
    } else if (s.phase === 'executing') {
      // A restart interrupted the run: ask the host again (its steps are idempotent).
      s.touchedAt = s.now;
      this.out.save = true;
      this.out.effects.push(this.executeEffect());
    } else {
      this.out.effects.push({ kind: 'purge' });
    }
    return this.flush();
  }

  // ---- messages -----------------------------------------------------------------------------------

  private handle(side: TradeSide, msg: ClientMsg): void {
    const s = this.s;
    switch (msg.t) {
      case 'hello':
        this.state(side);
        return;
      case 'offer': {
        if (!this.editable()) return this.refuse(side, TradeErr.not_open);
        const offer = normalizeOffer(msg.d);
        const problem = offerProblem(offer, s.owned[side], this.known);
        if (problem) return this.refuse(side, problem);
        if (sameOffer(offer, s.offers[side])) return this.state(side);
        s.offers[side] = offer;
        this.changed(side);
        return;
      }
      case 'format': {
        if (s.mode !== 'wager') return this.refuse(side, TradeErr.not_wager);
        if (!this.editable()) return this.refuse(side, TradeErr.not_open);
        if (msg.d.format === s.format) return this.state(side);
        s.format = msg.d.format;
        this.changed(side);
        return;
      }
      case 'ready': {
        if (s.phase !== 'open') return this.refuse(side, TradeErr.not_open);
        if (msg.d.rev !== s.rev) return this.refuse(side, TradeErr.stale);
        s.touchedAt = s.now;
        this.out.save = true;
        if (msg.d.on) s.ready[side] = true;
        else {
          // Withdrawing a ready mark withdraws both confirmations (confirming needs both ready).
          s.ready[side] = false;
          s.confirmed = { a: false, b: false };
        }
        this.states();
        return;
      }
      case 'confirm': {
        if (s.phase !== 'open') return this.refuse(side, TradeErr.not_open);
        if (msg.d.rev !== s.rev) return this.refuse(side, TradeErr.stale);
        if (!s.ready.a || !s.ready.b) return this.refuse(side, TradeErr.not_ready);
        if (s.mode === 'trade' && isEmptyOffer(s.offers.a) && isEmptyOffer(s.offers.b))
          return this.refuse(side, TradeErr.empty);
        if (s.mode === 'wager' && (isEmptyOffer(s.offers.a) || isEmptyOffer(s.offers.b)))
          return this.refuse(side, TradeErr.no_stakes);
        const problem = offerProblem(s.offers[side], s.owned[side], this.known);
        if (problem) return this.refuse(side, problem);
        s.confirmed[side] = true;
        s.touchedAt = s.now;
        this.out.save = true;
        if (s.confirmed.a && s.confirmed.b) {
          s.phase = 'executing';
          s.attempt++;
          s.failure = null;
          this.out.effects.push(this.executeEffect());
        }
        this.states();
        return;
      }
      case 'cancel':
        if (this.over || s.phase === 'executing') return this.refuse(side, TradeErr.not_open);
        this.cancel(side);
        return;
    }
  }

  private editable(): boolean {
    return this.s.phase === 'invited' || this.s.phase === 'open';
  }

  /** An offer or the format changed: new revision, every mark cleared (10.4, 9.5). */
  private changed(by: TradeSide): void {
    const s = this.s;
    const hadMarks = s.ready.a || s.ready.b || s.confirmed.a || s.confirmed.b;
    s.rev++;
    s.ready = { a: false, b: false };
    s.confirmed = { a: false, b: false };
    s.reset = hadMarks ? by : null;
    s.failure = null;
    s.touchedAt = s.now;
    this.out.save = true;
    this.states();
  }

  private cancel(by: TradeSide): void {
    const s = this.s;
    if (this.over || s.phase === 'executing') return;
    const declined = s.phase === 'invited' && by === 'b';
    s.phase = 'cancelled';
    s.endedAt = s.now;
    this.out.save = true;
    for (const side of SIDES)
      this.send(side, {
        t: 'tend',
        d: { reason: declined ? 'declined' : 'cancelled', by: side === by ? 'you' : 'them' },
      });
    this.states();
    this.closeAll('cancelled');
  }

  private executeEffect(): Extract<Outbox['effects'][number], { kind: 'execute' }> {
    const s = this.s;
    return {
      kind: 'execute',
      mode: s.mode,
      format: s.format,
      offers: clone(s.offers),
      attempt: s.attempt,
    };
  }

  // ---- views --------------------------------------------------------------------------------------

  /** The session as `side` sees it: both offers and marks, never an inventory or a loadout. */
  view(side: TradeSide): Extract<ServerMsg, { t: 'tstate' }>['d'] {
    const s = this.s;
    const o = other(side);
    const due = this.nextAlarm();
    return {
      id: s.id,
      mode: s.mode,
      format: s.format,
      rev: s.rev,
      phase: s.phase,
      me: {
        name: s.parties[side].name,
        offer: clone(s.offers[side]),
        ready: s.ready[side],
        confirmed: s.confirmed[side],
      },
      them: {
        name: s.parties[o].name,
        level: s.parties[o].level,
        offer: clone(s.offers[o]),
        ready: s.ready[o],
        confirmed: s.confirmed[o],
        here: s.connected[o],
      },
      reset: s.reset === null ? null : s.reset === side ? 'you' : 'them',
      failure: s.failure,
      expiresAt: due ?? s.now,
    };
  }

  private state(side: TradeSide): void {
    this.send(side, { t: 'tstate', d: this.view(side) });
  }

  private states(): void {
    for (const side of SIDES) this.state(side);
  }

  // ---- plumbing -----------------------------------------------------------------------------------

  private begin(now: number): void {
    this.s.now = Math.max(checkTime(now), this.s.now);
    this.out = emptyOutbox();
  }

  private flush(): Outbox {
    const out = this.out;
    this.out = emptyOutbox();
    return out;
  }

  private send(to: TradeSide, msg: ServerMsg): void {
    this.out.send.push({ to, msg });
    this.observe?.(to, msg);
  }

  private err(side: TradeSide, code: TradeErrCode): void {
    this.send(side, { t: 'err', d: { code } });
  }

  /** Refuse a valid message: tell the player why and resend the state they should act on. */
  private refuse(side: TradeSide, code: TradeErrCode): void {
    this.err(side, code);
    this.state(side);
  }

  private closeAll(reason: string): void {
    for (const side of SIDES)
      this.out.effects.push({ kind: 'close', side, code: CLOSE_DONE, reason });
  }

  private checkStrikes(side: TradeSide): void {
    if (tooManyStrikes(this.s.buckets[side]))
      this.out.effects.push({
        kind: 'close',
        side,
        code: CLOSE_POLICY,
        reason: 'too many invalid or excess messages',
      });
  }

  private error(message: string): void {
    this.out.effects.push({ kind: 'error', message });
  }
}
