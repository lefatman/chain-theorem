/**
 * Types of the pure zone core (M5, spec 10): what the ZoneRoom Durable Object passes in, persists and
 * sends. Everything here is plain JSON data so an evicted or hibernated room resumes from storage.
 */
import type { Bucket, Msg, ServerZoneMap } from '@chain-theorem/protocol';
import type { ElementId, FormatId } from '@chain-theorem/rules';
import type { Dir, EncounterEntry, NpcTier, Reward } from './world.ts';

/** A message for one player, exactly as it goes on the wire after `JSON.stringify`. */
export type ServerMsg = Msg<ServerZoneMap>;

export interface Outgoing {
  /** Player id: the message goes only to that player's zone socket(s). */
  to: string;
  msg: ServerMsg;
}

/** Per-quest step state, as stored per player (the protocol's `QuestState`). */
export interface QuestProgress {
  id: string;
  /** Index of the current step; equals `steps.length` once done. */
  step: number;
  done: boolean;
}

/**
 * A party as the host knows it (parties span zones, 10.4). `minor` is true when any member is under
 * 18: the host recomputes it on every membership change and calls `setParty` for every member before
 * the next message is delivered (R-SEC-011). It never reaches a client.
 */
export interface PartyView {
  id: string;
  leader: string;
  members: { p: string; name: string; zone: string | null }[];
  minor: boolean;
}

/** What the host loads for a player joining a zone channel. */
export interface PlayerInit {
  id: string;
  name: string;
  level: number;
  /** 18 or over (`adult_from` has passed, R-SEC-011). */
  adult: boolean;
  friends: string[];
  /** Saved position in this zone; the zone spawn when omitted or not walkable. */
  x?: number;
  y?: number;
  dir?: Dir;
  quests: QuestProgress[];
  lessonsDone: string[];
  /** Once-only trainers already defeated. */
  defeatedNpcs: string[];
  keyItems: string[];
  party: PartyView | null;
  /** The adult's own chat-filter preference (minors are always filtered). */
  filterChat: boolean;
  /** Still in a battle started before this join (a reload mid-battle); default false. */
  battling?: boolean;
  /** When the player's last battle ended (epoch ms), for the 60 s challenge cooldown (10.4). */
  battleEndedAt?: number | null;
  /** The player's guild (M6, 10.4): guild chat goes to its GuildRoom; null or absent: none. */
  guild?: string | null;
}

/** A battle the host must create (a BattleRoom), then answer with `battleStarted` per player. */
export type BattleRequest =
  | {
      kind: 'wild';
      players: [string];
      format: FormatId;
      zone: string;
      entry: EncounterEntry;
      /** Wild NPC level: the entry range clamped to the player's level ± 2. */
      level: number;
    }
  | {
      kind: 'trainer';
      players: [string];
      format: FormatId;
      /** NpcDef id: its `trainer` role holds tier, level, loadout and reward. */
      npc: string;
      tier: NpcTier;
      level: number;
    }
  | {
      kind: 'lesson';
      players: [string];
      format: FormatId;
      /** LessonDef id of a `battle` lesson: fixed loadouts, FEN and NPC come from the lesson. */
      lesson: string;
    }
  | {
      kind: 'challenge';
      players: [string, string];
      format: FormatId;
      /** True for a challenge-zone battle started without consent (R-WORLD-006). */
      auto: boolean;
    };

/** How a battle ended for one player; the host fills it from the finished battle. */
export interface BattleOutcome {
  result: 'win' | 'loss' | 'draw';
  kind: 'wild' | 'trainer' | 'lesson' | 'challenge';
  npc?: string;
  lesson?: string;
  format: FormatId;
  /** NPC tier of the opponent (absent in PvP). */
  tier?: NpcTier;
  /** Element affinities of the abilities the player used (win constraints, 10.5). */
  affinities: ElementId[];
}

/**
 * A party, whisper or guild line routed by the host to another player's zone core (`deliverChat`).
 * Guild lines come from the guild's GuildRoom, which sets `filtered` when any member is under 18.
 */
export interface RoutedChat {
  ch: 'party' | 'whisper' | 'guild';
  from: string;
  name: string;
  /** Already filtered when `filtered` is true: raw text never leaves a filtered conversation. */
  text: string;
  /** The conversation is filtered at the source (a minor sender, or a party with a minor). */
  filtered: boolean;
  fromAdult: boolean;
  /** Whisper: the recipient is on the sender's friend list (minor whispers need friendship). */
  friend: boolean;
}

export type PartyOp =
  | { op: 'invite'; from: string; name: string; to: string }
  | { op: 'reply'; from: string; invite: string; accept: boolean }
  | { op: 'leave'; from: string };

/** Counters for one telemetry window (14.2 cost per player-hour and per zone-hour). */
export interface ZoneTelemetry {
  zone: string;
  channel: number;
  /** Window start and end (epoch ms). */
  from: number;
  to: number;
  /** Players in the channel at the end of the window. */
  players: number;
  /** Sum over players of the time spent in the channel during the window. */
  playerMs: number;
  /** Valid client messages by type. */
  in: Record<string, number>;
  /** Server messages by type. */
  out: Record<string, number>;
  dropped: {
    /** Over the rate limit (R-SEC-005). */
    rate: number;
    /** Not JSON, unknown type or failed schema (R-NET-001). */
    invalid: number;
    /** Valid but refused (a wall, too far from an NPC, not allowed). */
    refused: number;
  };
  encounters: number;
  battles: number;
}

export type Effect =
  /** Create the battle (BattleRoom), then call `battleStarted` for each human player. */
  | { kind: 'battle'; ref: string; battle: BattleRequest }
  /**
   * The player stepped on a warp (or party travel): save this position (a zone change, R-COST-002),
   * issue a zone ticket for `zone`; the client reconnects there. `leave` then persists nothing.
   */
  | { kind: 'warp'; id: string; zone: string; x: number; y: number; dir: Dir }
  /** The player left the channel: save the position (logout, R-COST-002). */
  | { kind: 'persist'; id: string; zone: string; x: number; y: number; dir: Dir }
  /** Store this quest's step state for the player. */
  | { kind: 'quest'; id: string; quest: QuestProgress }
  /** Grant the quest reward (idempotency key `quest:<player>:<quest>`), then call `grant`. */
  | { kind: 'questDone'; id: string; quest: string; reward: Reward }
  /** Store the lesson as done and grant its reward (key `lesson:<player>:<lesson>`), then `grant`. */
  | { kind: 'lessonDone'; id: string; lesson: string; reward: Reward; skipped: boolean }
  /** Store a once-only trainer as defeated (a progress flag). */
  | { kind: 'defeated'; id: string; npc: string }
  /** Deliver `msg` to each player in `to` with `deliverChat` on their zone core, wherever they are. */
  | { kind: 'chat'; from: string; to: string[]; msg: RoutedChat }
  /**
   * A guild line (M6, 10.4): the host forwards it to the guild's GuildRoom, which filters it by the
   * guild's youngest member (R-SEC-011) and delivers it to every online member (`deliverChat`).
   */
  | { kind: 'guildChat'; guild: string; msg: RoutedChat }
  /** A routed whisper was refused or undeliverable: call `chatRefused(to)` on the sender's core. */
  | { kind: 'bounce'; to: string; code: string }
  /** A party operation for the host (parties span zones); then `setParty` / `partyInvite`. */
  | { kind: 'party'; party: PartyOp }
  /** Store the player's chat-filter preference. */
  | { kind: 'prefs'; id: string; filterChat: boolean }
  /** Write these counters to the telemetry sink (Analytics Engine in production). */
  | { kind: 'telemetry'; report: ZoneTelemetry }
  /** Close the player's socket: repeat offender (R-SEC-005). The host then calls `leave`. */
  | { kind: 'close'; id: string; code: number; reason: string }
  /** An internal problem the core recovered from (log it). */
  | { kind: 'error'; message: string };

export interface Outbox {
  /** Messages in send order. */
  send: Outgoing[];
  effects: Effect[];
  /**
   * Something that must survive eviction changed: store `snapshot()`. False when only positions,
   * rate-limit buckets and counters moved (best effort; positions are saved on leave and warp).
   */
  save: boolean;
}

export interface JoinOutbox extends Outbox {
  /** Why the player was not admitted ('full': open or pick the next channel, 10.1). */
  refused: 'full' | null;
}

/** A consent challenge waiting for the target's reply (10.4). */
export interface PendingChallenge {
  id: string;
  from: string;
  to: string;
  format: FormatId;
  at: number;
}

/** One player in the channel. JSON-serializable. */
export interface PlayerState {
  id: string;
  name: string;
  level: number;
  adult: boolean;
  friends: string[];
  filterChat: boolean;
  x: number;
  y: number;
  dir: Dir;
  /** `hello` received on the current connection: the player gets broadcasts. */
  live: boolean;
  quests: QuestProgress[];
  lessonsDone: string[];
  defeatedNpcs: string[];
  keyItems: string[];
  party: PartyView | null;
  /** The player's guild id (M6); absent in snapshots stored before M6. */
  guild?: string | null;
  battling: boolean;
  battleId: string | null;
  battleEndedAt: number | null;
  /** Wild steps left that cannot roll an encounter (10.2 grace). */
  grace: number;
  inChallenge: boolean;
  /** The open dialog: `choose` must pick one of these options. */
  dialog: { npc: string; options: string[] } | null;
  /** The puzzle lesson in progress. */
  lesson: { id: string; index: number } | null;
  /** Set once the player warped out: further input is ignored and `leave` persists nothing. */
  warping: { zone: string; x: number; y: number; dir: Dir } | null;
  buckets: { step: Bucket; chat: Bucket; other: Bucket };
}

export interface TelemetryState {
  from: number;
  playerMs: number;
  in: Record<string, number>;
  out: Record<string, number>;
  dropped: ZoneTelemetry['dropped'];
  encounters: number;
  battles: number;
}

/** Everything the core needs to resume after eviction. */
export interface ZoneSnapshot {
  v: 1;
  zone: string;
  channel: number;
  /** Latest time seen; earlier `now` values are raised to it. */
  now: number;
  /** Counter for battle refs and challenge ids. */
  seq: number;
  /** In join order (broadcast order). */
  players: PlayerState[];
  challenges: PendingChallenge[];
  tele: TelemetryState;
}
