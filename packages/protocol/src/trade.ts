/**
 * Trades and item wagers (M6 6.1; spec 10.4 R-WORLD-004, 9.5 R-FMT-006): the TradeSession socket
 * (`/ws/trade/:id?t=`, a 60 s ticket bound to the player and `trade:<id>`, R-SEC-006) and the REST
 * bodies. Both players edit their own offer; any change to either offer (or to a wager's format)
 * resets both players' ready marks and confirmations; the trade runs when both marked ready and then
 * both confirmed. Offers carry item and card ids with quantities only: never a loadout, and never
 * whether a staked item is equipped (9.5, R-SEC-001).
 */
import { z } from 'zod';
import { Format } from './battle.ts';

const Id = z.string().min(1).max(64);
const Name = z.string().max(40);
const ModuleId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** Most lines per kind (items, cards) on one side of a trade or wager. */
export const OFFER_MAX_LINES = 16;
/** Largest quantity of one line. */
export const OFFER_MAX_QTY = 99;

export const OfferLine = z.object({
  id: ModuleId,
  qty: z.number().int().min(1).max(OFFER_MAX_QTY),
});
export type OfferLine = z.infer<typeof OfferLine>;

/** One side's offer (a trade) or stake (a wager). */
export const Offer = z.object({
  items: z.array(OfferLine).max(OFFER_MAX_LINES).default([]),
  cards: z.array(OfferLine).max(OFFER_MAX_LINES).default([]),
});
export type Offer = z.infer<typeof Offer>;

/** `trade`: a direct trade (10.4). `wager`: stakes for a PvP battle (9.5). */
export const TradeMode = z.enum(['trade', 'wager']);
export type TradeMode = z.infer<typeof TradeMode>;

// ---- REST -----------------------------------------------------------------------------------------

/** `POST /api/trades`: invite a player in your zone channel to trade or to a wager battle. */
export const StartTrade = z.object({
  with: Id,
  mode: TradeMode,
  /** Wager format (either player may change it later; a change resets confirmations). */
  format: Format.optional(),
});
export type StartTrade = z.infer<typeof StartTrade>;

/** `POST /api/trades` and `POST /api/trades/:id/ticket` answer: the trade socket (60 s ticket). */
export const TradeTicket = z.object({ id: Id, mode: TradeMode, url: z.string().max(1024) });
export type TradeTicket = z.infer<typeof TradeTicket>;

/** `GET /api/trades/access`: trial and lapsed accounts cannot trade or wager (14.4, R-COST-005). */
export const TradeAccess = z.object({
  allowed: z.boolean(),
  reason: z.enum(['trial', 'expired']).nullable(),
});
export type TradeAccess = z.infer<typeof TradeAccess>;

// ---- Socket ---------------------------------------------------------------------------------------

/** Client → TradeSession. */
export const ClientTrade = {
  /** Sent on every (re)connect; answered with `tstate`. */
  hello: z.object({}),
  /** Replace your whole offer (or stake). A change resets both players' ready and confirm marks. */
  offer: Offer,
  /** Wager only: the battle format. A change resets both players' marks. */
  format: z.object({ format: Format }),
  /** Mark (or unmark) yourself ready for the offers of revision `rev`. */
  ready: z.object({ rev: z.number().int().min(0).max(1_000_000), on: z.boolean() }),
  /** Confirm revision `rev` (both players must be ready). When both confirm, the trade runs. */
  confirm: z.object({ rev: z.number().int().min(0).max(1_000_000) }),
  /** Leave (or, for the invitee, decline): the session ends for both. */
  cancel: z.object({}),
};
export type ClientTradeMap = typeof ClientTrade;

/** Where a session is: waiting for the invitee, negotiating, running the trade, or over. */
export const TradePhase = z.enum(['invited', 'open', 'executing', 'done', 'cancelled', 'expired']);
export type TradePhase = z.infer<typeof TradePhase>;

const SideView = z.object({
  name: Name,
  offer: Offer,
  ready: z.boolean(),
  confirmed: z.boolean(),
});

/** TradeSession → client. */
export const ServerTrade = {
  /** The whole session as this player sees it; sent after `hello` and after every change. */
  tstate: z.object({
    id: Id,
    mode: TradeMode,
    /** Wager format (null for a trade). */
    format: Format.nullable(),
    /** Offer revision: bumps on every change to either offer or the format. */
    rev: z.number().int().min(0),
    phase: TradePhase,
    me: SideView,
    them: SideView.extend({
      level: z.number().int().min(1).max(100),
      /** Their socket is open right now. */
      here: z.boolean(),
    }),
    /** The latest change reset the marks: who made it (null when nothing was reset since). */
    reset: z.enum(['you', 'them']).nullable(),
    /** Why the last attempt to run it failed (both marks were reset), e.g. `not_owned`. */
    failure: z.string().max(32).nullable(),
    /** When the session expires if nothing happens (epoch ms, server time). */
    expiresAt: z.number(),
  }),
  /** It ran. A trade: what you received and gave. A wager: the battle to open (60 s ticket). */
  tdone: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('trade'),
      got: Offer,
      gave: Offer,
      /** Your saved loadouts that are invalid now until you fix them (10.4). */
      invalid: z.array(Name).max(5),
    }),
    z.object({ mode: z.literal('wager'), battleId: Id, url: z.string().max(1024) }),
  ]),
  /** The session ended without a trade. */
  tend: z.object({
    reason: z.enum(['cancelled', 'declined', 'expired']),
    /** Who ended it (null: the server, on expiry). */
    by: z.enum(['you', 'them']).nullable(),
  }),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerTradeMap = typeof ServerTrade;

/** `err.code` values a TradeSession sends. */
export const TradeErr = {
  bad_message: 'bad_message',
  rate_limited: 'rate_limited',
  /** The offers changed since the revision you marked or confirmed. */
  stale: 'stale',
  /** Not while the invitee has not joined, while the trade runs, or after it ended. */
  not_open: 'not_open',
  /** An unknown item or ability card id. */
  unknown: 'unknown',
  /** You do not own that many (at the time of the offer; the database decides at the end). */
  not_owned: 'not_owned',
  /** Confirm needs both players ready. */
  not_ready: 'not_ready',
  /** A trade needs something on at least one side. */
  empty: 'empty',
  /** A wager needs a stake from each player. */
  no_stakes: 'no_stakes',
  /** A format change outside a wager. */
  not_wager: 'not_wager',
  /** Trading and wagers are for subscribers (14.4); checked again when it runs. */
  not_entitled: 'not_entitled',
  /** The wager battle could not start; the stakes went back. */
  battle_failed: 'battle_failed',
  /** It could not run (a server problem); nothing changed. */
  failed: 'failed',
} as const;
export type TradeErrCode = (typeof TradeErr)[keyof typeof TradeErr];
