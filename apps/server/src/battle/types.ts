/**
 * Types of the pure battle core (M4 4.2): what the BattleRoom Durable Object passes in, persists and
 * sends. Everything here is plain JSON data so a hibernated or evicted room resumes from storage.
 */
import type { Bucket, Clocks, Msg, ServerBattleMap } from '@chain-theorem/protocol';
import type {
  ActionInput,
  BattleEvent,
  BattleResult,
  FormatId,
  GameState,
  Loadout,
  PublicEvent,
  Side,
} from '@chain-theorem/rules';

export type Tier = 'wild' | 'trainer' | 'elite';

/** A human seat: the account that owns the socket for this side. */
export interface PlayerSeat {
  playerId: string;
  name: string;
}

/** An NPC seat (9.4): searched on the server, never connected, clock never runs. */
export interface NpcSeat {
  tier: Tier;
  name: string;
  /** Content id of the NPC (trainer, wild creature), for rewards and quests. */
  npcId?: string;
}

export type Seat = PlayerSeat | NpcSeat;

export type SeatInit = Seat & { level: number; loadout: Loadout };

export interface BattleInit {
  battleId: string;
  format: FormatId;
  white: SeatInit;
  black: SeatInit;
  /** Custom start position (NPC puzzles, tests). Standard start when omitted. */
  fen?: string;
}

/** A message for one side, exactly as it goes on the wire after `JSON.stringify`. */
export type ServerMsg = Msg<ServerBattleMap>;

export interface Outgoing {
  to: Side;
  msg: ServerMsg;
}

/** Why a log record's action happened. */
export type RecordCause = 'start' | 'player' | 'npc' | 'flag' | 'prompt_timeout' | 'grace';

/**
 * One applied engine step (the battle start, a move, a choice, a resignation, a timeout ...). The
 * host appends every record to storage as it is produced; `restore` takes them back in order.
 */
export interface LogRecord {
  /** Record index, 0 = battle start. */
  n: number;
  /** Server time of the step (epoch ms). */
  at: number;
  cause: RecordCause;
  /** The engine input (null for the battle start). */
  input: ActionInput | null;
  /** Full-log index of `events[0]` (events carry `i === from + k`). */
  from: number;
  /** Full events: server-side only (log archive, replay verification). */
  events: BattleEvent[];
  /** What each side was sent for these events: `projectEvents` against the state after the step. */
  seen: Record<Side, PublicEvent[]>;
}

export interface SideConn {
  /** A socket is open for this side (NPC seats are always connected). */
  connected: boolean;
  /** `hello` received on the current connection: the side gets streamed updates. */
  live: boolean;
  /** While disconnected: when the grace ends and the side abandons (9.2). */
  graceUntil: number | null;
}

export interface SideStats {
  /** Messages dropped by the rate limit (R-SEC-005). */
  rateLimited: number;
  /** Messages dropped as invalid (not JSON, unknown type, failed schema; R-NET-001). */
  invalid: number;
  /** Valid messages refused by the rules or the conduct rules (R-SEC-002). */
  rejected: number;
}

/** A pending mid-action prompt (5.4): `since` starts the 15 s answer window. */
export interface PromptInfo {
  promptId: string;
  chooser: Side;
  since: number;
}

export interface DrawInfo {
  /** The side whose offer is open; it lapses at the next action. */
  offer: Side | null;
  /** Ply of each side's last offer (at most one per 10 moves, 9.2). */
  lastPly: Record<Side, number | null>;
}

/** Everything the core needs to resume, apart from the log records. JSON-serializable. */
export interface BattleSnapshot {
  v: 1;
  battleId: string;
  format: FormatId;
  fen: string | null;
  seats: Record<Side, SeatInit>;
  /** Full state, including a suspended action (`state.pending`). Server-side only. */
  state: GameState;
  /** Remaining ms of each side at `clocks.at`; `running` is the side being charged. */
  clocks: Clocks;
  prompt: PromptInfo | null;
  draw: DrawInfo;
  conn: Record<Side, SideConn>;
  buckets: Record<Side, Bucket>;
  stats: Record<Side, SideStats>;
  startedAt: number;
  endedAt: number | null;
  /** Latest time seen; earlier `now` values are raised to it so clocks never run backwards. */
  now: number;
  /** Number of log records and of full events so far (checked on restore). */
  records: number;
  events: number;
}

/** What the host needs for the `battles` row, rewards and telemetry. */
export interface BattleSummary {
  battleId: string;
  format: FormatId;
  contentVersion: string;
  white: Seat & { level: number };
  black: Seat & { level: number };
  result: BattleResult;
  startedAt: number;
  endedAt: number;
  /** Plies played (state.ply at the end). */
  plies: number;
  events: number;
  records: number;
  /** Final `stateHash` (DD-55 replay verification). */
  stateHash: string;
  stats: Record<Side, SideStats>;
}

/** The R2 log archive (server-side only: it holds both loadouts and the full events). */
export interface BattleArchive {
  v: 1;
  summary: BattleSummary;
  fen: string | null;
  seats: Record<Side, SeatInit>;
  records: LogRecord[];
}

export type Effect =
  /** Append this record to storage (key it by `record.n`), in the same write as the snapshot. */
  | { kind: 'persist'; record: LogRecord }
  /** Close this side's socket(s): repeat offender (R-SEC-005). The host then calls `disconnect`. */
  | { kind: 'close'; side: Side; code: number; reason: string }
  /** The battle is over: write the `battles` row, grant rewards, archive the log to R2. */
  | { kind: 'ended'; summary: BattleSummary; archive: BattleArchive }
  /** An internal failure the core recovered from (log it; the battle continues). */
  | { kind: 'error'; message: string };

export interface Outbox {
  /** Messages in send order; each goes only to the socket(s) of its side. */
  send: Outgoing[];
  effects: Effect[];
  /**
   * The snapshot changed in a way that must survive eviction: store `snapshot()` (atomically with
   * any `persist` records). False when only rate-limit buckets and counters moved (best effort).
   */
  save: boolean;
}
