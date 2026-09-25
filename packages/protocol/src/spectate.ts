/**
 * Spectating (M7 7.2; spec 10.4 "delayed, public-projection-only view of live battles"; 13.4).
 *
 * A spectator socket (`/ws/spectate/:battleId?t=`, a 60-second ticket bound to the account and the
 * battle, R-SEC-006) is read-only: the only client message is `hello`, everything else is dropped
 * and counted like invalid player input (R-SEC-005). The room answers with the spectator projection
 * (`engine.projectSpectator`) of a position a fixed number of plies behind the live one, then streams
 * spectator-projected events (`engine.projectSpectatorEvents`) as they fall out of the delay window;
 * a spectator never receives a player seat's messages (R-INFO-005, R-SEC-001).
 */
import { z } from 'zod';
import { Clocks, Format, PlayerTag, ResultMsg } from './battle.ts';

const Payload = z.record(z.string(), z.unknown());

/** Client → BattleRoom on a spectator socket. */
export const ClientSpectate = {
  /** Sent on every (re)connect: the full-log index of the last event already shown. */
  hello: z.object({ from: z.number().int().min(0).max(1_000_000) }),
};
export type ClientSpectateMap = typeof ClientSpectate;

/** BattleRoom → spectator. */
export const ServerSpectate = {
  /** After `hello`: the delayed position as a spectator may see it. */
  sstart: z.object({
    battleId: z.string().max(64),
    format: Format,
    /** `projectSpectator()` output of the delayed position. */
    public: Payload,
    players: z.object({ white: PlayerTag, black: PlayerTag }),
    /** Plies the view stays behind the live position (everything is shown once the battle ends). */
    delay: z.number().int().min(0),
    /** Full-log index after the last event shown; `hello.from` on a reconnect. */
    eventCount: z.number().int().min(0),
    /** Clocks at the delayed position; they do not run in a spectator view. */
    clocks: Clocks.nullable(),
    /** Spectators watching now. */
    watchers: z.number().int().min(0),
  }),
  /**
   * Spectator-projected events of full-log indexes `from` to `to` (exclusive) and the projection
   * after them. Events a spectator may not see are dropped, so `events` can be shorter.
   */
  sev: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    events: z.array(Payload),
    public: Payload,
    clocks: Clocks.nullable(),
  }),
  /** The battle is over and every event has been shown. */
  send: z.object({ result: ResultMsg }),
  /** The number of spectators changed. */
  watchers: z.object({ count: z.number().int().min(0) }),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerSpectateMap = typeof ServerSpectate;

/** Error codes sent in a spectator `err`. */
export const SpectateErr = {
  bad_message: 'bad_message',
  rate_limited: 'rate_limited',
  not_public: 'not_public',
} as const;

// ---- REST ---------------------------------------------------------------------------------------

/** Why a battle is public: ranked, a tournament game, or a challenge-zone battle (10.4 R-WORLD-006). */
export const LiveKind = z.enum(['ranked', 'tournament', 'challenge_zone']);
export type LiveKind = z.infer<typeof LiveKind>;

const LivePlayer = z.object({ name: z.string().max(40), level: z.number().int().min(1).max(100) });

/** One entry of `GET /api/battles/live`. */
export const LiveBattle = z.object({
  id: z.string().max(64),
  format: Format,
  kind: LiveKind,
  /** Ranked: the slot bracket. */
  bracket: z.string().max(32).optional(),
  /** Tournament: its name or id. */
  tournament: z.string().max(80).optional(),
  white: LivePlayer,
  black: LivePlayer,
  spectators: z.number().int().min(0),
  startedAt: z.number(),
});
export type LiveBattle = z.infer<typeof LiveBattle>;

/** `GET /api/battles/live`: public live battles, newest first, and the spectator delay in plies. */
export const LiveBattles = z.object({ battles: z.array(LiveBattle), delay: z.number().int() });
export type LiveBattles = z.infer<typeof LiveBattles>;

/** `POST /api/battles/:id/spectate`: a 60-second spectator ticket (R-SEC-006). */
export const SpectateTicket = z.object({
  battleId: z.string(),
  token: z.string(),
  url: z.string(),
});
export type SpectateTicket = z.infer<typeof SpectateTicket>;

/**
 * `GET /api/settings/spectate` and the answer of `PUT`: whether others may watch the player's public
 * battles (`allow`), whether that is the player's own choice (`custom`) or the default, and the
 * default itself (on for adults, off under 18).
 */
export const SpectateSetting = z.object({
  allow: z.boolean(),
  custom: z.boolean(),
  byDefault: z.boolean(),
});
export type SpectateSetting = z.infer<typeof SpectateSetting>;

/** `PUT /api/settings/spectate`: a choice, or null to go back to the default. */
export const SetSpectate = z.object({ allow: z.boolean().nullable() });
export type SetSpectate = z.infer<typeof SetSpectate>;
