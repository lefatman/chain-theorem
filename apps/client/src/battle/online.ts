/**
 * Online battles (M4 4.2): the client side of the BattleRoom protocol (13.4). The client holds only
 * what the server sends: its own projection, its projected events and its prompts (R-INFO-005). On
 * every (re)connect it fetches a fresh 60-second ticket (R-SEC-006), sends `hello` with the last
 * full-log index it has seen, and the server replays what it missed.
 */
import { signal } from '@preact/signals';
import {
  ClientBattle,
  ServerBattle,
  decode,
  encode,
  type Clocks as WireClocks,
  type Msg,
  type ServerBattleMap,
} from '@chain-theorem/protocol';
import type {
  BattleResult,
  ChoiceRequest,
  Loadout,
  PublicEvent,
  PublicState,
  Side,
} from '@chain-theorem/rules';
import type {
  BattleController,
  BattleSnapshot,
  BattleUpdate,
  Clocks,
  LogEntry,
} from './controller.ts';
import { describe } from './describe.ts';

/** The subset of WebSocket this controller uses (tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface OnlineOptions {
  battleId: string;
  /** Fetch a fresh ticket and return the WebSocket URL to open (called on every connect). */
  connectUrl(): Promise<string>;
  socketFactory?: (url: string) => SocketLike;
  /** Clock for interpolation (tests pass a fake). */
  now?: () => number;
  /** Reconnect delays in ms; the last one repeats. */
  backoff?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;

export class OnlineController implements BattleController {
  readonly snapshot;
  private readonly opts: OnlineOptions;
  private readonly listeners = new Set<(u: BattleUpdate) => void>();
  private socket: SocketLike | null = null;
  private pub: PublicState | null = null;
  private you: Side = 'white';
  private names: Record<Side, string> = { white: 'White', black: 'Black' };
  private log: LogEntry[] = [];
  /** Full-log index to resume from (the `to` of the last `bev`). */
  private next = 0;
  private prompt: (ChoiceRequest & { deadline?: number }) | null = null;
  private clocks: Clocks | null = null;
  private result: BattleResult | null = null;
  private drawOffer: Side | null = null;
  private opponent: { connected: boolean; graceUntil?: number } | null = null;
  private connection: NonNullable<BattleSnapshot['connection']> = 'connecting';
  private notice: string | null = null;
  private attempts = 0;
  private timer: unknown = null;
  private disposed = false;
  /** Server clock minus local Date.now(), estimated from `clock` answers. */
  private offset = 0;
  private seq = 0;

  constructor(opts: OnlineOptions) {
    this.opts = opts;
    this.snapshot = signal<BattleSnapshot>(this.build());
    void this.connect();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.connection = this.attempts === 0 ? 'connecting' : 'reconnecting';
    this.publish();
    let url: string;
    try {
      url = await this.opts.connectUrl();
    } catch {
      this.retry();
      return;
    }
    if (this.disposed) return;
    const ws = this.opts.socketFactory
      ? this.opts.socketFactory(url)
      : (new WebSocket(url) as SocketLike);
    this.socket = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.connection = 'open';
      this.send({ t: 'hello', d: { from: this.next } });
      this.send({ t: 'sync', d: { t: Date.now() } });
      this.publish();
    };
    ws.onmessage = (ev) => this.receive(ev.data);
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.result || this.disposed) {
        this.connection = 'closed';
        this.publish();
        return;
      }
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry(): void {
    if (this.disposed || this.result) return;
    const delays = this.opts.backoff ?? [500, 1000, 2000, 4000, 8000];
    const ms = delays[Math.min(this.attempts, delays.length - 1)] ?? 8000;
    this.attempts++;
    this.connection = 'reconnecting';
    this.publish();
    const set = this.opts.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    this.timer = set(() => void this.connect(), ms);
  }

  private send(msg: Msg<typeof ClientBattle>): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== OPEN) return;
    ws.send(encode(ClientBattle, { ...msg, s: this.seq++ }));
  }

  /** Server clocks sampled at server time `at`, as local interpolation values. */
  private localClocks(c: WireClocks): Clocks {
    const serverNow = Date.now() + this.offset;
    return {
      white: c.white,
      black: c.black,
      running: c.running,
      at: this.now() - Math.max(0, serverNow - c.at),
    };
  }

  private receive(raw: unknown): void {
    const msg = decode(ServerBattle, raw, Number.POSITIVE_INFINITY);
    if (!msg) return;
    this.handle(msg);
  }

  private handle(msg: Msg<ServerBattleMap>): void {
    switch (msg.t) {
      case 'bstart': {
        const d = msg.d;
        this.you = d.you;
        this.names = { white: d.players.white.name, black: d.players.black.name };
        this.pub = d.public as unknown as PublicState;
        this.clocks = this.localClocks(d.clocks);
        this.result = this.pub.result;
        // A fresh bstart means the server re-sends any pending prompt after the catch-up.
        this.prompt = null;
        break;
      }
      case 'bev': {
        const d = msg.d;
        const before = this.pub;
        const after = d.public as unknown as PublicState;
        const events = d.events as unknown as PublicEvent[];
        const fresh = events.filter((e) => e.i >= this.next);
        this.pub = after;
        this.next = Math.max(this.next, d.to);
        this.clocks = this.localClocks(d.clocks);
        this.result = after.result;
        this.drawOffer = null;
        // A prompt is answered or superseded once the action moves on.
        if (!after.pending || after.pending.chooser !== this.you) this.prompt = null;
        let ply = this.log.at(-1)?.ply ?? 0;
        for (const event of fresh) {
          if (event.k === 'ActionStarted') ply = event.ply;
          this.log.push({
            i: event.i,
            ply,
            depth: event.depth,
            event,
            text: describe(event, after),
          });
        }
        if (before && fresh.length > 0)
          for (const l of this.listeners) l({ before, after, events: fresh });
        break;
      }
      case 'prompt':
        this.prompt = { ...(msg.d.request as unknown as ChoiceRequest), deadline: msg.d.deadline };
        break;
      case 'bend':
        this.result = {
          winner: msg.d.result.winner,
          reason: msg.d.result.reason as BattleResult['reason'],
        };
        this.prompt = null;
        break;
      case 'drawOffer':
        this.drawOffer = msg.d.by;
        break;
      case 'clock':
        if (msg.d.echo !== undefined) {
          // NTP-style estimate: the server stamped `now` halfway through the round trip.
          const local = Date.now();
          this.offset = msg.d.now - (msg.d.echo + local) / 2;
        }
        this.clocks = this.localClocks(msg.d.clocks);
        break;
      case 'opp':
        this.opponent =
          msg.d.graceUntil !== undefined
            ? { connected: msg.d.connected, graceUntil: msg.d.graceUntil }
            : { connected: msg.d.connected };
        break;
      case 'err':
        this.notice = msg.d.msg ?? msg.d.code;
        break;
    }
    this.publish();
  }

  private build(): BattleSnapshot {
    const pub = this.pub;
    return {
      pub: pub ?? (placeholder(this.you) as PublicState),
      viewer: this.you,
      own: (pub?.armies[this.you].loadout ?? {
        elements: ['neutral'],
        items: [],
        sets: [[]],
      }) as Loadout,
      log: [...this.log],
      prompt: this.prompt,
      clocks: this.clocks ? { ...this.clocks } : null,
      status: this.result ? 'ended' : pub ? 'playing' : 'waiting',
      result: this.result,
      names: { ...this.names },
      controls: [this.you],
      handoff: null,
      drawOffer: this.drawOffer,
      opponent: this.opponent,
      connection: this.connection,
      notice: this.notice,
    };
  }

  private publish(): void {
    this.snapshot.value = this.build();
  }

  onUpdate(listener: (u: BattleUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  move(uci: string): void {
    this.notice = null;
    this.send({ t: 'mv', d: { move: uci } });
  }

  answer(option: number): void {
    const p = this.prompt;
    if (!p) return;
    this.send({ t: 'ch', d: { promptId: p.promptId, option } });
    this.prompt = null;
    this.publish();
  }

  resign(): void {
    this.send({ t: 'resign', d: {} });
  }

  offerDraw(): void {
    this.send({ t: 'draw', d: {} });
  }

  replyDraw(accept: boolean): void {
    this.drawOffer = null;
    this.send({ t: 'drawReply', d: { accept } });
    this.publish();
  }

  acceptHandoff(): void {}

  dispose(): void {
    this.disposed = true;
    const clear =
      this.opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    if (this.timer !== null) clear(this.timer);
    this.listeners.clear();
    this.socket?.close(1000, 'left');
    this.socket = null;
  }
}

/** An empty board shown until `bstart` arrives. */
function placeholder(viewer: Side): unknown {
  const army = {
    level: 1,
    elements: ['neutral'],
    consumedSlots: 0,
    revealed: { abilities: {}, items: [], veiled: [] },
  };
  return {
    viewer,
    format: 'full',
    contentVersion: '',
    turn: 'white',
    ply: 0,
    fullmove: 1,
    halfmove: 0,
    castling: 0,
    ep: -1,
    board: new Array(64).fill(-1),
    pieces: [],
    armies: { white: army, black: army },
    usage: {},
    slices: {},
    objective: { white: 0, black: 0 },
    inCheck: null,
    result: null,
    eventSeq: 0,
    pending: null,
    legal: [],
  };
}
