/**
 * BattleCore (M4 4.2): the whole BattleRoom logic as a pure, deterministic state machine. It has no
 * Cloudflare API, no clock and no I/O: the Durable Object passes the time in (`now`, epoch ms), sends
 * the returned messages, performs the returned effects, persists `snapshot()` plus the log records,
 * and sets its alarm to `nextAlarm()`.
 *
 * - R-INFO-005 / R-SEC-001: every message a side receives is built from `project(state, side)` and
 *   `projectEvents(state, events, side)` only (plus clocks, connection and conduct data that carry no
 *   game state). Prompts go only to the chooser.
 * - R-SEC-002: every client message is validated (schema, turn, prompt id, legality); refused input
 *   answers `err` and changes nothing.
 * - R-SEC-005 / R-NET-001: per-side token buckets (LIMITS.battle); invalid and excess messages are
 *   dropped and counted; a side that keeps offending gets a `close` effect.
 * - R-FMT-003 (9.2): Fischer clocks from server timestamps, no ticking loop: flag fall, the 15 s
 *   prompt window (5.4) and the 60 s disconnect grace are deadlines checked on every input and at the
 *   alarm. A mid-action prompt is charged to the chooser's clock.
 * - R-FMT-005 (9.4): NPC seats answer inside the same call from their own projection only.
 */
import {
  CHOICE_PROMPT_MS,
  DISCONNECT_GRACE_MS,
  DRAW_OFFER_EVERY_MOVES,
  engine as defaultEngine,
} from '@chain-theorem/content';
import {
  BattleErr,
  type ClientBattleMap,
  ClientBattle,
  type Clocks,
  LIMITS,
  type Msg,
  type PlayerTag,
  decode,
  newBucket,
  strike,
  take,
  tooManyStrikes,
} from '@chain-theorem/protocol';
import {
  type ActionInput,
  type ApplyResult,
  type BattleResult,
  type Engine,
  type GameState,
  type PublicEvent,
  type PublicState,
  RulesError,
  type Side,
  opposite,
  uciToMove,
} from '@chain-theorem/rules';
import { type NpcPolicy, searchPolicy } from './npc.ts';
import type {
  BattleArchive,
  BattleInit,
  BattleSnapshot,
  BattleSummary,
  LogRecord,
  NpcSeat,
  Outbox,
  RecordCause,
  Seat,
  SeatInit,
  ServerMsg,
  SideConn,
  SideStats,
  Tier,
} from './types.ts';

export interface CoreOptions {
  /** Rules engine (default: the content engine). */
  engine?: Engine;
  /** NPC replies (default: `@chain-theorem/ai` search with the NPC_NODES budgets). */
  npc?: NpcPolicy;
  /**
   * Observer of every queued message together with the full state at that moment (tests: R-SEC-001
   * payload scan). Never used to send anything.
   */
  observe?: (to: Side, msg: ServerMsg, state: GameState) => void;
}

type ClientMsg = Msg<ClientBattleMap>;
type ErrCode = (typeof BattleErr)[keyof typeof BattleErr];

interface Timer {
  at: number;
  kind: 'flag' | 'prompt' | 'grace';
  side: Side;
}

const SIDES = ['white', 'black'] as const;
const TIERS: readonly Tier[] = ['wild', 'trainer', 'elite'];
/** WebSocket close code for a policy violation (RFC 6455). */
export const CLOSE_POLICY = 1008;
/** At equal times a flag falls before a prompt default, and a prompt default before grace ends. */
const TIMER_RANK: Record<Timer['kind'], number> = { flag: 0, prompt: 1, grace: 2 };
/** Safety bound on NPC replies and timer firings inside one call (each one advances the battle). */
const MAX_STEPS = 64;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = (x: object): Record<string, unknown> => x as Record<string, unknown>;
const isNpc = (seat: Seat): seat is NpcSeat => !('playerId' in seat);
const zeroStats = (): SideStats => ({ received: 0, rateLimited: 0, invalid: 0, rejected: 0 });
const emptyOutbox = (): Outbox => ({ send: [], effects: [], save: false });

function checkTime(now: number): number {
  if (!Number.isFinite(now)) throw new Error(`BattleCore: bad time ${String(now)}`);
  return now;
}

function checkInit(init: BattleInit, engine: Engine): void {
  const bad = (why: string): never => {
    throw new Error(`BattleCore: bad init: ${why}`);
  };
  if (typeof init.battleId !== 'string' || init.battleId.length < 1 || init.battleId.length > 64)
    bad('battleId must be 1..64 characters');
  if (!engine.caps.FORMATS[init.format]) bad(`unknown format ${String(init.format)}`);
  for (const side of SIDES) {
    const seat = init[side];
    if (typeof seat.name !== 'string' || seat.name.length < 1 || seat.name.length > 40)
      bad(`${side} name must be 1..40 characters`);
    if (!Number.isInteger(seat.level) || seat.level < 1 || seat.level > 100)
      bad(`${side} level must be an integer 1..100`);
    if (isNpc(seat)) {
      if (!TIERS.includes(seat.tier)) bad(`${side} NPC tier ${String(seat.tier)}`);
    } else if (typeof seat.playerId !== 'string' || seat.playerId.length < 1) {
      bad(`${side} playerId missing`);
    }
  }
  if (isNpc(init.white) && isNpc(init.black)) bad('a battle room needs at least one player');
}

function errCode(e: unknown): ErrCode {
  if (!(e instanceof RulesError)) return BattleErr.illegal;
  switch (e.code) {
    case 'not_your_turn':
    case 'pending_choice':
      return BattleErr.not_your_turn;
    case 'no_pending_choice':
      return BattleErr.no_prompt;
    case 'battle_over':
      return BattleErr.over;
    default:
      return BattleErr.illegal;
  }
}

export class BattleCore {
  private readonly s: BattleSnapshot;
  private readonly records: LogRecord[];
  private readonly engine: Engine;
  private readonly npc: NpcPolicy;
  private readonly observe: CoreOptions['observe'];
  private out: Outbox = emptyOutbox();

  private constructor(s: BattleSnapshot, records: LogRecord[], opts: CoreOptions) {
    this.s = s;
    this.records = records;
    this.engine = opts.engine ?? defaultEngine;
    this.npc = opts.npc ?? searchPolicy(this.engine);
    this.observe = opts.observe;
  }

  /**
   * Start a battle at `now`. Both loadouts are validated (R-LOAD-004, `strict`): an illegal one
   * throws RulesError('bad_setup'); a malformed init throws Error. An NPC to move replies at once.
   */
  static create(
    init: BattleInit,
    now: number,
    opts: CoreOptions = {},
  ): { core: BattleCore; out: Outbox } {
    const engine = opts.engine ?? defaultEngine;
    checkInit(init, engine);
    const t = checkTime(now);
    const { state, events } = engine.newBattle({
      format: init.format,
      white: { level: init.white.level, loadout: init.white.loadout },
      black: { level: init.black.level, loadout: init.black.loadout },
      ...(init.fen !== undefined ? { fen: init.fen } : {}),
      strict: true,
    });
    const clock = engine.caps.FORMATS[init.format]?.clock;
    if (!clock) throw new Error(`BattleCore: format ${init.format} has no clock`);
    const seats = { white: clone(init.white), black: clone(init.black) };
    const conn = (seat: SeatInit): SideConn =>
      isNpc(seat)
        ? { connected: true, live: false, graceUntil: null }
        : // A seat that never connects abandons when the grace ends, as after a disconnect.
          { connected: false, live: false, graceUntil: t + DISCONNECT_GRACE_MS };
    const snap: BattleSnapshot = {
      v: 1,
      battleId: init.battleId,
      format: init.format,
      fen: init.fen ?? null,
      seats,
      state,
      clocks: {
        white: clock.initialMs,
        black: clock.initialMs,
        running: null,
        at: t,
        inc: clock.incrementMs,
      },
      prompt: null,
      draw: { offer: null, lastPly: { white: null, black: null } },
      conn: { white: conn(seats.white), black: conn(seats.black) },
      buckets: { white: newBucket(LIMITS.battle, t), black: newBucket(LIMITS.battle, t) },
      stats: { white: zeroStats(), black: zeroStats() },
      startedAt: t,
      endedAt: null,
      now: t,
      records: 0,
      events: 0,
    };
    const core = new BattleCore(snap, [], opts);
    core.append('start', null, events, t);
    core.s.clocks.running = core.runningSide();
    core.npcTurns(t);
    core.out.save = true;
    return { core, out: core.flush() };
  }

  /** Resume from a stored snapshot and every stored log record, in order. */
  static restore(
    snapshot: BattleSnapshot,
    records: readonly LogRecord[],
    opts: CoreOptions = {},
  ): BattleCore {
    if (snapshot.v !== 1) throw new Error(`BattleCore: unknown snapshot version ${snapshot.v}`);
    if (records.length !== snapshot.records)
      throw new Error(
        `BattleCore: ${records.length} log records, snapshot has ${snapshot.records}`,
      );
    let next = 0;
    records.forEach((r, n) => {
      if (r.n !== n || r.from !== next) throw new Error(`BattleCore: log record ${n} out of order`);
      next += r.events.length;
    });
    if (next !== snapshot.events)
      throw new Error(`BattleCore: log has ${next} events, snapshot has ${snapshot.events}`);
    return new BattleCore(clone(snapshot), [...records], opts);
  }

  /** A JSON-serializable copy of everything but the log (store it after each `save` outbox). */
  snapshot(): BattleSnapshot {
    return clone(this.s);
  }

  /** Every log record so far (server-side only: full events and both projections). */
  log(): readonly LogRecord[] {
    return this.records;
  }

  /** Full state (server-side only: never send it; tests and archives). */
  fullState(): GameState {
    return this.s.state;
  }

  get result(): BattleResult | null {
    return this.s.state.result;
  }

  get battleId(): string {
    return this.s.battleId;
  }

  /**
   * When the host must call `alarm`: the earliest of the running clock's flag fall, the prompt
   * window and a disconnect grace. Null once the battle is over.
   */
  nextAlarm(): number | null {
    return this.timers()[0]?.at ?? null;
  }

  /** Clocks as seen at `now` (the running side charged up to `now`, never below zero). */
  clocksAt(now: number): Clocks {
    const c = this.s.clocks;
    const t = Math.max(now, c.at);
    const view: Clocks = { ...c, at: t };
    if (c.running) view[c.running] = Math.max(0, c[c.running] - (t - c.at));
    return view;
  }

  // ---------------------------------------------------------------------------------------------
  // Inputs

  /**
   * A socket for `side` opened (one per side: the host closes an older one without calling
   * `disconnect`). The side receives nothing until it sends `hello`.
   */
  connect(side: Side, now: number): Outbox {
    const t = this.begin(now);
    if (isNpc(this.s.seats[side])) return this.flush();
    this.catchUp(t);
    this.markConnected(side);
    return this.flush();
  }

  /** The side's last socket closed: the 60 s grace starts while its clock keeps running (9.2). */
  disconnect(side: Side, now: number): Outbox {
    const t = this.begin(now);
    if (isNpc(this.s.seats[side])) return this.flush();
    this.catchUp(t);
    const c = this.s.conn[side];
    if (!c.connected) return this.flush();
    c.connected = false;
    c.live = false;
    c.graceUntil = this.s.state.result ? null : t + DISCONNECT_GRACE_MS;
    this.out.save = true;
    const graceUntil = c.graceUntil;
    this.stream(opposite(side), {
      t: 'opp',
      d: graceUntil === null ? { connected: false } : { connected: false, graceUntil },
    });
    return this.flush();
  }

  /** One raw WebSocket frame from `side`. */
  message(side: Side, raw: string, now: number): Outbox {
    const t = this.begin(now);
    if (isNpc(this.s.seats[side])) return this.flush();
    this.catchUp(t);
    if (!this.s.conn[side].connected) this.markConnected(side);
    const b = this.s.buckets[side];
    const stats = this.s.stats[side];
    // Every frame is billed (14.1), valid or not; snapshots from before M5 lack the counter.
    stats.received = (stats.received ?? 0) + 1;
    const before = b.strikes;
    if (!take(b, LIMITS.battle, t)) {
      stats.rateLimited++;
      if (b.strikes === 1) this.reply(side, BattleErr.rate_limited);
      this.checkStrikes(side);
      return this.flush();
    }
    const msg = decode(ClientBattle, raw);
    if (!msg) {
      // `take` cleared the strikes for the token; an invalid frame is still a strike (R-SEC-005).
      b.strikes = before;
      strike(b);
      stats.invalid++;
      if (b.strikes === 1) this.reply(side, BattleErr.bad_message);
      this.checkStrikes(side);
      return this.flush();
    }
    if (!this.handle(side, msg, t)) {
      b.strikes = before + 1;
      stats.rejected++;
      this.checkStrikes(side);
    }
    return this.flush();
  }

  /** The Durable Object alarm fired: settle every deadline up to `now`. */
  alarm(now: number): Outbox {
    const t = this.begin(now);
    this.catchUp(t);
    return this.flush();
  }

  // ---------------------------------------------------------------------------------------------
  // Messages

  /** Handle one valid message; false when it was refused (it changed nothing). */
  private handle(side: Side, msg: ClientMsg, t: number): boolean {
    switch (msg.t) {
      case 'hello':
        this.hello(side, msg.d.from, t);
        return true;
      case 'sync':
        this.send(side, { t: 'clock', d: { clocks: this.clocksAt(t), echo: msg.d.t, now: t } });
        return true;
      default:
        break;
    }
    if (!this.s.conn[side].live) return this.reject(side, BattleErr.bad_message, 'hello first');
    const st = this.s.state;
    if (st.result) return this.reject(side, BattleErr.over);
    switch (msg.t) {
      case 'mv': {
        if (st.pending || st.turn !== side) return this.reject(side, BattleErr.not_your_turn);
        let input: ActionInput;
        try {
          input = { kind: 'move', side, move: uciToMove(msg.d.move) };
        } catch {
          return this.reject(side, BattleErr.illegal);
        }
        if (msg.d.choices) input.choices = msg.d.choices;
        return this.play(side, input, t);
      }
      case 'ch': {
        const pend = st.pending;
        if (!pend) return this.reject(side, BattleErr.no_prompt);
        if (pend.request.chooser !== side) return this.reject(side, BattleErr.not_your_turn);
        if (pend.request.promptId !== msg.d.promptId) return this.reject(side, BattleErr.no_prompt);
        if (msg.d.option >= pend.request.options.length)
          return this.reject(side, BattleErr.illegal);
        const input: ActionInput = {
          kind: 'choice',
          side,
          promptId: msg.d.promptId,
          option: msg.d.option,
        };
        return this.play(side, input, t);
      }
      case 'resign':
        return this.play(side, { kind: 'resign', side }, t);
      case 'draw':
        return this.offerDraw(side, t);
      case 'drawReply': {
        if (this.s.draw.offer !== opposite(side)) return this.reject(side, BattleErr.illegal);
        if (msg.d.accept) return this.play(side, { kind: 'agreeDraw' }, t);
        this.s.draw.offer = null;
        this.out.save = true;
        for (const to of SIDES) this.stream(to, { t: 'drawDeclined', d: { by: opposite(side) } });
        return true;
      }
    }
  }

  /** `hello {from}` (13.4 reconnect): bstart, the projected events since `from`, then state. */
  private hello(side: Side, from: number, t: number): void {
    const s = this.s;
    s.conn[side].live = true;
    this.out.save = true;
    const st = s.state;
    const pub = this.engine.project(st, side);
    const clocks = this.clocksAt(t);
    const count = s.events;
    const start = Math.min(from, count);
    this.send(side, {
      t: 'bstart',
      d: {
        battleId: s.battleId,
        you: side,
        format: s.format,
        public: payload(pub),
        clocks,
        players: { white: this.tag('white'), black: this.tag('black') },
        eventCount: count,
      },
    });
    this.send(side, {
      t: 'bev',
      d: {
        from: start,
        to: count,
        events: this.seenSince(side, start).map(payload),
        public: payload(pub),
        clocks,
      },
    });
    const opp = s.conn[opposite(side)];
    this.send(side, {
      t: 'opp',
      d:
        !opp.connected && opp.graceUntil !== null
          ? { connected: false, graceUntil: opp.graceUntil }
          : { connected: opp.connected },
    });
    if (s.draw.offer) this.send(side, { t: 'drawOffer', d: { by: s.draw.offer } });
    if (s.prompt?.chooser === side) this.sendPrompt(side, pub);
    if (st.result) this.send(side, { t: 'bend', d: { result: { ...st.result } } });
  }

  private offerDraw(side: Side, t: number): boolean {
    const s = this.s;
    const opp = opposite(side);
    // Crossing offers agree (the opponent's offer is still open).
    if (s.draw.offer === opp) return this.play(side, { kind: 'agreeDraw' }, t);
    const last = s.draw.lastPly[side];
    if (s.draw.offer === side || (last !== null && s.state.ply < last + 2 * DRAW_OFFER_EVERY_MOVES))
      return this.reject(side, BattleErr.draw_limit);
    s.draw.offer = side;
    s.draw.lastPly[side] = s.state.ply;
    this.out.save = true;
    const seat = s.seats[opp];
    if (isNpc(seat)) {
      let accept = false;
      try {
        accept = this.npc.acceptDraw(this.engine.project(s.state, opp), seat.loadout, seat.tier);
      } catch (e) {
        this.error(`npc draw reply failed: ${String(e)}`);
      }
      if (accept) {
        const r = this.tryApply({ kind: 'agreeDraw' });
        if (r) this.commit({ kind: 'agreeDraw' }, r, 'npc', t);
      } else {
        s.draw.offer = null;
        this.stream(side, { t: 'drawDeclined', d: { by: side } });
      }
      return true;
    }
    for (const to of SIDES) this.stream(to, { t: 'drawOffer', d: { by: side } });
    return true;
  }

  /** Apply a player's action; refused input answers `err` and changes nothing (R-SEC-002). */
  private play(side: Side, input: ActionInput, t: number): boolean {
    let r: ApplyResult;
    try {
      r = this.engine.applyAction(this.s.state, input);
    } catch (e) {
      if (!(e instanceof RulesError)) this.error(`rejected ${input.kind}: ${String(e)}`);
      return this.reject(side, errCode(e));
    }
    this.commit(input, r, 'player', t);
    this.npcTurns(t);
    return true;
  }

  private reject(side: Side, code: ErrCode, msg?: string): false {
    this.reply(side, code, msg);
    return false;
  }

  private reply(side: Side, code: ErrCode, msg?: string): void {
    this.send(side, { t: 'err', d: msg === undefined ? { code } : { code, msg } });
  }

  private checkStrikes(side: Side): void {
    if (tooManyStrikes(this.s.buckets[side]))
      this.out.effects.push({
        kind: 'close',
        side,
        code: CLOSE_POLICY,
        reason: 'too many invalid or excess messages',
      });
  }

  private markConnected(side: Side): void {
    const c = this.s.conn[side];
    c.connected = true;
    c.live = false;
    c.graceUntil = null;
    this.s.buckets[side].strikes = 0;
    this.out.save = true;
    this.stream(opposite(side), { t: 'opp', d: { connected: true } });
  }

  // ---------------------------------------------------------------------------------------------
  // Engine steps

  private tryApply(input: ActionInput): ApplyResult | null {
    try {
      return this.engine.applyAction(this.s.state, input);
    } catch {
      return null;
    }
  }

  /**
   * Commit one engine step at time `t`: charge the clock that ran, log the events, move the clocks
   * on (Fischer increment when the mover's action completes), then stream `bev` to every live side
   * and the prompt to its chooser.
   */
  private commit(input: ActionInput, r: ApplyResult, cause: RecordCause, t: number): void {
    const s = this.s;
    const pre = s.state;
    this.settle(t);
    s.state = r.state;
    const rec = this.append(cause, input, r.events, t);
    s.draw.offer = null;
    const st = r.state;
    if (st.result) {
      s.prompt = null;
      s.endedAt = t;
      for (const side of SIDES) s.conn[side].graceUntil = null;
    } else if (r.kind === 'needsChoice') {
      s.prompt = { promptId: r.request.promptId, chooser: r.request.chooser, since: t };
    } else {
      s.prompt = null;
      const mover =
        input.kind === 'move'
          ? input.side
          : input.kind === 'choice'
            ? pre.pending?.input.side
            : null;
      // NPC clocks never run, so they never gain an increment either.
      if (mover && !isNpc(s.seats[mover])) s.clocks[mover] += s.clocks.inc;
    }
    s.clocks.running = this.runningSide();
    s.clocks.at = t;
    this.out.save = true;
    const clocks = this.clocksAt(t);
    for (const side of SIDES) {
      if (!this.isLive(side)) continue;
      const pub = this.engine.project(st, side);
      this.send(side, {
        t: 'bev',
        d: {
          from: rec.from,
          to: rec.from + rec.events.length,
          events: rec.seen[side].map(payload),
          public: payload(pub),
          clocks,
        },
      });
      if (s.prompt?.chooser === side) this.sendPrompt(side, pub);
      if (st.result) this.send(side, { t: 'bend', d: { result: { ...st.result } } });
    }
    if (st.result) {
      const summary = this.summary();
      const archive: BattleArchive = {
        v: 1,
        summary,
        fen: s.fen,
        seats: clone(s.seats),
        records: [...this.records],
      };
      this.out.effects.push({ kind: 'ended', summary, archive });
    }
  }

  private append(
    cause: RecordCause,
    input: ActionInput | null,
    events: LogRecord['events'],
    t: number,
  ): LogRecord {
    const st = this.s.state;
    const from = this.s.events;
    events.forEach((e, k) => {
      if (e.i !== from + k) this.error(`event index ${e.i} at log position ${from + k}`);
    });
    const rec: LogRecord = {
      n: this.s.records,
      at: t,
      cause,
      input: input ? clone(input) : null,
      from,
      events,
      seen: {
        white: this.engine.projectEvents(st, events, 'white'),
        black: this.engine.projectEvents(st, events, 'black'),
      },
    };
    this.records.push(rec);
    this.s.records++;
    this.s.events += events.length;
    this.out.effects.push({ kind: 'persist', record: rec });
    return rec;
  }

  /** Run every NPC reply that is due now (its move, or its answer to a prompt). */
  private npcTurns(t: number): void {
    for (let k = 0; k < MAX_STEPS; k++) {
      const actor = this.actor();
      if (!actor) return;
      const seat = this.s.seats[actor];
      if (!isNpc(seat)) return;
      this.npcAct(actor, seat, t);
    }
    this.error('NPC reply limit reached in one call');
  }

  private npcAct(side: Side, seat: NpcSeat & SeatInit, t: number): void {
    const st = this.s.state;
    // 9.4: the NPC sees its own projection and its own loadout, never the full state.
    const pub = this.engine.project(st, side);
    const inputs: ActionInput[] = [];
    const pend = st.pending;
    if (pend) {
      const request = pub.pending?.request;
      const promptId = pend.request.promptId;
      if (request) {
        try {
          inputs.push({
            kind: 'choice',
            side,
            promptId,
            option: this.npc.option(pub, seat.loadout, request, seat.tier),
          });
        } catch (e) {
          this.error(`npc option failed: ${String(e)}`);
        }
      }
      inputs.push({ kind: 'choice', side, promptId, option: pend.request.defaultOption });
    } else {
      try {
        inputs.push({ kind: 'move', side, move: this.npc.move(pub, seat.loadout, seat.tier) });
      } catch (e) {
        this.error(`npc move failed: ${String(e)}`);
      }
      for (const uci of pub.legal) inputs.push({ kind: 'move', side, move: uciToMove(uci) });
    }
    for (const [k, input] of inputs.entries()) {
      const r = this.tryApply(input);
      if (!r) continue;
      if (k > 0) this.error(`npc reply ${k} refused; used a fallback`);
      this.commit(input, r, 'npc', t);
      return;
    }
    // Nothing playable (an engine bug): resign rather than stall the room.
    this.error('npc has no playable reply; resigning');
    const input: ActionInput = { kind: 'resign', side };
    const r = this.tryApply(input);
    if (r) this.commit(input, r, 'npc', t);
  }

  // ---------------------------------------------------------------------------------------------
  // Time

  private begin(now: number): number {
    const t = Math.max(checkTime(now), this.s.now);
    this.s.now = t;
    this.out = emptyOutbox();
    return t;
  }

  private flush(): Outbox {
    const out = this.out;
    this.out = emptyOutbox();
    return out;
  }

  /**
   * Fire every deadline up to `t` in time order, each at its own time; an NPC reply that a fired
   * deadline makes due is played at that same time (a late alarm charges nobody for the delay).
   */
  private catchUp(t: number): void {
    this.npcTurns(t);
    for (let k = 0; k < MAX_STEPS; k++) {
      const due = this.timers()[0];
      if (!due || due.at > t) return;
      this.fire(due);
      this.npcTurns(due.at);
    }
    this.error('timer limit reached in one call');
  }

  private fire(due: Timer): void {
    const s = this.s;
    const t = due.at;
    let input: ActionInput;
    let cause: RecordCause;
    switch (due.kind) {
      case 'flag':
        this.settle(t);
        s.clocks[due.side] = 0;
        input = { kind: 'timeout', side: due.side };
        cause = 'flag';
        break;
      case 'grace':
        input = { kind: 'abandon', side: due.side };
        cause = 'grace';
        break;
      case 'prompt': {
        // 5.4 / DD-18: no answer in time means the request's default option.
        const pend = s.state.pending;
        if (!pend) {
          s.prompt = null;
          return;
        }
        input = {
          kind: 'choice',
          side: due.side,
          promptId: pend.request.promptId,
          option: pend.request.defaultOption,
        };
        cause = 'prompt_timeout';
        break;
      }
    }
    const r = this.tryApply(input);
    if (r) {
      this.commit(input, r, cause, t);
      return;
    }
    // Cannot happen with a consistent state; end the battle rather than loop on the same timer.
    this.error(`timer ${due.kind} for ${due.side} could not apply`);
    const fallback: ActionInput = { kind: 'abandon', side: due.side };
    const r2 = this.tryApply(fallback);
    if (r2) this.commit(fallback, r2, cause, t);
    else s.prompt = null;
  }

  /** Charge the running clock up to `t`. */
  private settle(t: number): void {
    const c = this.s.clocks;
    if (c.running) c[c.running] = Math.max(0, c[c.running] - Math.max(0, t - c.at));
    c.at = Math.max(c.at, t);
  }

  private timers(): Timer[] {
    const s = this.s;
    if (s.state.result) return [];
    const list: Timer[] = [];
    const c = s.clocks;
    if (c.running) list.push({ at: c.at + c[c.running], kind: 'flag', side: c.running });
    if (s.prompt && !isNpc(s.seats[s.prompt.chooser]))
      list.push({ at: s.prompt.since + CHOICE_PROMPT_MS, kind: 'prompt', side: s.prompt.chooser });
    for (const side of SIDES) {
      const conn = s.conn[side];
      if (!conn.connected && conn.graceUntil !== null)
        list.push({ at: conn.graceUntil, kind: 'grace', side });
    }
    const actor = this.actor();
    return list.sort(
      (a, b) =>
        a.at - b.at ||
        TIMER_RANK[a.kind] - TIMER_RANK[b.kind] ||
        Number(b.side === actor) - Number(a.side === actor),
    );
  }

  /** The side that must act next: the chooser of a pending prompt, else the side to move. */
  private actor(): Side | null {
    const st = this.s.state;
    if (st.result) return null;
    return st.pending ? st.pending.request.chooser : st.turn;
  }

  /** The clock that runs: the acting side's, unless it is an NPC (NPC clocks never run). */
  private runningSide(): Side | null {
    const a = this.actor();
    return a && !isNpc(this.s.seats[a]) ? a : null;
  }

  private promptDeadline(): number {
    const p = this.s.prompt;
    if (!p) return this.s.now;
    const window = p.since + CHOICE_PROMPT_MS;
    const c = this.s.clocks;
    return c.running === p.chooser ? Math.min(window, c.at + c[p.chooser]) : window;
  }

  // ---------------------------------------------------------------------------------------------
  // Output

  private isLive(side: Side): boolean {
    const c = this.s.conn[side];
    return !isNpc(this.s.seats[side]) && c.connected && c.live;
  }

  private send(to: Side, msg: ServerMsg): void {
    this.out.send.push({ to, msg });
    this.observe?.(to, msg, this.s.state);
  }

  /** Streamed updates go only to sides that said hello on their current socket. */
  private stream(to: Side, msg: ServerMsg): void {
    if (this.isLive(to)) this.send(to, msg);
  }

  private sendPrompt(side: Side, pub: PublicState): void {
    const p = this.s.prompt;
    // The chooser's own projection carries the request; the opponent's has `request: null`.
    const request = pub.pending?.request;
    if (!p || p.chooser !== side || !request) return;
    this.send(side, {
      t: 'prompt',
      d: { promptId: p.promptId, request: payload(request), deadline: this.promptDeadline() },
    });
  }

  private tag(side: Side): PlayerTag {
    const seat = this.s.seats[side];
    return isNpc(seat)
      ? { name: seat.name, level: seat.level, npc: seat.tier }
      : { name: seat.name, level: seat.level };
  }

  /** The projected events `side` was sent, from full-log index `from` to the end. */
  private seenSince(side: Side, from: number): PublicEvent[] {
    const chunks: PublicEvent[][] = [];
    for (let k = this.records.length - 1; k >= 0; k--) {
      const r = this.records[k] as LogRecord;
      if (r.from + r.events.length <= from) break;
      chunks.push(r.from >= from ? r.seen[side] : r.seen[side].filter((e) => e.i >= from));
    }
    return chunks.reverse().flat();
  }

  private summary(): BattleSummary {
    const s = this.s;
    const st = s.state;
    const ref = (seat: SeatInit): Seat & { level: number } => {
      const { loadout: _loadout, ...rest } = seat;
      return clone(rest);
    };
    return {
      battleId: s.battleId,
      format: s.format,
      contentVersion: st.contentVersion,
      white: ref(s.seats.white),
      black: ref(s.seats.black),
      result: st.result ? { ...st.result } : { winner: null, reason: 'agreement' },
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? s.now,
      plies: st.ply,
      events: s.events,
      records: s.records,
      stateHash: this.engine.stateHash(st),
      stats: clone(s.stats),
    };
  }

  private error(message: string): void {
    this.out.effects.push({ kind: 'error', message });
  }
}
