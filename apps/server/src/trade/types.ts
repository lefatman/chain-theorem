/**
 * Types of the pure trade core (M6 6.1): what the TradeSession Durable Object passes in, persists and
 * sends. Everything here is plain JSON data so a hibernated or evicted session resumes from storage.
 */
import type {
  Bucket,
  Msg,
  Offer,
  ServerTradeMap,
  TradeErrCode,
  TradeMode,
  TradePhase,
} from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';

/** `a` invited `b`. */
export type TradeSide = 'a' | 'b';

export interface TradeParty {
  id: string;
  name: string;
  level: number;
}

/** What the host loaded from the database for one player: id → quantity. */
export interface Owned {
  items: Record<string, number>;
  cards: Record<string, number>;
}

export interface TradeInit {
  id: string;
  mode: TradeMode;
  /** Wager format; `first_blood` when omitted. Ignored for a trade. */
  format?: FormatId;
  a: TradeParty;
  b: TradeParty;
}

/** A message for one side, exactly as it goes on the wire after `JSON.stringify`. */
export type ServerMsg = Msg<ServerTradeMap>;

export interface Outgoing {
  to: TradeSide;
  msg: ServerMsg;
}

export type Effect =
  /**
   * Both confirmed: run it. A trade: one atomic list (R-SEC-004). A wager: escrow both stakes, then
   * create the battle (9.5). Report back with `executed`. May repeat after a restart (the watchdog):
   * the host's steps are idempotent by the session id.
   */
  | {
      kind: 'execute';
      mode: TradeMode;
      format: FormatId | null;
      offers: Record<TradeSide, Offer>;
      attempt: number;
    }
  /** Close the side's socket(s) (the session ended, or a repeat offender, R-SEC-005). */
  | { kind: 'close'; side: TradeSide; code: number; reason: string }
  /** The session ended a while ago: delete its storage. */
  | { kind: 'purge' }
  /** An internal problem the core recovered from (log it). */
  | { kind: 'error'; message: string };

export interface Outbox {
  send: Outgoing[];
  effects: Effect[];
  /** Store `snapshot()`; false when only rate-limit buckets moved. */
  save: boolean;
}

/** What the host reports after an `execute` effect. */
export type ExecResult =
  | {
      ok: true;
      mode: 'trade';
      /** Each player's saved loadouts that became invalid (10.4). */
      invalid: Record<TradeSide, string[]>;
    }
  | {
      ok: true;
      mode: 'wager';
      battleId: string;
      /** Each player's battle socket path with a fresh ticket (R-SEC-006). */
      urls: Record<TradeSide, string>;
    }
  | { ok: false; code: TradeErrCode };

export interface TradeSnapshot {
  v: 1;
  id: string;
  mode: TradeMode;
  format: FormatId | null;
  parties: Record<TradeSide, TradeParty>;
  offers: Record<TradeSide, Offer>;
  /** Last loaded inventories (null until that side connects). Never sent to anyone. */
  owned: Record<TradeSide, Owned | null>;
  ready: Record<TradeSide, boolean>;
  confirmed: Record<TradeSide, boolean>;
  connected: Record<TradeSide, boolean>;
  phase: TradePhase;
  /** Bumps on every change to either offer or the format, and after a failed attempt. */
  rev: number;
  /** Who made the latest change that cleared marks (null when nothing was cleared since). */
  reset: TradeSide | null;
  failure: TradeErrCode | null;
  /** Execution attempts so far. */
  attempt: number;
  createdAt: number;
  /** Last change or accepted message: the idle expiry counts from here. */
  touchedAt: number;
  endedAt: number | null;
  now: number;
  buckets: Record<TradeSide, Bucket>;
}
