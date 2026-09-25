/**
 * Spectating (M7 7.2, spec 10.4): the client side of a read-only spectator socket. The controller
 * holds only what the server sends a spectator: the spectator projection (`projectSpectator`) of a
 * position `delay` plies behind the live one and the spectator-projected events (R-INFO-005). It
 * never sends anything but `hello` (with the last full-log index it has, for the reconnect replay)
 * and fetches a fresh 60-second ticket for every connect (R-SEC-006). Moves, answers, resignations
 * and draw offers do nothing.
 */
import { signal } from '@preact/signals';
import {
  ClientSpectate,
  ServerSpectate,
  decode,
  encode,
  type Clocks as WireClocks,
  type Msg,
  type ServerSpectateMap,
} from '@chain-theorem/protocol';
import type {
  BattleResult,
  Loadout,
  PublicEvent,
  PublicState,
  Side,
  SpectatorState,
} from '@chain-theorem/rules';
import type {
  BattleController,
  BattleSnapshot,
  BattleUpdate,
  Clocks,
  LogEntry,
} from './controller.ts';
import { describe } from './describe.ts';
import type { SocketLike } from './online.ts';

export interface SpectateOptions {
  battleId: string;
  /**
   * Fetch a fresh spectator ticket and return the WebSocket URL (called on every connect). Throw
   * an error with `code` `not_found` when the battle can no longer be watched.
   */
  connectUrl(): Promise<string>;
  socketFactory?: (url: string) => SocketLike;
  now?: () => number;
  backoff?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;
/** A spectator has no loadout: move previews and attack hints are off in this view. */
const NO_LOADOUT: Loadout = { elements: ['neutral'], items: [], sets: [[]] };

/**
 * The spectator projection shaped as a board state: the scene draws it from `orientation`'s side;
 * there are no legal moves and no prompt, and neither army carries a loadout.
 */
export function boardState(spec: SpectatorState, orientation: Side): PublicState {
  return { ...spec, viewer: orientation, legal: [], pending: spec.pending };
}

export class SpectatorController implements BattleController {
  readonly snapshot;
  readonly battleId: string;
  private readonly opts: SpectateOptions;
  private readonly listeners = new Set<(u: BattleUpdate) => void>();
  private socket: SocketLike | null = null;
  private spec: SpectatorState | null = null;
  private orientation: Side = 'white';
  private names: Record<Side, string> = { white: 'White', black: 'Black' };
  private log: LogEntry[] = [];
  /** Full-log index to resume from (the `to` of the last `sev`). */
  private next = 0;
  private clocks: Clocks | null = null;
  private result: BattleResult | null = null;
  private delay = 0;
  private watchers = 0;
  private connection: NonNullable<BattleSnapshot['connection']> = 'connecting';
  private notice: string | null = null;
  /** Every event has been shown (`send`), or the battle can no longer be watched. */
  private finished = false;
  private attempts = 0;
  private timer: unknown = null;
  private disposed = false;

  constructor(opts: SpectateOptions) {
    this.opts = opts;
    this.battleId = opts.battleId;
    this.snapshot = signal<BattleSnapshot>(this.build());
    void this.connect();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  private async connect(): Promise<void> {
    if (this.disposed || this.finished) return;
    this.connection = this.attempts === 0 ? 'connecting' : 'reconnecting';
    this.publish();
    let url: string;
    try {
      url = await this.opts.connectUrl();
    } catch (e) {
      if ((e as { code?: string }).code === 'not_found') {
        this.stop(this.result ? null : 'This battle can no longer be watched.');
        return;
      }
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
      if (ws.readyState === OPEN)
        ws.send(encode(ClientSpectate, { t: 'hello', d: { from: this.next } }));
      this.publish();
    };
    ws.onmessage = (ev) => this.receive(ev.data);
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.finished || this.disposed) {
        this.connection = 'closed';
        this.publish();
        return;
      }
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry(): void {
    if (this.disposed || this.finished) return;
    const delays = this.opts.backoff ?? [500, 1000, 2000, 4000, 8000];
    const ms = delays[Math.min(this.attempts, delays.length - 1)] ?? 8000;
    this.attempts++;
    this.connection = 'reconnecting';
    this.publish();
    const set = this.opts.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    this.timer = set(() => void this.connect(), ms);
  }

  /** Nothing more will come: close the socket and stop reconnecting. */
  private stop(notice: string | null): void {
    this.finished = true;
    if (notice) this.notice = notice;
    this.connection = 'closed';
    const ws = this.socket;
    this.socket = null;
    ws?.close(1000, 'done');
    this.publish();
  }

  /** Clocks at the delayed position: they never run in a spectator view. */
  private localClocks(c: WireClocks | null): Clocks | null {
    return c ? { white: c.white, black: c.black, running: null, at: this.now() } : null;
  }

  private receive(raw: unknown): void {
    const msg = decode(ServerSpectate, raw, Number.POSITIVE_INFINITY);
    if (!msg) return;
    this.handle(msg);
  }

  private handle(msg: Msg<ServerSpectateMap>): void {
    switch (msg.t) {
      case 'sstart': {
        const d = msg.d;
        this.names = { white: d.players.white.name, black: d.players.black.name };
        this.spec = d.public as unknown as SpectatorState;
        this.delay = d.delay;
        this.watchers = d.watchers;
        this.clocks = this.localClocks(d.clocks);
        this.result = null;
        break;
      }
      case 'sev': {
        const d = msg.d;
        const before = this.spec;
        const after = d.public as unknown as SpectatorState;
        const events = d.events as unknown as PublicEvent[];
        const fresh = events.filter((e) => e.i >= this.next);
        this.spec = after;
        this.next = Math.max(this.next, d.to);
        this.clocks = this.localClocks(d.clocks);
        const board = boardState(after, this.orientation);
        let ply = this.log.at(-1)?.ply ?? 0;
        for (const event of fresh) {
          if (event.k === 'ActionStarted') ply = event.ply;
          this.log.push({
            i: event.i,
            ply,
            depth: event.depth,
            event,
            text: describe(event, board),
          });
        }
        if (before && fresh.length > 0) {
          const u = { before: boardState(before, this.orientation), after: board, events: fresh };
          for (const l of this.listeners) l(u);
        }
        break;
      }
      case 'send':
        this.result = {
          winner: msg.d.result.winner,
          reason: msg.d.result.reason as BattleResult['reason'],
        };
        this.stop(null);
        return;
      case 'watchers':
        this.watchers = msg.d.count;
        break;
      case 'err':
        if (msg.d.code === 'not_public') {
          this.stop('This battle can no longer be watched.');
          return;
        }
        this.notice = msg.d.msg ?? msg.d.code;
        break;
    }
    this.publish();
  }

  private build(): BattleSnapshot {
    const spec = this.spec;
    const pub = spec ? boardState(spec, this.orientation) : placeholder(this.orientation);
    const result = this.result ?? spec?.result ?? null;
    return {
      pub,
      viewer: this.orientation,
      own: NO_LOADOUT,
      log: [...this.log],
      prompt: null,
      clocks: this.clocks ? { ...this.clocks } : null,
      status: result ? 'ended' : spec ? 'playing' : 'waiting',
      result,
      names: { ...this.names },
      controls: [],
      handoff: null,
      connection: this.connection,
      notice: this.notice,
      spectate: { delay: this.delay, watchers: this.watchers },
    };
  }

  private publish(): void {
    this.snapshot.value = this.build();
  }

  /** Watch from the other side of the board. */
  flip(): void {
    this.orientation = this.orientation === 'white' ? 'black' : 'white';
    this.publish();
  }

  onUpdate(listener: (u: BattleUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Read-only: a spectator cannot act in the battle.
  move(): void {}
  answer(): void {}
  resign(): void {}
  offerDraw(): void {}
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

/** An empty board shown until `sstart` arrives. */
function placeholder(viewer: Side): PublicState {
  const army = {
    level: 1,
    elements: ['neutral' as const],
    consumedSlots: 0,
    revealed: { abilities: {}, complete: [], items: [], allItems: false, veiled: [] },
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
    board: new Array<number>(64).fill(-1),
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
