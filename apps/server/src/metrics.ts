/**
 * Usage rollups for the cost dashboard (M5 5.5, 14.2 R-COST-002): zone channels report their
 * telemetry windows and battle rooms their finished battles to the Metrics Durable Object, which keeps
 * one rollup per hour. `costReport` turns rollups into dollars per player-hour, per battle and per
 * zone-hour with the 14.1 cost model, and flags any hour whose projection breaks the $0.10 guardrail.
 *
 * What a Worker cannot measure (CPU time: the clock does not advance while code runs) comes from the
 * 14.1 assumptions: 2 ms per incoming message and 50 ms per NPC move, at 128 MB per object.
 */
import { cost, type CostReport, type Usage } from '@chain-theorem/protocol';
import type { ZoneTelemetry } from './zone/index.ts';

export const HOUR_MS = 3_600_000;
export const MODEL = { msPerMessage: 2, msPerNpcMove: 50, gb: 0.128 } as const;

/** Counted by the ZoneRoom host itself during a telemetry window (not by the pure core). */
export interface HostCounters {
  /** Durable Object storage rows written (snapshot and key puts). */
  rowsWritten: number;
  /** Durable Object requests other than socket messages: upgrades, host calls from other rooms. */
  doRequests: number;
  /** Players admitted (each came through a ticket request and an upgrade request of the Worker). */
  joins: number;
}

export interface ZoneReport extends ZoneTelemetry {
  host: HostCounters;
}

/** What a finished battle cost, as far as the room can count it. */
export interface BattleUsage {
  at: number;
  /** Incoming socket messages from the human seats. */
  messages: number;
  /** Log records applied (one storage row each, plus a snapshot write). */
  records: number;
  npcMoves: number;
  /** Alarm firings (NPC moves, flag falls, prompt timeouts, disconnect grace). */
  alarms: number;
  humans: number;
}

export interface Rollup {
  /** Start of the hour (epoch ms). */
  hour: number;
  playerMs: number;
  /** Channel time covered by zone telemetry windows. */
  zoneMs: number;
  zoneIn: number;
  zoneOut: number;
  zoneDropped: number;
  encounters: number;
  zoneBattles: number;
  battles: number;
  battleIn: number;
  npcMoves: number;
  doRequests: number;
  rowsWritten: number;
  workerRequests: number;
}

export function emptyRollup(hour: number): Rollup {
  return {
    hour,
    playerMs: 0,
    zoneMs: 0,
    zoneIn: 0,
    zoneOut: 0,
    zoneDropped: 0,
    encounters: 0,
    zoneBattles: 0,
    battles: 0,
    battleIn: 0,
    npcMoves: 0,
    doRequests: 0,
    rowsWritten: 0,
    workerRequests: 0,
  };
}

export const hourOf = (t: number): number => Math.floor(t / HOUR_MS) * HOUR_MS;

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

export function addZone(r: Rollup, rep: ZoneReport): void {
  const dropped = rep.dropped.rate + rep.dropped.invalid;
  r.playerMs += rep.playerMs;
  r.zoneMs += Math.max(0, rep.to - rep.from);
  // Valid messages (refused ones included) plus dropped ones: every frame is billed.
  r.zoneIn += sum(rep.in) + dropped;
  r.zoneOut += sum(rep.out);
  r.zoneDropped += dropped + rep.dropped.refused;
  r.encounters += rep.encounters;
  r.zoneBattles += rep.battles;
  r.doRequests += rep.host.doRequests;
  r.rowsWritten += rep.host.rowsWritten;
  r.workerRequests += rep.host.joins * 2;
}

export function addBattle(r: Rollup, b: BattleUsage): void {
  r.battles += 1;
  r.battleIn += b.messages;
  r.npcMoves += b.npcMoves;
  // The init request, one per human connect, and every alarm.
  r.doRequests += 1 + b.humans + b.alarms;
  r.rowsWritten += b.records * 2;
  r.workerRequests += b.humans * 2;
}

export function usageOf(r: Rollup): Usage {
  const cpuMs = (r.zoneIn + r.battleIn) * MODEL.msPerMessage + r.npcMoves * MODEL.msPerNpcMove;
  return {
    playerHours: r.playerMs / HOUR_MS,
    wsIncoming: r.zoneIn + r.battleIn,
    doRequests: r.doRequests,
    gbSeconds: (cpuMs / 1000) * MODEL.gb,
    rowsWritten: r.rowsWritten,
    workerRequests: r.workerRequests,
  };
}

export function mergeRollups(list: readonly Rollup[]): Rollup {
  const out = emptyRollup(list[0]?.hour ?? 0);
  for (const r of list)
    for (const k of Object.keys(out) as (keyof Rollup)[]) if (k !== 'hour') out[k] += r[k];
  return out;
}

export interface CostRow {
  hour: number;
  rollup: Rollup;
  cost: CostReport;
  /** 14.2: the hour's projection per subscriber exceeds the guardrail. */
  alert: boolean;
}

export interface CostDashboard {
  hours: CostRow[];
  total: CostRow;
  perBattle: number;
  perZoneHour: number;
}

/** Hours with less play than this are too small to project (a few seconds of one player). */
export const MIN_ALERT_PLAYER_HOURS = 0.05;

function row(r: Rollup): CostRow {
  const c = cost(usageOf(r));
  return {
    hour: r.hour,
    rollup: r,
    cost: c,
    alert: !c.withinGuardrail && r.playerMs / HOUR_MS >= MIN_ALERT_PLAYER_HOURS,
  };
}

export function costDashboard(rollups: readonly Rollup[]): CostDashboard {
  const sorted = [...rollups].sort((a, b) => a.hour - b.hour);
  const total = mergeRollups(sorted);
  const all = row(total);
  // Battle and zone shares of the total, split by their incoming messages.
  const battleShare =
    total.zoneIn + total.battleIn > 0 ? total.battleIn / (total.zoneIn + total.battleIn) : 0;
  return {
    hours: sorted.map(row),
    total: all,
    perBattle: total.battles > 0 ? (all.cost.total * battleShare) / total.battles : 0,
    perZoneHour:
      total.zoneMs > 0 ? (all.cost.total * (1 - battleShare)) / (total.zoneMs / HOUR_MS) : 0,
  };
}
