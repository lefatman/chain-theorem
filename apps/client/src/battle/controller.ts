/**
 * The contract between the battle UI (Phaser board + Preact overlay) and whatever runs the battle:
 * the local engine (hot-seat, vs NPC, Scenario Lab) or a BattleRoom socket (M4). The UI only ever
 * sees projections (R-INFO-005): `pub` is `project()` output for the current viewer.
 */
import type { Signal } from '@preact/signals';
import type { BattleResult, ChoiceRequest, Loadout, PublicEvent, PublicState, Side } from '@chain-theorem/rules';

export interface Clocks {
  white: number;
  black: number;
  /** Side whose clock is running, or null. */
  running: Side | null;
  /** performance.now() / Date.now() when these values were sampled (UI interpolates). */
  at: number;
}

export interface LogEntry {
  /** Battle-wide event index. */
  i: number;
  /** Ply the event belongs to. */
  ply: number;
  depth: number;
  event: PublicEvent;
  /** Plain-language log line (11.2). */
  text: string;
}

export interface BattleSnapshot {
  pub: PublicState;
  viewer: Side;
  /** The viewer's own loadout (move previews use only this plus revealed info, 8.4). */
  own: Loadout;
  log: LogEntry[];
  /** A prompt the viewer must answer (5.4 mid-action choice). */
  prompt: (ChoiceRequest & { deadline?: number }) | null;
  clocks: Clocks | null;
  status: 'playing' | 'waiting' | 'ended';
  result: BattleResult | null;
  /** Human-readable name per side. */
  names: Record<Side, string>;
  /** Which sides this client controls (hot-seat: both). */
  controls: Side[];
  /** Interstitial before handing the device over in hot-seat play. */
  handoff: Side | null;
}

/** One committed action's projected events, for step-by-step animation (11.2). */
export interface BattleUpdate {
  before: PublicState;
  after: PublicState;
  events: PublicEvent[];
}

export interface BattleController {
  readonly snapshot: Signal<BattleSnapshot>;
  /** Subscribe to per-action updates (board animation). Returns an unsubscribe function. */
  onUpdate(listener: (u: BattleUpdate) => void): () => void;
  move(uci: string): void;
  answer(option: number): void;
  resign(): void;
  offerDraw(): void;
  /** Hot-seat: the next player confirms they have the device. */
  acceptHandoff(): void;
  dispose(): void;
}
