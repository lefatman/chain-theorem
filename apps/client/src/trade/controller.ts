/**
 * The TradeSession socket on the client (M6 6.1; spec 10.4, 9.5). The server decides everything:
 * offers are validated there, any change to either offer resets both players' marks, and the trade
 * runs in one database transaction only after both marked ready and then both confirmed. The client
 * shows the latest `tstate`, sends the player's intents, and hands a wager over to the battle screen.
 *
 * Every (re)connect asks for a fresh 60-second ticket (R-SEC-006) and says `hello`. No DOM, no router.
 */
import { signal } from '@preact/signals';
import {
  ClientTrade,
  ServerTrade,
  decode,
  encode,
  type Format,
  type Msg,
  type Offer,
  type ServerTradeMap,
  type TradeMode,
} from '@chain-theorem/protocol';

type ServerMsg = Msg<ServerTradeMap>;
type ClientMsg = Msg<typeof ClientTrade>;
type Data<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>['d'];

export type TradeState = Data<'tstate'>;
export type TradeDone = Data<'tdone'>;
export type TradeEnd = Data<'tend'>;

export type TradeConnection = 'connecting' | 'open' | 'reconnecting' | 'closed';

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

export interface TradeOptions {
  id: string;
  mode: TradeMode;
  /** Socket path with a ticket just issued (used for the first connect only). */
  url: string;
  /** A fresh ticket for a reconnect (`POST /api/trades/:id/ticket`). */
  ticket(): Promise<{ url: string }>;
  /** Turn a socket path into a WebSocket URL (default: as is). */
  socketUrl?(path: string): string;
  socketFactory?: (url: string) => SocketLike;
  /** Reconnect delays in ms; after the last one the controller gives up. */
  backoff?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;
/** The server closed a finished session (TradeCore CLOSE_DONE): never reconnect. */
export const CLOSE_DONE = 4100;
const CLOSE_REPLACED = 4000;
const CLOSE_POLICY = 1008;

/** Friendly text for TradeSession error codes. */
const ERRORS: Record<string, string> = {
  rate_limited: 'Slow down a little.',
  stale: 'The offers changed just now: check them again.',
  not_open: 'Not now: the trade is not open for changes.',
  unknown: 'That is not a tradable item or card.',
  not_owned: 'Someone no longer has everything they offered. Nothing moved; check the offers.',
  not_ready: 'Both players must be ready before confirming.',
  empty: 'Put something in the trade first.',
  no_stakes: 'A wager needs a stake from each player.',
  not_wager: 'Only a wager has a format.',
  not_entitled: 'Trading and wagers are for subscribers only.',
  battle_failed: 'The wager battle could not start. Your stakes are back; try again.',
  failed: 'It could not run just now. Nothing changed; try again.',
};

export function tradeErrorText(code: string): string {
  return ERRORS[code] ?? `Something went wrong (${code}).`;
}

export class TradeController {
  readonly id: string;
  readonly mode: TradeMode;
  readonly state = signal<TradeState | null>(null);
  readonly connection = signal<TradeConnection>('connecting');
  /** It ran: what you got (a trade), or the battle to open (a wager). */
  readonly done = signal<TradeDone | null>(null);
  /** It ended without a trade. */
  readonly ended = signal<TradeEnd | null>(null);
  /** The latest refusal or failure, as text. */
  readonly error = signal<string | null>(null);

  private readonly opts: TradeOptions;
  private socket: SocketLike | null = null;
  private firstUrl: string | null;
  private attempts = 0;
  private timer: unknown = null;
  private disposed = false;
  private seq = 0;

  constructor(opts: TradeOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.mode = opts.mode;
    this.firstUrl = opts.url;
    void this.connect();
  }

  get over(): boolean {
    return this.done.value !== null || this.ended.value !== null;
  }

  // ---- intents ----------------------------------------------------------------------------------

  /** Replace your whole offer (or stake). The server resets both players' marks. */
  offer(o: Offer): boolean {
    return this.send({ t: 'offer', d: o });
  }

  setFormat(format: Format): boolean {
    return this.send({ t: 'format', d: { format } });
  }

  /** Mark (or unmark) yourself ready for the offers you see now. */
  ready(on: boolean): boolean {
    const s = this.state.value;
    return s ? this.send({ t: 'ready', d: { rev: s.rev, on } }) : false;
  }

  /** Confirm the offers you see now (step two; both must be ready). */
  confirm(): boolean {
    const s = this.state.value;
    return s ? this.send({ t: 'confirm', d: { rev: s.rev } }) : false;
  }

  /** Leave: the session ends for both players. */
  cancel(): boolean {
    return this.send({ t: 'cancel', d: {} });
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState <= OPEN) ws.close(1000, 'left');
    if (this.connection.value !== 'closed') this.connection.value = 'closed';
  }

  // ---- connection -------------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.disposed || this.over) return;
    let path: string;
    if (this.firstUrl) {
      path = this.firstUrl;
      this.firstUrl = null;
    } else {
      try {
        path = (await this.opts.ticket()).url;
      } catch (e) {
        const status = (e as { status?: number } | null)?.status;
        // 404/409: the session is gone or over; 401/403: signed out or no longer entitled.
        if (status !== undefined && status >= 400 && status < 500) {
          this.stop('This trade is no longer open.');
          return;
        }
        this.retry();
        return;
      }
    }
    if (this.disposed) return;
    const url = this.opts.socketUrl ? this.opts.socketUrl(path) : path;
    const ws = this.opts.socketFactory
      ? this.opts.socketFactory(url)
      : (new WebSocket(url) as unknown as SocketLike);
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.attempts = 0;
      this.connection.value = 'open';
      this.send({ t: 'hello', d: {} });
    };
    ws.onmessage = (ev) => {
      if (this.socket === ws) this.receive(ev.data);
    };
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.disposed) return;
      const code = (ev as { code?: number } | null)?.code;
      if (this.over || code === CLOSE_DONE) {
        this.connection.value = 'closed';
        return;
      }
      if (code === CLOSE_REPLACED) {
        this.stop('This trade is open in another tab or window.');
        return;
      }
      if (code === CLOSE_POLICY) {
        this.stop('The trade closed the connection.');
        return;
      }
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry(): void {
    if (this.disposed || this.over) return;
    const delays = this.opts.backoff ?? [500, 1000, 2000, 4000, 8000];
    const ms = delays[this.attempts];
    if (ms === undefined) {
      this.stop('The connection to the trade was lost.');
      return;
    }
    this.attempts++;
    this.connection.value = 'reconnecting';
    const set = this.opts.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t) as unknown);
    this.timer = set(() => {
      this.timer = null;
      void this.connect();
    }, ms);
  }

  private stop(text: string): void {
    this.connection.value = 'closed';
    if (!this.over) this.error.value = text;
  }

  private clearRetry(): void {
    if (this.timer === null) return;
    const clear =
      this.opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }

  private send(msg: ClientMsg): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== OPEN || this.over) return false;
    ws.send(encode(ClientTrade, { ...msg, s: this.seq++ } as ClientMsg));
    return true;
  }

  private receive(raw: unknown): void {
    const msg = decode(ServerTrade, raw, Number.POSITIVE_INFINITY);
    if (!msg) return;
    switch (msg.t) {
      case 'tstate': {
        const prev = this.state.value;
        this.state.value = msg.d;
        // A new revision clears an old complaint (the offers moved on).
        if (prev && msg.d.rev !== prev.rev && msg.d.failure === null) this.error.value = null;
        break;
      }
      case 'tdone':
        this.done.value = msg.d;
        this.error.value = null;
        break;
      case 'tend':
        this.ended.value = msg.d;
        break;
      case 'err':
        this.error.value = tradeErrorText(msg.d.code);
        break;
    }
  }
}
