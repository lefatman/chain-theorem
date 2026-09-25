/**
 * BattleRoom messages (13.4, ARCHITECTURE 5). Client messages are validated strictly: the server
 * trusts nothing a client sends (R-SEC-002). Server messages carry rules-engine payloads
 * (`project()` and `projectEvents()` output); this package depends on nothing inside the repo
 * (13.1), so those payloads are checked structurally and typed by the client from the rules package.
 */
import { z } from 'zod';

export const Side = z.enum(['white', 'black']);
export type Side = z.infer<typeof Side>;
export const Format = z.enum(['first_blood', 'vanguard', 'full']);
export type Format = z.infer<typeof Format>;

const Sq = z.number().int().min(0).max(63);
/** A UCI move such as e2e4 or e7e8q. */
export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);

export const ChoiceOption = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('decline') }),
  z.object({ kind: z.literal('piece'), piece: z.number().int().min(0).max(63), square: Sq }),
  z.object({ kind: z.literal('square'), square: Sq }),
  z.object({
    kind: z.literal('move'),
    from: Sq,
    to: Sq,
    promotion: z.enum(['queen', 'rook', 'bishop', 'knight']).optional(),
  }),
]);
export type ChoiceOption = z.infer<typeof ChoiceOption>;

/** Client → BattleRoom. */
export const ClientBattle = {
  /** Sent on every (re)connect: the last event index the client has seen (reconnect replay). */
  hello: z.object({ from: z.number().int().min(0).max(1_000_000) }),
  /** Commit a move, optionally with pre-chosen answers for the mover's own Capturing prompts. */
  mv: z.object({ move: Uci, choices: z.array(ChoiceOption).max(4).optional() }),
  /** Answer a mid-action choice by option index. */
  ch: z.object({
    promptId: z.string().regex(/^[0-9.]{1,24}$/),
    option: z.number().int().min(0).max(255),
  }),
  resign: z.object({}),
  /** Offer a draw (at most one per 10 moves, 9.2). */
  draw: z.object({}),
  drawReply: z.object({ accept: z.boolean() }),
  /** Clock sync: the server answers with `clock` echoing `t`. */
  sync: z.object({ t: z.number() }),
};
export type ClientBattleMap = typeof ClientBattle;

/** Remaining time in ms at server time `at`; `running` is the side whose clock runs. */
export const Clocks = z.object({
  white: z.number(),
  black: z.number(),
  running: Side.nullable(),
  at: z.number(),
  /** Increment per move in ms. */
  inc: z.number(),
});
export type Clocks = z.infer<typeof Clocks>;

export const PlayerTag = z.object({
  name: z.string().max(40),
  level: z.number().int().min(1).max(100),
  /** NPC tier when the seat is an NPC. */
  npc: z.enum(['wild', 'trainer', 'elite']).optional(),
});
export type PlayerTag = z.infer<typeof PlayerTag>;

const Payload = z.record(z.string(), z.unknown());

export const ResultMsg = z.object({ winner: Side.nullable(), reason: z.string().max(32) });

/** BattleRoom → client. */
export const ServerBattle = {
  /** Sent after `hello`: the viewer's projection and everything needed to draw the battle. */
  bstart: z.object({
    battleId: z.string().max(64),
    you: Side,
    format: Format,
    public: Payload,
    clocks: Clocks,
    players: z.object({ white: PlayerTag, black: PlayerTag }),
    /** Number of events in the full log; `bev` catches the client up from its `hello.from`. */
    eventCount: z.number().int().min(0),
  }),
  /**
   * The projected events of full-log indexes `from` to `to` (exclusive) and the projection after
   * them. Projection drops events the viewer may not see, so `events` can be shorter than
   * `to - from`; the client sends `to` back in `hello` when it reconnects.
   */
  bev: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    events: z.array(Payload),
    public: Payload,
    clocks: Clocks,
  }),
  /** A choice for this player (only the chooser receives it). */
  prompt: z.object({ promptId: z.string(), request: Payload, deadline: z.number() }),
  bend: z.object({ result: ResultMsg, rewards: Payload.optional() }),
  drawOffer: z.object({ by: Side }),
  /** The draw offer by `by` was declined (by the opponent or an NPC); play goes on. */
  drawDeclined: z.object({ by: Side }),
  /** Clock sync; `echo` returns the client's `sync.t`. */
  clock: z.object({ clocks: Clocks, echo: z.number().optional(), now: z.number() }),
  /** The opponent's connection: while away the battle waits `graceUntil` at most (9.2). */
  opp: z.object({ connected: z.boolean(), graceUntil: z.number().optional() }),
  /** How many spectators watch this battle (M7 7.2, public battles only; carries no game state). */
  watchers: z.object({ count: z.number().int().min(0) }),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerBattleMap = typeof ServerBattle;

/** Error codes sent in `err`. */
export const BattleErr = {
  bad_message: 'bad_message',
  not_your_turn: 'not_your_turn',
  illegal: 'illegal',
  no_prompt: 'no_prompt',
  rate_limited: 'rate_limited',
  over: 'over',
  draw_limit: 'draw_limit',
} as const;
